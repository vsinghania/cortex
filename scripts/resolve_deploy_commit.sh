#!/usr/bin/env bash
set -euo pipefail

requested_ref="${DEPLOY_REF:-main}"
commit_sha=$(git rev-parse --verify --quiet --end-of-options "${requested_ref}^{commit}" \
  || git rev-parse --verify --quiet --end-of-options "origin/${requested_ref}^{commit}" \
  || true)

if [ -z "$commit_sha" ]; then
  printf '::error::The requested deployment ref could not be resolved.\n' >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$commit_sha" origin/main; then
  printf '::error::Deployments require a commit already merged into main.\n' >&2
  exit 1
fi

printf 'sha=%s\n' "$commit_sha" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
git checkout --detach "$commit_sha"
git log -1 --format='%h %s' "$commit_sha"
