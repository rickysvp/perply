#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cat <<CRON
# Perply automation (example)
*/2 * * * * cd ${ROOT_DIR} && bash scripts/ops/timelock-executor.sh >> .ops/timelock-executor.log 2>&1
*/1 * * * * cd ${ROOT_DIR} && WATCHDOG_RUN_ONCE=true WATCHDOG_MAX_STALE_SEC=180 bash scripts/ops/health-watchdog.sh >> .ops/watchdog.log 2>&1
CRON
