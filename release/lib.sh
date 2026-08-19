#!/usr/bin/env bash
set -Eeuo pipefail

BUNDLE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
INSTALL_ROOT="${INSTALL_ROOT:-/srv/science-video-workbench/app}"
ENV_FILE="${ENV_FILE:-$INSTALL_ROOT/deploy/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$INSTALL_ROOT/compose.release.yaml}"
DATA_SENTINEL="science-video-workbench-data-v1"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "$(id -u)" == "0" ]] || die "run this command with sudo"
}

require_linux() {
  [[ "$(uname -s)" == "Linux" ]] || die "this release supports Linux only"
}

require_amd64() {
  [[ "$(uname -m)" =~ ^(x86_64|amd64)$ ]] || die "this release supports linux/amd64 only"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

resolve_safe_directory() {
  local label="$1"
  local raw_value="${2:-}"
  [[ -n "$raw_value" && "$raw_value" == /* ]] || die "unsafe $label: use a non-empty absolute path"

  local resolved resolved_home=""
  resolved="$(realpath -m -- "$raw_value")" || die "unsafe $label: path cannot be resolved"
  if [[ -n "${HOME:-}" ]]; then
    resolved_home="$(realpath -m -- "$HOME")"
  fi
  if [[ "$resolved" == "/" || "$resolved" == "$resolved_home" || "$resolved" == "$(realpath -m -- "$INSTALL_ROOT")" ]]; then
    die "unsafe $label: root, home, and INSTALL_ROOT are forbidden"
  fi
  printf '%s\n' "$resolved"
}

assert_not_nested() {
  local left_label="$1" left="$2" right_label="$3" right="$4"
  if [[ "$left" == "$right" || "$left" == "$right/"* || "$right" == "$left/"* ]]; then
    die "unsafe paths: $left_label and $right_label must be separate"
  fi
}

require_data_layout() {
  local directory="$1"
  local sentinel=""
  if [[ -f "$directory/.science-video-workbench-data" ]]; then
    sentinel="$(tr -d '\r\n' <"$directory/.science-video-workbench-data")"
  fi
  [[ "$sentinel" == "$DATA_SENTINEL" ]] || die "DATA_DIR is missing the required data sentinel"
}

load_environment() {
  [[ -f "$ENV_FILE" ]] || die "production environment is missing: $ENV_FILE; run ./configure.sh first"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

compose_cmd() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

wait_for_readiness() {
  local attempts="${1:-60}" index
  for ((index = 1; index <= attempts; index += 1)); do
    if compose_cmd exec -T app curl --fail --silent http://127.0.0.1:8787/api/ready >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

validate_scalar() {
  local label="$1" value="${2:-}"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "$label cannot contain a newline"
}

replace_environment_value() {
  local key="$1" value="$2" temporary
  validate_scalar "$key" "$value"
  temporary="$ENV_FILE.tmp.$$"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" >"$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$ENV_FILE"
}
