#!/usr/bin/env bash
set -Eeuo pipefail

BUNDLE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
INSTALL_ROOT="${INSTALL_ROOT:-/srv/science-video-workbench/app}"
ENV_FILE="${ENV_FILE:-$INSTALL_ROOT/deploy/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$INSTALL_ROOT/compose.yaml}"
DATA_SENTINEL="science-video-workbench-data-v1"
BACKUP_SENTINEL="science-video-workbench-backups-v1"

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
  local resolved_install
  resolved_install="$(realpath -m -- "$INSTALL_ROOT")"
  if [[ "$resolved" == "/" || "$resolved" == "$resolved_home" || "$resolved" == "$resolved_install" \
    || "$resolved" == "$resolved_install/"* || "$resolved_install" == "$resolved/"* ]]; then
    die "unsafe $label: root, home, and paths overlapping INSTALL_ROOT are forbidden"
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

require_backup_layout() {
  local directory="$1"
  local sentinel=""
  if [[ -f "$directory/.science-video-workbench-backups" ]]; then
    sentinel="$(tr -d '\r\n' <"$directory/.science-video-workbench-backups")"
  fi
  [[ "$sentinel" == "$BACKUP_SENTINEL" ]] || die "BACKUP_DIR is missing the required backup sentinel"
}

initialize_data_directory() {
  local directory="$1"
  [[ ! -e "$directory" || -d "$directory" ]] || die "DATA_DIR is not a directory: $directory"
  if [[ -d "$directory" ]]; then
    if [[ -e "$directory/.science-video-workbench-data" ]]; then
      require_data_layout "$directory"
    elif find "$directory" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
      die "DATA_DIR is not empty and has no project data sentinel: $directory"
    fi
  fi
  install -d -m 0750 -o 10001 -g 10001 "$directory" "$directory/outputs" "$directory/materials"
  printf '%s\n' "$DATA_SENTINEL" >"$directory/.science-video-workbench-data"
  chown 10001:10001 "$directory/.science-video-workbench-data"
}

initialize_backup_directory() {
  local directory="$1"
  [[ ! -e "$directory" || -d "$directory" ]] || die "BACKUP_DIR is not a directory: $directory"
  if [[ -d "$directory" ]]; then
    if [[ -e "$directory/.science-video-workbench-backups" ]]; then
      require_backup_layout "$directory"
    elif find "$directory" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
      die "BACKUP_DIR is not empty and has no project backup sentinel: $directory"
    fi
  fi
  install -d -m 0750 "$directory"
  printf '%s\n' "$BACKUP_SENTINEL" >"$directory/.science-video-workbench-backups"
  chmod 0600 "$directory/.science-video-workbench-backups"
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
  [[ "$value" != *"'"* ]] || die "$label cannot contain a single quote"
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
