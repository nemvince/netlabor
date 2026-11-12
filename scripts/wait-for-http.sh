#!/usr/bin/env bash
# Wait until an HTTP endpoint answers, so CI does not guess with a sleep.
# Usage: wait-for-http.sh <url> [attempts]   (attempts × 0.5 s, default 120)
set -euo pipefail

url="${1:?usage: wait-for-http.sh <url> [attempts]}"
attempts="${2:-120}"

for _ in $(seq 1 "$attempts"); do
  if curl -sf -m 2 "$url" >/dev/null; then
    exit 0
  fi
  sleep 0.5
done

echo "timed out waiting for $url" >&2
exit 1
