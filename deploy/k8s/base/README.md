# Local kind cluster — Phase 1

These manifests bring up cortex-app, mcp-notes, and mongodb in a local `kind` cluster. Mirrors the docker-compose stack at the repo root, one k8s primitive at a time. External reachability is via `kubectl port-forward`; ingress + DNS + TLS land in Phase 3 against real cloud infra.

> **Use kind on demand, not as your dev environment.** Daily app iteration is fastest via `npm run dev` (native, ~1s reload) or `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` (containerized hot-reload, also ~1s). Bring kind up only when you want to exercise k8s-specific behavior (rollouts, probes, manifest changes).

## Prerequisites

- OrbStack (or Docker Desktop) running
- CLIs on PATH:
  ```
  brew install kind kubectl
  ```

## Quick start (scripted)

```sh
./scripts/kind-up.sh
```

Idempotent: creates the cluster if missing, builds + loads the image, syncs secrets from `.env`, applies manifests, waits for rollouts. Re-run after any manifest change to re-apply.

## One-time bootstrap (manual, for understanding)

```sh
# 1. Create the cluster.
#    Config: 1 control-plane + 2 workers.
kind create cluster --config deploy/kind/kind-config.yaml

# 2. Build the image and load it into the kind cluster's nodes.
#    kind nodes can't pull from local docker; this command copies the
#    local image into each node's containerd store.
docker build -t cortex:dev .
kind load docker-image cortex:dev --name cortex

# 3. Create the cortex namespace explicitly (so the secret can be
#    created before apply).
kubectl apply -f deploy/k8s/base/namespace.yaml

# 4. Create the application Secret from your local .env (gitignored).
#    Important: only load the actual secret keys. Loading the whole
#    .env would also include non-secret keys like MONGO_HOST=localhost,
#    which would override the ConfigMap (Secret values win in envFrom)
#    and break in-cluster DNS resolution for mongo.
grep -E '^(OPENAI_API_KEY|JWT_ACCESS_SECRET|MCP_NOTES_AUTH_TOKEN)=' .env > /tmp/cortex-secrets.env
kubectl -n cortex create secret generic cortex-secrets --from-env-file=/tmp/cortex-secrets.env
rm /tmp/cortex-secrets.env

# To update the Secret later (e.g. after rotating a token), re-run
# idempotently:
#   grep -E '^(OPENAI_API_KEY|JWT_ACCESS_SECRET|MCP_NOTES_AUTH_TOKEN)=' .env > /tmp/cortex-secrets.env
#   kubectl -n cortex create secret generic cortex-secrets \
#     --from-env-file=/tmp/cortex-secrets.env --dry-run=client -o yaml | kubectl apply -f -
#   rm /tmp/cortex-secrets.env
#   kubectl -n cortex rollout restart deploy/cortex-app deploy/mcp-notes

# 5. Apply the app objects.
kubectl apply -f deploy/k8s/base/

# 6. Watch pods come up.
kubectl -n cortex get pods -w
```

## Smoke test

```sh
# Port-forward the cortex-app Service to your laptop.
kubectl -n cortex port-forward svc/cortex-app 3000:80
# In another terminal:
curl localhost:3000/healthz
curl localhost:3000/api/v1/health/db

# Mongo ping from inside the StatefulSet.
kubectl -n cortex exec mongodb-0 -- mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok'

# In-cluster reachability: cortex-app -> mcp-notes via service DNS.
kubectl -n cortex exec deploy/cortex-app -- \
  wget -qO- --header="Authorization: Bearer $(kubectl -n cortex get secret cortex-secrets -o jsonpath='{.data.MCP_NOTES_AUTH_TOKEN}' | base64 -d)" \
  http://mcp-notes:3010/mcp || true
```

## Iterating on code changes

```sh
docker build -t cortex:dev .
kind load docker-image cortex:dev --name cortex
kubectl -n cortex rollout restart deploy/cortex-app
kubectl -n cortex rollout restart deploy/mcp-notes
kubectl -n cortex rollout status deploy/cortex-app
```

`rollout restart` triggers a rolling update — new pod boots, passes its readiness probe, then the old pod terminates. Zero downtime if probes are healthy.

## Tear down

```sh
kubectl delete -f deploy/k8s/base/      # remove app objects (namespace + everything in it)
kind delete cluster --name cortex       # nuke the whole cluster
```

## Notes

- **Secret hygiene.** `cortex-secrets` is never committed; it is created from your local `.env` via `kubectl create secret generic`. Phase 3 (EKS) keeps the same approach for the first cut; later phases swap in External Secrets Operator pulling from AWS Secrets Manager.
- **No ingress on local.** Kept the kind setup focused on core primitives (Deployments, Services, ConfigMap, Secret, StatefulSet, PVC). Ingress + cert-manager + Let's Encrypt land together in Phase 3 against real cloud infra where each piece has an obvious job.

## Migrating data from the docker-compose stack

If you want the data already in your local Compose Mongo to show up in the kind Mongo:

```sh
# Dump from the compose Mongo (run from the repo root).
docker compose exec mongodb mongodump --archive > /tmp/mongo.archive

# Restore into the kind Mongo.
kubectl -n cortex exec -i mongodb-0 -- mongorestore --archive < /tmp/mongo.archive
```
