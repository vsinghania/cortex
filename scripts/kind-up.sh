#!/usr/bin/env bash
#
# Bring up the local kind cluster end-to-end. Idempotent — safe to re-run.
#
# What it does:
#   1. Creates the kind cluster if missing.
#   2. Refreshes kubeconfig (needed after OrbStack restarts).
#   3. Builds the cortex image and loads it into the cluster's nodes.
#   4. Creates the namespace and the cortex-secrets Secret from .env.
#   5. Applies all manifests under deploy/k8s/base/.
#   6. Waits for rollouts to stabilize.
#
# Run from the repo root.

set -euo pipefail

CLUSTER_NAME="cortex"
NAMESPACE="cortex"
KIND_CONFIG="deploy/kind/kind-config.yaml"
ENV_FILE=".env"
SECRET_KEYS_REGEX='^(OPENAI_API_KEY|JWT_ACCESS_SECRET|MCP_NOTES_AUTH_TOKEN)='

require() {
  local cmd=$1
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "✗ '$cmd' not on PATH. Install it (e.g. brew install $cmd) and retry." >&2
    exit 1
  fi
}

require kind
require kubectl
require docker

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found. Copy .env.example to .env and fill in real secrets." >&2
  exit 1
fi

# 1. Cluster.
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "→ kind cluster '$CLUSTER_NAME' already exists, skipping create"
else
  echo "→ creating kind cluster '$CLUSTER_NAME'"
  kind create cluster --config "$KIND_CONFIG"
fi

# 2. Kubeconfig (idempotent; also fixes stale port after OrbStack restart).
echo "→ refreshing kubeconfig"
kind export kubeconfig --name "$CLUSTER_NAME" >/dev/null

# 3. Image build + load into cluster nodes.
echo "→ building cortex:dev"
docker build -t cortex:dev . >/dev/null

echo "→ loading cortex:dev into cluster nodes"
kind load docker-image cortex:dev --name "$CLUSTER_NAME"

# 4. Namespace + Secret.
echo "→ applying namespace"
kubectl apply -f deploy/k8s/base/namespace.yaml >/dev/null

echo "→ syncing cortex-secrets from $ENV_FILE"
TMP_ENV=$(mktemp)
trap 'rm -f "$TMP_ENV"' EXIT
grep -E "$SECRET_KEYS_REGEX" "$ENV_FILE" > "$TMP_ENV" || true
if [ ! -s "$TMP_ENV" ]; then
  echo "✗ no secret keys (OPENAI_API_KEY, JWT_ACCESS_SECRET, MCP_NOTES_AUTH_TOKEN) found in $ENV_FILE" >&2
  exit 1
fi
kubectl -n "$NAMESPACE" create secret generic cortex-secrets \
  --from-env-file="$TMP_ENV" --dry-run=client -o yaml \
  | kubectl apply -f - >/dev/null

# 5. App manifests.
echo "→ applying app manifests"
kubectl apply -f deploy/k8s/base/ >/dev/null

# 6. Wait for everything to be ready.
echo "→ waiting for rollouts to stabilize (up to 3 min each)"
kubectl -n "$NAMESPACE" rollout status statefulset/mongodb  --timeout=180s
kubectl -n "$NAMESPACE" rollout status deploy/mcp-notes     --timeout=180s
kubectl -n "$NAMESPACE" rollout status deploy/cortex-app    --timeout=180s

cat <<EOF

✓ kind cluster '$CLUSTER_NAME' is up and ready

  smoke test:
    kubectl -n $NAMESPACE port-forward svc/cortex-app 3000:80
    curl localhost:3000/healthz

  iterate after a code change:
    docker build -t cortex:dev . && \\
    kind load docker-image cortex:dev --name $CLUSTER_NAME && \\
    kubectl -n $NAMESPACE rollout restart deploy/cortex-app deploy/mcp-notes

  tear down:
    kind delete cluster --name $CLUSTER_NAME

EOF
