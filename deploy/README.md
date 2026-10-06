# deploy

Compose stacks for running Cortex outside local dev.

- [aws.md](aws.md) — the current Phase 1 AWS deployment: architecture, access, and the CI/CD flow.
- [docker-compose.prod.yml](docker-compose.prod.yml) — the production stack (web-server, worker, mcp-notes, mongodb, qdrant). Shipped to the instance by `deploy-api`, where it lands as `compose.yaml`.
- [remote-deploy.sh](remote-deploy.sh) — runs on the instance under SSM to apply a release; not intended to be run by hand.
- [docker-compose.debug.yml](docker-compose.debug.yml) — overlay that adds a Node inspector; never run on its own.

## Running the production stack

Normally you don't — **Actions → deploy-api** does it. See [aws.md §8](aws.md).

On the box, `compose.yaml` is auto-discovered and `/etc/profile.d/cortex.sh`
supplies the project name and env files, so read-only commands work from anywhere:

```sh
docker compose ps
docker compose logs -f --tail=50 web-server
```

State-changing commands need the app directory, and both env files:

```sh
cd /home/ssm-user/cortex
docker compose --env-file .env --env-file deploy.env pull web-server mcp-notes worker
docker compose --env-file .env --env-file deploy.env up -d
```

Pull the app services by name, never bare — the intent of a deploy is to update
the app, not the datastores. No inspector is running in this mode; the debug ports
9229/9230 do not exist.

## Attaching a debugger

Layer the debug overlay on top; it adds `NODE_OPTIONS=--inspect` and publishes the
inspector on the instance's loopback only. The overlay is not shipped by CI, so
copy it to the box first:

```sh
docker compose -f compose.yaml -f docker-compose.debug.yml up -d
```

Then, from your laptop, forward the port over SSM (never open 9229/9230 in the
security group) and attach VS Code to `localhost:9229`:

```sh
aws ssm start-session \
  --target <instance-id> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["9229"],"localPortNumber":["9229"]}'
```

mcp-notes' inspector is published on the host as 9230 (forward that instead to
debug it). Drop back to the plain `up -d` above to remove the inspector when done.

## Known gaps (Phase 1 backlog)

Deliberately deferred, not forgotten. Each is safe to leave for now given a
single trusted operator and low traffic; the note is so the reason and the fix
survive.

### Data durability — daily snapshots (closed)

Mongo and Qdrant data live in Docker named volumes on the instance's single gp3
root volume, so losing that volume loses every note and vector.

A Data Lifecycle Manager policy now snapshots the whole instance daily (targeted
by the `Name=cortex-ec2` tag, boot volume included, 7-day retention). Recovery is
`create-volume` from a snapshot, not a rebuild from nothing.

    aws ec2 describe-snapshots --owner-ids self \
      --filters "Name=tag:created-by,Values=dlm-cortex-daily" \
      --query 'sort_by(Snapshots,&StartTime)[-1].{id:SnapshotId,started:StartTime,state:State}'

Still open, and worth doing once: **restore a snapshot to a scratch volume and
confirm the Mongo and Qdrant directories are really in it.** An untested backup is
a hypothesis. A selective `mongodump`/qdrant-snapshot to S3 remains the more
granular alternative if per-collection recovery is ever needed.

### App home under `/home/ssm-user`

The stack lives in `/home/ssm-user/cortex/`. That directory is created and owned
by the SSM Agent and is not a stable application home — an agent reinstall or a
different SSM identity can move or reset it, taking the volumes' bind context
with it.

- **Fix:** relocate to `/opt/cortex` (root-owned, purpose-neutral, survives SSM
  changes). One-time move of `compose.yaml`, `.env`, `deploy.env` and the volume
  directory — plus `APP_DIR` in [remote-deploy.sh](remote-deploy.sh) and the paths
  in `/etc/profile.d/cortex.sh`, or deploys break silently after the move.

### ALB idle timeout vs. long agent runs

The ALB's default idle timeout is 60s. Agent runs over `/api/v1/agent` that
exceed it will surface to the client as a 504, even though the backend is still
working. No SSE is in the request path today, so this only bites on a single
slow synchronous call.

- **Decide:** raise the target group / ALB idle timeout (e.g. 120–180s), or keep
  60s and make sure no agent endpoint blocks that long. Revisit if streaming is
  added.

### ECR hygiene — half closed

Image tagging is solved: `build-image` tags every image with the full commit SHA,
`deploy.env` records which one is running, and rollback is a `deploy-api` dispatch
with an older SHA. No `:latest` anywhere.

What remains is growth. Every push to `main` pushes an image, and nothing expires.

- **Fix:** an ECR lifecycle policy expiring **untagged** images after ~7 days. Safe
  by construction — an image only becomes untagged when a tag moves off it, so
  nothing deployable is ever removed.
- **Do not** add an `imageCountMoreThan` rule casually: it evaluates by push date,
  not by what is running, so a long-lived deployment plus a burst of builds can
  delete the image production was created from — breaking both container recreation
  after a reboot and rollback to that SHA.

### No tests gating production

The only CI gates are `tsc` on both trees, the SPA build, and one unit test. A
deploy's health gate is `/healthz`, which returns `ok` without touching Mongo,
Qdrant or OpenAI — so a deploy that breaks the database connection still passes.

- **Until then:** manual promotion is the real gate. Smoke-test after deploying
  anything non-trivial (`npm run mcp:smoke`, the Bruno collection against
  `api.cortexapp.me`).
- **Fix:** a `/readyz` that pings Mongo and Qdrant, used by both the compose
  healthcheck and the deploy gate; then real tests worth blocking on.

### MCP notes perimeter is a single shared token

Now that `VOICE_MCP_PUBLIC_URL` is live, `/api/v1/mcp/notes` is internet-facing
and gated only by `MCP_NOTES_AUTH_TOKEN`, with the tenant chosen by an
`X-User-Id` header the caller controls — anyone holding the token can act as any
user. See [../docs/mcp.md](../docs/mcp.md) §2 and [../docs/voice.md](../docs/voice.md) §4.

- **Fix (real work, not a config tweak):** bind MCP identity to the credential
  instead of trusting a header — the token should determine the user, not
  accompany a user id. This is application-layer, tracked with the voice/MCP
  work rather than here.
- **Until then:** keep the token long, random and out of shared shells/tunnels;
  rotate if it leaks.
