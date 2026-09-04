# Resolve the account-specific AWS values into the current shell, so day-to-day
# deploy commands can use $INSTANCE_ID, $ECR_IMAGE, $SPA_BUCKET, etc. instead of
# looking them up by hand every time.
#
# SOURCE it, do not execute it — the whole point is to export vars into your shell:
#
#   source scripts/aws-env.sh          # from the repo root
#
# Reads the two non-derivable values from deploy/aws.env and derives the rest
# (account id, ECR registry, running EC2 instance id) from the CLI. Needs a live
# SSO session (run `aws sso login` if it has expired). Works in bash and zsh.
# See deploy/aws.md.

# --- Portable sourced-vs-executed detection and self-path resolution ---
# zsh-specific expansion is hidden inside eval strings so bash never parses it.
__cortex_sourced=0
__cortex_self=""
if [ -n "${ZSH_VERSION:-}" ]; then
  case "${ZSH_EVAL_CONTEXT:-}" in *:file*) __cortex_sourced=1 ;; esac
  __cortex_self=$(eval 'printf "%s" "${(%):-%x}"')
elif [ -n "${BASH_VERSION:-}" ]; then
  [ "${BASH_SOURCE[0]}" != "${0}" ] && __cortex_sourced=1
  __cortex_self="${BASH_SOURCE[0]}"
fi

if [ "$__cortex_sourced" -ne 1 ]; then
  echo "✗ Run this with 'source scripts/aws-env.sh' — executing it directly cannot export into your shell." >&2
  unset __cortex_sourced __cortex_self
  return 1 2>/dev/null || exit 1
fi

# Everything runs in the caller's shell, so it must not use 'set -e' or 'exit'
# (that would kill the terminal). Wrapped in a function that 'return's on error;
# unset at the end so it leaves no trace.
__cortex_load_aws_env() {
  local self_path="$1"
  local repo_root config_file

  if ! command -v aws >/dev/null 2>&1; then
    echo "✗ 'aws' not on PATH. Install the AWS CLI and retry." >&2
    return 1
  fi

  if [ -n "$self_path" ]; then
    repo_root=$(cd "$(dirname "$self_path")/.." && pwd)
  else
    repo_root="$PWD"
  fi
  config_file="$repo_root/deploy/aws.env"

  if [ ! -f "$config_file" ]; then
    echo "✗ $config_file not found. Copy the template and fill it in:" >&2
    echo "    cp deploy/aws.env.example deploy/aws.env" >&2
    return 1
  fi

  # shellcheck disable=SC1090
  set -a; . "$config_file"; set +a

  : "${AWS_REGION:=us-east-1}"
  : "${ECR_REPO:=cortex-app}"
  : "${EC2_NAME_TAG:=cortex-ec2}"

  if [ -z "${SPA_BUCKET:-}" ] || [ -z "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]; then
    echo "✗ SPA_BUCKET and CLOUDFRONT_DISTRIBUTION_ID must be set in $config_file (see deploy/aws.env.example)." >&2
    return 1
  fi

  echo "→ resolving AWS values (profile=${AWS_PROFILE:-default}, region=$AWS_REGION)"

  local account_id
  if ! account_id=$(aws sts get-caller-identity --query Account --output text --region "$AWS_REGION" 2>/dev/null); then
    echo "✗ Could not reach AWS. Your SSO session has likely expired — run 'aws sso login' and retry." >&2
    return 1
  fi

  local instance_id
  instance_id=$(aws ec2 describe-instances \
    --region "$AWS_REGION" \
    --filters "Name=tag:Name,Values=$EC2_NAME_TAG" "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null)

  if [ -z "$instance_id" ] || [ "$instance_id" = "None" ]; then
    echo "⚠ No running EC2 instance tagged Name=$EC2_NAME_TAG found — INSTANCE_ID left unset." >&2
    instance_id=""
  elif [ "$(printf '%s' "$instance_id" | wc -w)" -gt 1 ]; then
    instance_id=$(printf '%s' "$instance_id" | awk '{print $1}')
    echo "⚠ Multiple running instances tagged Name=$EC2_NAME_TAG; using the first ($instance_id)." >&2
  fi

  export AWS_REGION
  export AWS_ACCOUNT_ID="$account_id"
  export ECR_REPO
  export ECR_REGISTRY="${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  export ECR_IMAGE="${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
  export EC2_NAME_TAG
  export INSTANCE_ID="$instance_id"
  export SPA_BUCKET
  export CLOUDFRONT_DISTRIBUTION_ID

  cat <<SUMMARY

✓ AWS deploy values exported into this shell:

    AWS_ACCOUNT_ID             = $AWS_ACCOUNT_ID
    AWS_REGION                 = $AWS_REGION
    INSTANCE_ID                = ${INSTANCE_ID:-<none found>}
    ECR_IMAGE                  = $ECR_IMAGE
    SPA_BUCKET                 = $SPA_BUCKET
    CLOUDFRONT_DISTRIBUTION_ID = $CLOUDFRONT_DISTRIBUTION_ID

  Day-to-day commands are in deploy/aws.md ("Day-to-day cheat sheet").
SUMMARY
}

__cortex_load_aws_env "$__cortex_self"; __cortex_rc=$?
unset -f __cortex_load_aws_env
unset __cortex_sourced __cortex_self
case "$__cortex_rc" in
  0) unset __cortex_rc; return 0 ;;
  *) unset __cortex_rc; return 1 ;;
esac
