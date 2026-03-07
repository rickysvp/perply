#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

load_env
require_env PERPLY_ARENA_ADDRESS

if ! command -v cast >/dev/null 2>&1; then
  echo "cast is required" >&2
  exit 1
fi

if ! is_safe_rpc_url "${MONAD_RPC_URL}"; then
  echo "Unsafe MONAD_RPC_URL: ${MONAD_RPC_URL}" >&2
  exit 1
fi

: "${WATCHDOG_MAX_STALE_SEC:=180}"
: "${WATCHDOG_INTERVAL_SEC:=30}"
: "${WATCHDOG_RUN_ONCE:=true}"

check_once() {
  local now last age
  now=$(now_ts)
  last=$(cast call "${PERPLY_ARENA_ADDRESS}" "lastSettlementAt()(uint256)" --rpc-url "${MONAD_RPC_URL}" | awk '{print $1}')
  age=$(( now - last ))
  echo "[watchdog] now=${now} lastSettlementAt=${last} ageSec=${age}"

  if (( age > WATCHDOG_MAX_STALE_SEC )); then
    echo "[watchdog] stale settlement detected; restarting keeper service"
    bash "${SCRIPT_DIR}/keeper-service.sh" restart
  fi
}

if [[ "${WATCHDOG_RUN_ONCE}" == "true" ]]; then
  check_once
  exit 0
fi

while true; do
  check_once || true
  sleep "${WATCHDOG_INTERVAL_SEC}"
done
