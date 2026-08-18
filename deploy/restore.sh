#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=deploy/lib.sh
source "$SCRIPT_DIR/lib.sh"

if [[ $# -ne 2 || "$2" != "--confirm-restore" ]]; then
  die "usage: deploy/restore.sh <archive.tar.gz> --confirm-restore"
fi

load_deployment_environment
((EUID == 0)) || die "restore must run as root so uid/gid 10001 ownership can be restored"

data_dir="$(resolve_safe_directory DATA_DIR "${DATA_DIR:-}")"
backup_dir="$(resolve_safe_directory BACKUP_DIR "${BACKUP_DIR:-}")"
assert_not_nested_in_data BACKUP_DIR "$backup_dir" "$data_dir"
require_data_layout DATA_DIR "$data_dir"
assert_data_owner "$data_dir"
archive_path="$(realpath -e -- "$1")" || die "restore archive does not exist"
[[ -f "$archive_path" && "$archive_path" == *.tar.gz ]] || die "restore archive must be a .tar.gz file"
assert_not_nested_in_data RESTORE_ARCHIVE "$archive_path" "$data_dir"
checksum_path="$archive_path.sha256"
[[ -f "$checksum_path" ]] || die "restore checksum is missing"

for command_name in docker flock tar sha256sum realpath chown; do
  require_command "$command_name"
done
assert_compose_data_bind "$data_dir"

mkdir -p -- "$backup_dir"
exec 9>"$backup_dir/.backup.lock"
flock -n 9 || die "another backup or restore is already running"

(
  cd -- "$(dirname -- "$archive_path")"
  sha256sum -c -- "$(basename -- "$checksum_path")"
) || die "restore checksum verification failed"

set +e
check_idle
idle_status=$?
set -e
if ((idle_status == 2)); then
  die "restore refused: active jobs exist"
elif ((idle_status != 0)); then
  die "restore refused: idle check failed"
fi

data_parent="$(dirname -- "$data_dir")"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
candidate_dir=""
rollback_dir=""
stopped=false
swapped=false

remove_restore_directory() {
  local target="$1"
  case "$target" in
    "$data_parent"/.restore-candidate.*|"$data_parent"/.restore-rollback-*) rm -rf -- "$target" ;;
    *) return 1 ;;
  esac
}

cleanup() {
  local status=$?
  if ((status != 0)) && [[ "$stopped" == true ]]; then
    compose_cmd stop app >/dev/null 2>&1 || true
    if [[ "$swapped" == true && -n "$rollback_dir" && -d "$rollback_dir" ]]; then
      failed_dir="$data_parent/.restore-candidate.failed-$timestamp"
      [[ ! -e "$failed_dir" ]] || failed_dir="$data_parent/.restore-candidate.failed-$timestamp-$$"
      mv -- "$data_dir" "$failed_dir" 2>/dev/null || true
      mv -- "$rollback_dir" "$data_dir" 2>/dev/null || true
      chown -R 10001:10001 "$data_dir" 2>/dev/null || true
    fi
    compose_cmd up -d app >/dev/null 2>&1 || true
    wait_for_readiness 45 >/dev/null 2>&1 || true
  fi
  if [[ -n "$candidate_dir" && -d "$candidate_dir" ]]; then
    remove_restore_directory "$candidate_dir" || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

compose_cmd stop app
stopped=true

safety_archive="$backup_dir/restore-safety-$timestamp.tar.gz"
safety_partial="$backup_dir/.restore-safety-$timestamp.tar.gz.partial"
tar -C "$data_dir" -czf "$safety_partial" .
mv -- "$safety_partial" "$safety_archive"
(
  cd -- "$backup_dir"
  sha256sum "$(basename -- "$safety_archive")" >"$(basename -- "$safety_archive").sha256"
)

candidate_dir="$(mktemp -d "$data_parent/.restore-candidate.XXXXXX")"
tar -xzf "$archive_path" -C "$candidate_dir"
require_data_layout RESTORE_ARCHIVE "$candidate_dir"
chown -R 10001:10001 "$candidate_dir"

app_image="$(compose_cmd images -q app | head -n 1)"
[[ -n "$app_image" ]] || die "app image is unavailable for restore validation"
docker run --rm --network none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --security-opt no-new-privileges:true --user 10001:10001 \
  --volume "$candidate_dir:/app/data:ro" --entrypoint node \
  "$app_image" dist/server/maintenance-cli.js validate-data

rollback_dir="$data_parent/.restore-rollback-$timestamp"
[[ ! -e "$rollback_dir" ]] || die "rollback directory already exists"
mv -- "$data_dir" "$rollback_dir"
swapped=true
mv -- "$candidate_dir" "$data_dir"
candidate_dir=""
chown -R 10001:10001 "$data_dir"

compose_cmd up -d app
wait_for_readiness 45 || die "restored app did not become ready; rolling back"
stopped=false
swapped=false
remove_restore_directory "$rollback_dir"
rollback_dir=""

echo "restore completed; safety archive: $safety_archive"
