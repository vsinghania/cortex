# jobs_svc — durable background work

A Mongo-backed job queue with an in-process worker. Work is enqueued from a request, survives the deploy that interrupts it, and resumes where it stopped.

Source: [src/jobs_svc/](../src/jobs_svc/). First workload: the admin notes re-index ([src/notes_svc/jobs/](../src/notes_svc/jobs/)), exposed at `/api/v1/admin/notes/*` ([web.md](web.md)).

```
JobScheduler ─┐                                    ┌─► JobHandlerRegistry ─► handler
(job_schedules)├─► jobs collection ◄── claim ── JobWorker
enqueue ──────┘         │                   │      └─ lease heartbeat: flush progress,
(any process)           └─ TTL reaps           read cancel, extend lease
                           terminal jobs
```

**Who decides what.** The split is deliberate, and most of the design follows from it:

| | owns |
| --- | --- |
| **Scheduler** | *which windows exist* — recurrence arithmetic, materializing one window, advancing. Never executes. |
| **Job** | *the contract between them* — `run_at` (not before), `deadline_at` (not after), `scheduled_for` (which window) |
| **Worker** | *execution* — claiming, leasing, retry, cancellation, and every judgement about the moment work starts |

The load-bearing rule is that **anything the worker must know has to travel on the job**, because the scheduler is long gone by the time work begins. Lateness is the clearest case: it is a property of the instant a job *starts*, so a scheduler deciding it at enqueue time can only guess, and is blind to delay caused by a backlog or a stalled worker.

---

## 1. The central idea: one field decides who runs next

`visible_at` answers a single question — *when does this job become available to a worker* — and it answers it for both states that matter:

| status | `visible_at` | meaning |
| --- | --- | --- |
| `queued` | `= run_at` | earliest it may run (delay, or retry backoff) |
| `running` | `= lease_expires_at` | when the current owner's claim lapses |
| terminal | `null` | never |

So the claim is two predicates, and **reclaiming a crashed worker's job *is* the claim** — there is no reaper, no `$or`, and one index (`job_claim`) serves it with no blocking sort:

```js
filter  = { status: { $in: ['queued','running'] }, visible_at: { $lte: now } }
options = { sort: { visible_at: 1 }, returnDocument: 'after' }
```

`findOneAndUpdate` is atomic per document, so two workers firing this together cannot both win: the loser's filter no longer matches, and it takes the next job instead. This is the whole of the horizontal-scaling story — N workers running different jobs need nothing more.

The query is built by [`JobClaimQuery`](../src/jobs_svc/repositories/job_claim_query.ts), which returns plain objects so it is asserted in a unit test with no database.

`visible_at` is only the *lower* bound. The upper one, `deadline_at`, is checked **after** the claim rather than in the filter, because comparing two fields inside the query needs `$expr`, which takes no index bounds — the same reason `attempts < max_attempts` is a post-claim check. A job claimed past its deadline goes terminal as `cancelled` with `result.skipped = 'deadline_exceeded'`; the handler is never invoked.

## 2. Leases, not locks

A worker that is `kill -9`'d or evicted never gets to release anything. So ownership expires rather than being handed back: `lease_expires_at` is a deadline the owner must keep renewing.

**Attempts increment at claim, not at failure.** A handler that hard-crashes its process never reaches a failure write, so counting at claim is what stops a poison job looping forever.

**The fence:** `locked_by: worker_id` is in the filter of *every* post-claim write — heartbeat, complete, retry, fail, release. A worker that stalls past its lease and wakes up finds its writes match zero documents. Mongo runs standalone here (no replica set, so no multi-document transactions), and single-document fencing is the only defence available; it suffices because the lock is one field on one document.

**The heartbeat does three things in one write**: extends the lease, flushes progress and checkpoint, and reads the cancel flag. It runs on the *shorter* of `lease_ms / 3` and 10s — lease-keeping alone would allow 100s under the re-index's 5-minute lease, which would freeze a polling UI and delay cancellation just as long. A `null` return means the lease was lost; the handler must abort and write nothing.

## 3. Resumability is the point

The re-index is a sweep over every note, and it can run for hours. Three fields make an interrupted run recoverable rather than lost:

