#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
require_linux
require_amd64
for command in docker realpath install awk; do require_command "$command"; done
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
load_environment

[[ -f "$SCRIPT_DIR/VERSION" ]] || die "release VERSION file is missing"
new_version="$(tr -d '\r\n' <"$SCRIPT_DIR/VERSION")"
[[ "$new_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "release VERSION is invalid"

compose_cmd exec -T app npm run maintenance -- check-idle
previous_image_id="$(docker image inspect "$APP_IMAGE:$APP_VERSION" --format '{{.Id}}' 2>/dev/null || true)"
[[ -x "$INSTALL_ROOT/deploy/backup.sh" ]] || die "backup.sh is missing from the installation"
COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" "$INSTALL_ROOT/deploy/backup.sh"

for name in compose.release.yaml Caddyfile; do
  install -m 0644 "$SCRIPT_DIR/$name" "$INSTALL_ROOT/$name"
done
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
  printf 'update failed readiness; previous image id: %s\n' "${previous_image_id:-unknown}" >&2
  printf 'restore the pre-update backup with deploy/restore.sh, then restore APP_VERSION in %s\n' "$ENV_FILE" >&2
  exit 1
fi
printf 'update completed: %s\n' "$new_version"
