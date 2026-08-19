#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(realpath -m -- "$DEPLOY_DIR/..")"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_ROOT/compose.yaml}"

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

require_data_layout() {
  local label="$1"
  local directory="$2"
  local sentinel=""
  if [[ -f "$directory/.science-video-workbench-data" ]]; then
    sentinel="$(tr -d '\r\n' <"$directory/.science-video-workbench-data")"
  fi
  [[ "$sentinel" == "science-video-workbench-data-v1" ]] || die "$label is missing the required data sentinel"
  [[ -f "$directory/studio.sqlite" ]] || die "$label is missing studio.sqlite"
  [[ -d "$directory/outputs" && -d "$directory/materials" ]] || die "$label has an incomplete directory layout"
}

assert_data_owner() {
  local directory="$1"
  local owner
  owner="$(stat -c '%u:%g' "$directory")"
  [[ "$owner" == "10001:10001" ]] || die "unsafe DATA_DIR ownership: expected 10001:10001"
}

assert_compose_data_bind() {
  local expected="$1"
  local container_id
  container_id="$(compose_cmd ps -q app)"
  [[ -n "$container_id" ]] || die "app container is not running"
  local mounted
  mounted="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' "$container_id")"
  [[ -n "$mounted" ]] || die "app container has no /app/data bind mount"
  mounted="$(realpath -m -- "$mounted")"
  [[ "$mounted" == "$expected" ]] || die "unsafe DATA_DIR: configured path does not match the running app bind mount"
}

compose_cmd() {
  (
    cd -- "$PROJECT_ROOT"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
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