- `checkpoint` — a resume cursor the handler writes. The notes sweep pages by note `id` with `$gt` (ids are UUIDv7, so they sort chronologically and stay stable while the sweep mutates rows underneath it).
- `progress` — counts, flushed by the heartbeat, so a poll-based endpoint can watch a running job.
- `errors` — capped per-item failures; one bad note is counted and the sweep continues.

A resuming handler **must seed its counters from `ctx.progress`**, or `processed` jumps backwards after a reclaim. That is what `JobContext` exposes it for.

On `SIGTERM` the worker stops claiming, aborts in-flight handlers, flushes their checkpoints and **releases the lease without burning an attempt** — so the next container resumes immediately instead of waiting the lease out. That drain needs a `stop_grace_period` longer than Compose's 10s default; see §6.

## 4. Single-flight, enforced by the database

`dedup_active` is set at enqueue and unset only at a terminal write, so the lock spans the whole run — not just the queued window. A second enqueue of an active key is refused by a unique partial index and surfaces as `ConflictError` (409):

```
uniq_job_dedup_active: { name: 1, user_id: 1, dedup_key: 1 }
  partialFilterExpression: { dedup_active: true }
```

It keys on a boolean rather than on `status` because `partialFilterExpression` accepts neither `$in` nor `$or`, so "queued **or** running" is not expressible — the same `$exists`/`$type` trick `note_model` uses for `uniq_user_source_external`.

`user_id` in the key is what lets a re-index of one user coexist with another's while still blocking a duplicate of either.

A second unique index does a different job — **exactly-once per recurrence window**:

```
uniq_schedule_window: { schedule_id: 1, scheduled_for: 1 }
  partialFilterExpression: { scheduled_for: { $exists: true } }
```

Partial because only *scheduled* jobs have a window; without it every ad-hoc job would carry `(null, null)` and they would all collide with one another. The two are easy to confuse:

| | prevents | cleared |
| --- | --- | --- |
| `scheduled_for` | the same **window** being materialized twice | never — it is history |
| `dedup_active` | a **new run** starting while the previous is active | at the terminal write |

One stops duplicate creation, the other stops overrun. `enqueue` reports which constraint refused (`conflict_on`), because they mean different things to whoever is reading the logs.

## 5. Two deliberate exceptions

**`jobs.user_id` is optional, and is not an authorization scope.** Every other collection is user-scoped and [recall.md](recall.md) calls that invariant load-bearing. Here it is optional because a job may legitimately be system-wide — the re-index with an empty filter targets every note in the system. Present, it means "this job's work belongs to one user" and scopes the dedup key; absent, the job is system-wide. It never decides what a handler may read: `payload` does that, and `requested_by` separately records which admin triggered the run. **Do not "fix" this into a required tenant guard.** The compensating control is that the only enqueue surface is admin-gated.

**`claimNext` is the one deliberately unscoped repository method.** The worker is a system actor; `user_id` comes *out of* a job, never into the query. Every read method beside it stays scoped as usual.

## 6. Operations

Everything is an env var — there are no constructor overrides, so `JobWorker.create()` takes no arguments and topology is configuration rather than code. See [.env.example](../.env.example) for `JOBS_*` and `MONGO_DB_JOBS`.

`stop_grace_period: 30s` is set on `web-server` in all three compose files. Compose SIGKILLs 10s after SIGTERM by default, which would cut the drain off mid-flush on **every deploy** — the graceful shutdown would look implemented and never once work. Three numbers move together: that 30s, `JOBS_DRAIN_DEADLINE_MS` (25s), and the forced exit in `server.ts` (28s).

Terminal jobs are reaped by a per-document TTL (`expires_at` with `expireAfterSeconds: 0`), so succeeded (3d) and failed (14d) share one index. Non-terminal jobs carry no `expires_at` and are never touched.

Smoke suites against a real Mongo: `npm run jobs:smoke` (repository — claim exclusivity, reclaim, fencing, single-flight) and `npm run jobs:smoke:worker` (worker — retry, cancel, drain, resume).

## 7. Adding a handler

`jobs_svc` never names a domain concept — that is asserted by [layering.test.ts](../scripts/layering.test.ts), and it is why `JobName` is a plain string rather than an enum. Handlers live in their own module and are registered into the queue from the composition root.

