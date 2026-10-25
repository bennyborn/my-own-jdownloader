#!/usr/bin/env bash
# Start / stop throw-away JDownloader test devices (see compose.yaml next to this file).
#   test-devices/run.sh up      start jd-test-1 and jd-test-2 (first start takes a few minutes: JD updates itself)
#   test-devices/run.sh status  show the containers and the devices the MyJD account sees
#   test-devices/run.sh down    stop them and remove containers AND volumes completely
# Only touches the compose project "jd-test"; the real JDownloader container is never involved.
set -euo pipefail
cd "$(dirname "$0")"
dc() { docker compose --env-file ../.env -f compose.yaml "$@"; }

case "${1:-}" in
  up) dc up -d ;;
  status)
    dc ps
    (cd .. && docker compose run --rm dev npx tsx backend/src/probe.ts 2>&1 | grep -E 'Login|^- ' || true)
    ;;
  down) dc down -v --remove-orphans ;;
  *) echo "usage: $0 up|status|down" >&2; exit 1 ;;
esac
