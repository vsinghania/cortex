# deploy

Compose stacks and manifests for running Cortex outside local dev.

- [aws.md](aws.md) — the current Phase 1 AWS deployment: architecture, access, and the build/push/deploy flow.
- [docker-compose.prod.yml](docker-compose.prod.yml) — the production stack (web-server, mcp-notes, mongodb, qdrant) that runs on the EC2 instance.
- [docker-compose.debug.yml](docker-compose.debug.yml) — overlay that adds a Node inspector; never run on its own.
- [k8s/](k8s/) and [kind/](kind/) — Kubernetes manifests and a local kind cluster (Phase 3+, not the current deployment).

## Running the production stack

From the app directory on the instance (`$CORTEX_IMAGE` and the secrets come from `.env`):

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

No inspector is running in this mode — the debug ports 9229/9230 do not exist.

## Attaching a debugger

Layer the debug overlay on top; it adds `NODE_OPTIONS=--inspect` and publishes the
inspector on the instance's loopback only:

```sh
docker compose -f docker-compose.prod.yml -f docker-compose.debug.yml up -d
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
  changes). One-time move of `compose.yml`, `.env` and the volume directory.

### ALB idle timeout vs. long agent runs

The ALB's default idle timeout is 60s. Agent runs over `/api/v1/agent` that
exceed it will surface to the client as a 504, even though the backend is still
working. No SSE is in the request path today, so this only bites on a single
slow synchronous call.

- **Decide:** raise the target group / ALB idle timeout (e.g. 120–180s), or keep
  60s and make sure no agent endpoint blocks that long. Revisit if streaming is
  added.

### Image tagging and ECR hygiene

`CORTEX_IMAGE` currently resolves to whatever tag the deploy pushes. If that is
`:latest`, rollback means rebuilding, and `docker compose pull` can be ambiguous
about what is actually running.

- **Fix:** tag images with the git SHA (`cortex-app:<sha>`) so a rollback is a
  one-line `CORTEX_IMAGE` change to a known-good digest, and add an ECR lifecycle
  policy to expire untagged layers so the repo does not grow without bound.

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