1. Declare the name and a Zod payload schema in your module (see [notes_job.types.ts](../src/notes_svc/jobs/notes_job.types.ts)).
2. Implement `JobHandler`: `parsePayload` (throwing here is a *permanent* failure) and `handle(payload, ctx)`.
3. Register it in `JobHandlerBootstrap.registerAll()` ([job_handler_bootstrap.ts](../src/web-server/bootstrap/job_handler_bootstrap.ts)). That step **rethrows** rather than warning — see the gotcha below.

Payloads carry references (ids), never snapshots, so a job re-reads current state when it runs. And **re-parse the payload even though the controller already validated it**: it round-trips through `Schema.Types.Mixed` and can outlive a schema change while sitting in the queue, which makes storage an untrusted boundary like any other. That is not theoretical — BSON serializes `undefined` to `null`, so an absent optional filter comes back as `null` and a bare `.optional()` rejects it. Use `.nullish()`.

## 8. Recurring work

A second collection, `job_schedules`, holds recurring *definitions*; `JobScheduler` ticks every 30s and materializes due ones into `jobs`. Nothing downstream can tell a scheduled run from a one-shot enqueue — it is an ordinary row carrying a `schedule_id`.

Two rules do most of the work:

**Insert first, then advance.** The insert is idempotent — `uniq_schedule_window` (§4) makes `(schedule_id, scheduled_for)` unique — so a crash between the two steps is recoverable: the next tick reads the same `next_run_at`, re-inserts, collides harmlessly, and advances anyway. That is what makes materialization **exactly-once per window**.

Advancing first, as an earlier version did, lost the window silently in that gap: `next_run_at` had moved on, no job existed, and nothing was left to retry from — at-most-once, with no way to tell it had happened.

The window key also subsumes the cross-container guard: two schedulers ticking together both attempt the insert, and the unique index picks one. The compare-and-swap on `next_run_at` remains so the advance happens once too, and it cannot be folded into the read, because the new `next_run_at` depends on the schedule's own kind and expression — not known until the document has been read.

**Advance forward from now, never from the stale value.** A container down for six hours therefore materializes at most *one* window rather than one per hour missed.

**Whether a late run should still happen is not the scheduler's call.** It is a question about the moment work *starts*, and only the worker is present for that - a scheduler deciding it at enqueue time is blind to lateness caused by a backlog, a disabled worker, or a queue that is simply busy. So a schedule's `max_delay_ms` becomes `deadline_at` on each spawned job, and the worker enforces it post-claim (§2). Absent means no limit: run it whenever, which suits housekeeping that simply needs to happen. Present means the run is skipped - `cancelled`, with `result.skipped = 'deadline_exceeded'` - once its window has closed.

Overrun needs no separate guard: a schedule carrying a `dedup_key` spawns runs that collide on `uniq_job_dedup_active` (§4) while the previous one is still active, so the window is skipped and logged — and `next_run_at` has already moved, so the following window is unaffected.

Concrete runs are managed over HTTP under `/api/v1/admin/jobs` (`POST` to run one out of band, `GET` to list or read, `POST /:id/cancel`, `GET /stats` for queue depth). Schedules sit under `/api/v1/admin/jobs/schedules` (`PUT` upsert, `GET` list/read, `PATCH` enable/disable, `DELETE`). `PUT` rather than `POST`, because the id is caller-supplied and the write is an upsert - re-sending a body is not a second schedule.

**Schedules are data, not code.** Nothing is seeded at boot: `server.ts` starts the ticker and `JobHandlerBootstrap` registers handlers, and that is all. A boot-time upsert was tried and removed, because it made deletion impossible to express - the API could create a schedule but the next deploy would resurrect anything an operator had removed. The cost is that a fresh database has no schedules until someone creates them, which is the honest trade: the collection now says exactly what will run.

Both surfaces run the same admission check: an unregistered job name is refused, and the payload is put through the handler's own `parsePayload`. The notes routes under `/admin/notes/reindex` stay as the notes-specific surface, since they carry their own body schema and 404 on a job of any other name.

**Creation validates what would otherwise fail at 03:00.** An unregistered job name is refused outright, because such a schedule would spawn jobs no worker can run, and those are claimed and released on a loop rather than failing visibly. The payload is run through the handler's own `parsePayload`, so a malformed one is a 400 at creation rather than a nightly failure. An interval below the tick interval is refused, since it cannot fire faster than the ticker anyway.

