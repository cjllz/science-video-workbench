#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(realpath -m -- "$DEPLOY_DIR/..")"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/.env.production}"

die() {
  echo "$*" >&2
  exit 1
}

load_deployment_environment() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

resolve_safe_directory() {
  local label="$1"
  local raw_value="${2:-}"
  [[ -n "$raw_value" && "$raw_value" == /* ]] || die "unsafe $label: use a non-empty absolute path"

  local resolved
  resolved="$(realpath -m -- "$raw_value")" || die "unsafe $label: path cannot be resolved"
  local resolved_home=""
  if [[ -n "${HOME:-}" ]]; then
    resolved_home="$(realpath -m -- "$HOME")"
  fi

  if [[ "$resolved" == "/" || "$resolved" == "$resolved_home" || "$resolved" == "$PROJECT_ROOT" ]]; then
    die "unsafe $label: root, home, and PROJECT_ROOT are forbidden"
  fi
  printf '%s\n' "$resolved"
}

assert_not_nested_in_data() {
  local label="$1"
  local candidate="$2"
  local data_directory="$3"
  if [[ "$candidate" == "$data_directory" || "$candidate" == "$data_directory/"* ]]; then
    die "unsafe $label: must not be inside DATA_DIR"
  fi
}

compose_cmd() {
  (
    cd -- "$PROJECT_ROOT"
    docker compose --env-file "$ENV_FILE" -f compose.yaml "$@"
  )
}

check_idle() {
  compose_cmd exec -T app npm run maintenance -- check-idle
}

wait_for_readiness() {
  local attempts="${1:-45}"
  local index
  for ((index = 1; index <= attempts; index += 1)); do
    if compose_cmd exec -T app curl --fail --silent http://127.0.0.1:8787/api/ready >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}
