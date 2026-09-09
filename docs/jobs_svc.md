# jobs_svc — durable background work

A Mongo-backed job queue with an in-process worker. Work is enqueued from a request, survives the deploy that interrupts it, and resumes where it stopped.

Source: [src/jobs_svc/](../src/jobs_svc/). First workload: the admin notes re-index ([src/notes_svc/jobs/](../src/notes_svc/jobs/)), exposed at `/api/v1/admin/notes/*` ([web.md](web.md)).

```
enqueue ──► jobs collection ◄── claim ── JobWorker ──► JobHandlerRegistry ──► handler
(any process)      │                        │              (registered at bootstrap)
                   │                        └─ lease heartbeat: flush progress,
                   └─ TTL reaps terminal jobs             read cancel, extend lease
```

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
3. Register it in `Server.registerJobHandlers()`. That step **rethrows** rather than warning — see the gotcha below.

Payloads carry references (ids), never snapshots, so a job re-reads current state when it runs. And **re-parse the payload even though the controller already validated it**: it round-trips through `Schema.Types.Mixed` and can outlive a schema change while sitting in the queue, which makes storage an untrusted boundary like any other. That is not theoretical — BSON serializes `undefined` to `null`, so an absent optional filter comes back as `null` and a bare `.optional()` rejects it. Use `.nullish()`.

## 8. Gotchas

- **`TraceContext.enter()` is unusable here.** It wraps `enterWith`, which mutates ambient context and cannot be unwound, so two jobs starting in one tick silently swap each other's `user_id` on every log line. Each job runs inside `TraceContext.run()` with a fresh `trace_id` per *attempt* and `upstream_trace_id` linking back to the request that enqueued it.
- **A job whose handler is not registered is released, not failed** — handed back unrun and unpenalised, so a job name can ship before the code that runs it. The cost is that a permanently unregistered name loops quietly; queue-depth sampling should watch for names with queued rows and no handler.
- **An empty registry throws at startup.** Such a worker would claim every job and release every one unrun — a hot loop that looks healthy. `JOBS_WORKER_ENABLED=false` is the explicit way to run an enqueue-only process.
- **Handler registration rethrows** at bootstrap, unlike most startup steps which warn and continue. A handler that silently fails to register means its jobs stop being claimed with no error anywhere.
- **A cancel is not immediate.** `requestCancel` flags a running job; its worker notices on the next heartbeat, so the route returns 202 before the job has stopped. A *queued* job cancels outright.

## 9. Deliberately deferred

- **Recurring/cron jobs.** Designed but not built: a `job_schedules` collection whose due rows a scheduler materializes into `jobs`. `pruneExpired()` in [refresh_token_repository.ts](../src/auth_svc/repositories/refresh_token_repository.ts) still has zero callers because nothing schedules it.
- **Routing.** There is one undifferentiated pool and global FIFO, so a bulk import can occupy every worker and a cheap job queued behind it waits. Three designs were costed — lanes, capability filtering, tags — and each inserts a field into `job_claim` between `status` and `visible_at`, so adding one later is an index rebuild rather than a redesign. Tags are the nicest model and the most expensive query: an array field ahead of the sort key makes the index multikey, and the claim gains a blocking in-memory sort.
- **Vectorization still runs inline with note writes.** It is the obvious second handler, but nothing has moved yet.
