#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
require_linux
load_environment

destroy_data=0
if [[ $# -eq 0 ]]; then
  destroy_data=0
elif [[ $# -eq 2 && "$1" == "--destroy-data" && "$2" == "--confirm-destroy-data" ]]; then
  destroy_data=1
else
  die "usage: $0 [--destroy-data --confirm-destroy-data]"
fi

compose_cmd down
if [[ "$destroy_data" == "0" ]]; then
  printf 'containers removed; data, backups, configuration and Caddy CA were preserved\n'
  exit 0
fi

DATA_DIR="$(resolve_safe_directory DATA_DIR "$DATA_DIR")"
BACKUP_DIR="$(resolve_safe_directory BACKUP_DIR "$BACKUP_DIR")"
assert_not_nested DATA_DIR "$DATA_DIR" BACKUP_DIR "$BACKUP_DIR"
require_data_layout "$DATA_DIR"
printf 'destroying DATA_DIR=%s and BACKUP_DIR=%s\n' "$DATA_DIR" "$BACKUP_DIR"
rm -rf -- "$DATA_DIR" "$BACKUP_DIR"
printf 'persistent data and backups were destroyed; Caddy CA and production configuration were preserved\n'
