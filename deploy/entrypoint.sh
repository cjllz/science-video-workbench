#!/usr/bin/env bash
set -Eeuo pipefail

for writable_path in /app/data /tmp; do
  if [[ ! -d "$writable_path" || ! -w "$writable_path" ]]; then
    echo "startup error: $writable_path must exist and be writable by uid 10001" >&2
    exit 1
  fi
done

mkdir -p /app/data/outputs /app/data/materials

app_version="$(node -p "require('/app/package.json').version")"
echo "science-video-workbench version=$app_version architecture=$(uname -m) uid=$(id -u)"

exec "$@"