**`enabled` is insert-only**, so a re-registration cannot silently re-enable something an operator disabled. Toggling goes through `PATCH` alone. Re-enabling takes a fresh `next_run_at`, or a schedule disabled for a week would fire the instant it came back. Deleting a schedule removes the definition only - jobs it already spawned are independent rows and keep running. `ScheduleClock` is pure — recurrence arithmetic and the deadline computation, nothing else — so both are unit-tested with no database; `npm run jobs:smoke:scheduler` covers what needs a real one: two schedulers racing, overrun refusal, and the crash-between-insert-and-advance retry.

## 9. Gotchas

- **`TraceContext.enter()` is unusable here.** It wraps `enterWith`, which mutates ambient context and cannot be unwound, so two jobs starting in one tick silently swap each other's `user_id` on every log line. Each job runs inside `TraceContext.run()` with a fresh `trace_id` per *attempt* and `upstream_trace_id` linking back to the request that enqueued it.
- **A job whose handler is not registered is released, not failed** — handed back unrun and unpenalised, so a job name can ship before the code that runs it. The cost is that a permanently unregistered name loops quietly; queue-depth sampling should watch for names with queued rows and no handler.
- **An empty registry throws at startup.** Such a worker would claim every job and release every one unrun — a hot loop that looks healthy. `JOBS_WORKER_ENABLED=false` is the explicit way to run an enqueue-only process.
- **Handler registration rethrows** at bootstrap, unlike most startup steps which warn and continue. A handler that silently fails to register means its jobs stop being claimed with no error anywhere.
- **An empty payload needs `minimize: false` on the schema.** Mongoose strips empty objects on save, *after* validation, so `payload: {}` vanished from a `required: true` field and the handler's schema then rejected `undefined`. At the time it only bit the `create()` path, because the dedup route was then an upsert and `$setOnInsert` is a raw update operator that bypasses minimize. `enqueue` is now a plain `create()` in every case, so the flag is what keeps an empty payload alive at all. Both job models disable minimize; `jobs:smoke` pins the round trip.
- **A cancel is not immediate.** `requestCancel` flags a running job; its worker notices on the next heartbeat, so the route returns 202 before the job has stopped. A *queued* job cancels outright.

## 10. Deliberately deferred

- **Routing.** There is one undifferentiated pool and global FIFO, so a bulk import can occupy every worker and a cheap job queued behind it waits. Three designs were costed — lanes, capability filtering, tags — and each inserts a field into `job_claim` between `status` and `visible_at`, so adding one later is an index rebuild rather than a redesign. Tags are the nicest model and the most expensive query: an array field ahead of the sort key makes the index multikey, and the claim gains a blocking in-memory sort.
- **Vectorization still runs inline with note writes.** It is the obvious second handler, but nothing has moved yet.
- **Pre-enqueueing future windows — considered, rejected.** The scheduler could materialize tomorrow's run *today*, with `run_at` set to the future window, and let the worker's `visible_at <= now` hold it until due. It is tempting: the queue already accepts future-dated work via `delay_ms`, the scheduler would stop needing to be punctual, and upcoming runs would be queryable.

  It was rejected on semantics. A recurrence rule is not a finite list of jobs — it is an infinite sequence, so materializing ahead means choosing a horizon, and a horizon makes the queue a **materialized view over the rule**. From that point the two must be kept in sync: deleting a schedule has to cancel its queued runs, editing a cron has to rewrite them, disabling has to sweep. Today the rule is the single source of truth and work is produced lazily at the moment it becomes work, so nothing can drift.

  The benefits also did not survive inspection. Exactly-once was the strongest, and it turned out to be *separable* — `uniq_schedule_window` delivers it without projecting anything forward, which is why it is in §8 rather than here. "What runs tonight" is already answerable from `next_run_at`. Only the punctuality argument was real, and `deadline_at` covers what it was protecting against.

  **Where this flips:** the moment you want to manipulate *individual* future runs — skip just tomorrow's, move Friday's an hour later, show an operator an editable calendar. You cannot annotate an instance that does not exist, so that feature requires materialized future runs, and the cascade cost becomes one paid deliberately for a capability rather than incidentally for plumbing.
