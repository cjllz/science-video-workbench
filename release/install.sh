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
[[ -f "$SCRIPT_DIR/VERSION" ]] || die "release VERSION file is missing"
bundle_version="$(tr -d '\r\n' <"$SCRIPT_DIR/VERSION")"
[[ "$bundle_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "release VERSION is invalid"
load_environment
[[ "$APP_VERSION" == "$bundle_version" ]] || die "APP_VERSION must match release VERSION $bundle_version"

DATA_DIR="$(resolve_safe_directory DATA_DIR "$DATA_DIR")"
BACKUP_DIR="$(resolve_safe_directory BACKUP_DIR "$BACKUP_DIR")"
assert_not_nested DATA_DIR "$DATA_DIR" BACKUP_DIR "$BACKUP_DIR"

install -d -m 0755 "$INSTALL_ROOT" "$INSTALL_ROOT/deploy"
install -m 0644 "$SCRIPT_DIR/compose.release.yaml" "$INSTALL_ROOT/compose.yaml"
if [[ "$(realpath -m -- "$SCRIPT_DIR")" != "$(realpath -m -- "$INSTALL_ROOT")" ]]; then
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
fi

initialize_data_directory "$DATA_DIR"
initialize_backup_directory "$BACKUP_DIR"

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
