#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"
load_deployment_environment

data_dir="$(resolve_safe_directory DATA_DIR "${DATA_DIR:-}")"
backup_dir="$(resolve_safe_directory BACKUP_DIR "${BACKUP_DIR:-}")"
assert_not_nested_in_data BACKUP_DIR "$backup_dir" "$data_dir"
[[ -d "$data_dir" ]] || die "DATA_DIR does not exist"
mkdir -p -- "$backup_dir"

retention_days="${BACKUP_RETENTION_DAYS:-14}"
[[ "$retention_days" =~ ^[0-9]+$ ]] && ((retention_days >= 1 && retention_days <= 3650)) \
  || die "BACKUP_RETENTION_DAYS must be an integer from 1 through 3650"

for command_name in docker flock tar sha256sum stat uname; do
  require_command "$command_name"
done

exec 9>"$backup_dir/.backup.lock"
flock -n 9 || die "another backup or restore is already running"

stopped=false
archive_partial=""
checksum_partial=""
manifest_partial=""

restart_app() {
  compose_cmd up -d app
  wait_for_readiness 45 || die "app did not become ready after backup"
  stopped=false
}

cleanup() {
  local status=$?
  [[ -z "$archive_partial" ]] || rm -f -- "$archive_partial"
  [[ -z "$checksum_partial" ]] || rm -f -- "$checksum_partial"
  [[ -z "$manifest_partial" ]] || rm -f -- "$manifest_partial"
  if [[ "$stopped" == true ]]; then
    compose_cmd up -d app >/dev/null 2>&1 || true
    wait_for_readiness 45 >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

set +e
check_idle
idle_status=$?
set -e
if ((idle_status == 2)); then
  die "backup refused: active jobs exist"
elif ((idle_status != 0)); then
  die "backup refused: idle check failed"
fi

compose_cmd stop app
stopped=true

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive_name="science-video-$timestamp.tar.gz"
archive_path="$backup_dir/$archive_name"
checksum_path="$archive_path.sha256"
manifest_path="$archive_path.manifest.json"
archive_partial="$backup_dir/.$archive_name.partial"
checksum_partial="$backup_dir/.$archive_name.sha256.partial"
manifest_partial="$backup_dir/.$archive_name.manifest.json.partial"

tar -C "$data_dir" -czf "$archive_partial" .
archive_hash="$(sha256sum "$archive_partial" | awk '{print $1}')"
printf '%s  %s\n' "$archive_hash" "$archive_name" >"$checksum_partial"

commit="$(git -C "$PROJECT_ROOT" rev-parse --verify HEAD 2>/dev/null || printf 'unknown')"
app_version="$(printf '%s' "${APP_VERSION:-unknown}" | tr -cd 'A-Za-z0-9._-')"
architecture="$(uname -m | tr -cd 'A-Za-z0-9._-')"
archive_size="$(stat -c '%s' "$archive_partial")"
printf '{"createdAt":"%s","appVersion":"%s","commit":"%s","architecture":"%s","bytes":%s}\n' \
  "$timestamp" "$app_version" "$commit" "$architecture" "$archive_size" >"$manifest_partial"

mv -- "$checksum_partial" "$checksum_path"
checksum_partial=""
mv -- "$manifest_partial" "$manifest_path"
manifest_partial=""
mv -- "$archive_partial" "$archive_path"
archive_partial=""

restart_app

while IFS= read -r -d '' expired_archive; do
  rm -f -- "$expired_archive" "$expired_archive.sha256" "$expired_archive.manifest.json"
done < <(find "$backup_dir" -maxdepth 1 -type f -name 'science-video-*.tar.gz' -mtime "+$retention_days" -print0)

if [[ -n "${BACKUP_MIRROR_DIR:-}" ]]; then
  mirror_dir="$(resolve_safe_directory BACKUP_MIRROR_DIR "$BACKUP_MIRROR_DIR")"
  assert_not_nested_in_data BACKUP_MIRROR_DIR "$mirror_dir" "$data_dir"
  require_command rsync
  mkdir -p -- "$mirror_dir"
  rsync -a -- "$archive_path" "$checksum_path" "$manifest_path" "$mirror_dir/"
fi

echo "$archive_path"
