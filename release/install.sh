#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
require_linux
require_amd64
for command in docker curl tar sha256sum realpath install; do
  require_command "$command"
done
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
load_environment

DATA_DIR="$(resolve_safe_directory DATA_DIR "$DATA_DIR")"
BACKUP_DIR="$(resolve_safe_directory BACKUP_DIR "$BACKUP_DIR")"
assert_not_nested DATA_DIR "$DATA_DIR" BACKUP_DIR "$BACKUP_DIR"

install -d -m 0755 "$INSTALL_ROOT" "$INSTALL_ROOT/deploy"
install -m 0644 "$SCRIPT_DIR/compose.release.yaml" "$INSTALL_ROOT/compose.yaml"
if [[ "$(realpath -m -- "$SCRIPT_DIR")" != "$(realpath -m -- "$INSTALL_ROOT")" ]]; then
  install -m 0644 "$SCRIPT_DIR/Caddyfile" "$INSTALL_ROOT/Caddyfile"
  for name in lib.sh configure.sh install.sh update.sh uninstall.sh; do
    install -m 0755 "$SCRIPT_DIR/$name" "$INSTALL_ROOT/$name"
  done
  if [[ -d "$SCRIPT_DIR/deploy" ]]; then
    for name in backup.sh restore.sh lib.sh; do
      [[ -f "$SCRIPT_DIR/deploy/$name" ]] && install -m 0755 "$SCRIPT_DIR/deploy/$name" "$INSTALL_ROOT/deploy/$name"
    done
  fi
fi

if [[ -e "$DATA_DIR" && ! -f "$DATA_DIR/.science-video-workbench-data" ]]; then
  if find "$DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
    die "DATA_DIR is not empty and has no project data sentinel: $DATA_DIR"
  fi
fi
install -d -m 0750 -o 10001 -g 10001 "$DATA_DIR" "$DATA_DIR/outputs" "$DATA_DIR/materials"
printf '%s\n' "$DATA_SENTINEL" >"$DATA_DIR/.science-video-workbench-data"
chown 10001:10001 "$DATA_DIR/.science-video-workbench-data"
install -d -m 0750 "$BACKUP_DIR"

COMPOSE_FILE="$INSTALL_ROOT/compose.yaml"
compose_cmd config --quiet
compose_cmd pull
compose_cmd up -d
if ! wait_for_readiness 60; then
  compose_cmd logs --tail=200 app >&2 || true
  die "application did not become ready; data was preserved"
fi

printf 'installation completed\n'
printf 'access URL: https://%s\n' "$LAN_HOST"
printf 'export CA: docker compose --env-file %q -f %q cp caddy:/data/caddy/pki/authorities/local/root.crt ./science-video-root.crt\n' "$ENV_FILE" "$COMPOSE_FILE"
