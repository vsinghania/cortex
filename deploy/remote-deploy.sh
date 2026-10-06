#!/usr/bin/env bash
#
# Runs ON cortex-ec2, as root, via SSM SendCommand. Staged to S3 per release by
# .github/workflows/deploy-api.yml and fetched by the SSM command.
#
# Contract:
#   in  — CORTEX_IMAGE, RELEASE_PREFIX, GIT_SHA (all required)
#   out — exit 0 only if every app service is healthy on the new image
#
# This script never runs `docker compose down`, and never `-v` under any
# circumstance. A bad deploy is fixed by dispatching deploy-api with the
# previous SHA, not by tearing the stack down.

set -euo pipefail

APP_DIR=/home/ssm-user/cortex
# On the box the file is named compose.yaml, one of the names `docker compose`
# discovers automatically — so an interactive `docker compose ps` works with no
# -f flag. In the repo it keeps the qualified name, where it has to be told
# apart from the dev and debug compose files.
COMPOSE_FILE=compose.yaml
RELEASE_COMPOSE=docker-compose.prod.yml
PROJECT=cortex
REGION=us-east-1
APP_SERVICES=(web-server mcp-notes worker)

: "${CORTEX_IMAGE:?CORTEX_IMAGE is required}"
: "${RELEASE_PREFIX:?RELEASE_PREFIX is required}"
: "${GIT_SHA:?GIT_SHA is required}"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# --- Guard rails -------------------------------------------------------------
# Compose derives its project name from the working directory. Running from the
# wrong place would create a second stack with empty volumes and bring the app
# up with no data, so assert the real one is here before touching anything.
cd "$APP_DIR" || { echo "FATAL: $APP_DIR missing"; exit 1; }
[ -f .env ]            || { echo "FATAL: $APP_DIR/.env missing — wrong host or wrong directory"; exit 1; }
[ -f "$COMPOSE_FILE" ] || { echo "FATAL: $COMPOSE_FILE missing"; exit 1; }
docker volume inspect "${PROJECT}_mongodb_data" >/dev/null 2>&1 \
  || { echo "FATAL: ${PROJECT}_mongodb_data not found — refusing to create a fresh stack"; exit 1; }

log "deploying $GIT_SHA"
log "image     $CORTEX_IMAGE"

# --- Stage the release -------------------------------------------------------
# Write-then-rename so a failed download never leaves a truncated compose file.
aws s3 cp "$RELEASE_PREFIX/$RELEASE_COMPOSE" "$COMPOSE_FILE.new" --region "$REGION" --quiet
mv "$COMPOSE_FILE.new" "$COMPOSE_FILE"

printf 'CORTEX_IMAGE=%s\n' "$CORTEX_IMAGE" > deploy.env.new
mv deploy.env.new deploy.env

# SSM runs this as root; without the chown an interactive ssm-user session can
# no longer edit the files it just wrote.
chown ssm-user:ssm-user "$COMPOSE_FILE" deploy.env 2>/dev/null || true

# --- Registry auth -----------------------------------------------------------
# Required every deploy. The instance role grants ECR permission, but Docker
# does not use instance credentials for registry auth on its own, and tokens
# last only 12 hours — so a deploy after an idle gap would fail on pull.
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${CORTEX_IMAGE%%/*}" >/dev/null
log "authenticated to ECR"

compose() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" \
    --env-file .env --env-file deploy.env "$@"
}

# --- Validate, pull, apply ---------------------------------------------------
compose config -q
log "compose config valid"

# Scoped on purpose: never a bare `pull`. The datastores are digest-pinned, so a
# bare pull is safe in principle, but the intent of an app deploy is to update
# the app — keeping that explicit is worth naming the app services.
compose pull "${APP_SERVICES[@]}"
log "pulled ${APP_SERVICES[*]}"

compose up -d --remove-orphans
log "applied"

# --- Health gate -------------------------------------------------------------
# The container needs time to boot, so poll rather than checking once. Match the
# body, not just the status code: the handler is res.send('ok').
ok=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/healthz 2>/dev/null | grep -qx ok; then
    ok=1
    break
  fi
  sleep 2
done
[ "$ok" = 1 ] && log "web-server healthy" || log "web-server FAILED health check"

# mcp-notes is token-gated, so any HTTP response proves the listener is up.
# curl reports 000 for connection refused, which is the failure we care about.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3010/mcp || echo 000)
if [ "$code" = "000" ]; then
  ok=0
  log "mcp-notes FAILED — no response on 3010"
else
  log "mcp-notes responding (HTTP $code)"
fi

# A container that starts and immediately dies will pass a single curl if the
# timing is unlucky, so check it is not crash-looping. For the worker, which has
# no listener to probe, this - plus being up at all - is the whole health check.
for svc in "${APP_SERVICES[@]}"; do
  cid=$(compose ps -q "$svc" || true)
  running=$(docker inspect --format '{{.State.Running}}' "$cid" 2>/dev/null || echo false)
  restarts=$(docker inspect --format '{{.RestartCount}}' "$cid" 2>/dev/null || echo 99)
  if [ "$running" != true ]; then
    ok=0
    log "$svc is not running"
  elif [ "${restarts:-99}" -gt 2 ]; then
    ok=0
    log "$svc is crash-looping (RestartCount=$restarts)"
  fi
done

if [ "$ok" != 1 ]; then
  log "DEPLOY FAILED — the stack is running $GIT_SHA and is unhealthy."
  log "Recover by dispatching deploy-api with the previous known-good SHA."
  compose ps
  # Capped: SSM truncates each output stream at ~24k characters, and the verdict
  # above must not be pushed off the end of the Actions log by container logs.
  compose logs --tail=50 --no-color "${APP_SERVICES[@]}" 2>&1 | tail -c 8000
  exit 1
fi

log "OK — $GIT_SHA deployed and healthy"
