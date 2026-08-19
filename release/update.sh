#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
require_linux
require_amd64
for command in docker realpath install awk cp date; do require_command "$command"; done
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
load_environment

[[ -f "$SCRIPT_DIR/VERSION" ]] || die "release VERSION file is missing"
new_version="$(tr -d '\r\n' <"$SCRIPT_DIR/VERSION")"
[[ "$new_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "release VERSION is invalid"

compose_cmd exec -T app npm run maintenance -- check-idle
previous_version="$APP_VERSION"
previous_image_id="$(docker image inspect "$APP_IMAGE:$APP_VERSION" --format '{{.Id}}' 2>/dev/null || true)"
[[ -x "$INSTALL_ROOT/deploy/backup.sh" ]] || die "backup.sh is missing from the installation"
backup_output="$(COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" "$INSTALL_ROOT/deploy/backup.sh")"
backup_archive="${backup_output##*$'\n'}"
[[ -f "$backup_archive" && -f "$backup_archive.sha256" ]] || die "pre-update backup archive was not produced"
environment_backup="$ENV_FILE.pre-update-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p -- "$ENV_FILE" "$environment_backup"

print_rollback_instructions() {
  printf 'update failed; previous image id: %s\n' "${previous_image_id:-unknown}" >&2
  printf 'previous version: %s\n' "$previous_version" >&2
  printf 'data backup: %s\n' "$backup_archive" >&2
  printf 'restore configuration: cp -p -- %q %q\n' "$environment_backup" "$ENV_FILE" >&2
  printf 'restart previous image: docker compose --env-file %q -f %q up -d --force-recreate\n' "$ENV_FILE" "$COMPOSE_FILE" >&2
  printf 'if data rollback is required: %q %q --confirm-restore\n' "$INSTALL_ROOT/deploy/restore.sh" "$backup_archive" >&2
}

handle_update_error() {
  local status=$?
  trap - ERR
  print_rollback_instructions
  exit "$status"
}
trap handle_update_error ERR

install -m 0644 "$SCRIPT_DIR/compose.release.yaml" "$INSTALL_ROOT/compose.yaml"
install -m 0644 "$SCRIPT_DIR/Caddyfile" "$INSTALL_ROOT/Caddyfile"
install -m 0644 "$SCRIPT_DIR/VERSION" "$INSTALL_ROOT/VERSION"
for name in lib.sh configure.sh install.sh update.sh uninstall.sh; do
  install -m 0755 "$SCRIPT_DIR/$name" "$INSTALL_ROOT/$name"
done
if [[ -d "$SCRIPT_DIR/deploy" ]]; then
  for name in backup.sh restore.sh lib.sh; do
    [[ -f "$SCRIPT_DIR/deploy/$name" ]] && install -m 0755 "$SCRIPT_DIR/deploy/$name" "$INSTALL_ROOT/deploy/$name"
  done
fi
replace_environment_value APP_VERSION "$new_version"
load_environment

compose_cmd config --quiet
compose_cmd pull
compose_cmd up -d --force-recreate
if ! wait_for_readiness 60; then
  print_rollback_instructions
  exit 1
fi
trap - ERR
printf 'update completed: %s\n' "$new_version"
