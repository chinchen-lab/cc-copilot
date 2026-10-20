#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun >= 1.3.5 is required. Install Bun and add it to PATH, then rerun ./build-server.sh." >&2
  exit 1
fi
exec bun "$root/scripts/build-server.ts" "$@"
