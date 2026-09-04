# deploy

Compose stacks and manifests for running Cortex outside local dev.

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
