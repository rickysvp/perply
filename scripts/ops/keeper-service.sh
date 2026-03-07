#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

ACTION="${1:-status}"
PID_FILE="${STATE_DIR}/keeper.pid"
LOG_FILE="${STATE_DIR}/keeper.log"

pid_is_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

find_keeper_pids() {
  pgrep -f "scripts/keeper-signer.ts" || true
}

keeper_pid() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid=$(cat "${PID_FILE}")
    if pid_is_running "$pid"; then
      echo "$pid"
      return 0
    fi
  fi

  local pids
  pids="$(find_keeper_pids)"
  [[ -n "${pids}" ]] || return 1
  local pid
  pid="$(echo "${pids}" | head -n 1)"
  echo "${pid}" >"${PID_FILE}"
  echo "${pid}"
  return 0
}

start_keeper() {
  load_env
  require_env PERPLY_ARENA_ADDRESS
  require_env KEEPER_PRIVATE_KEY
  require_env PRICE_SIGNER_PRIVATE_KEY
  if ! is_safe_rpc_url "${MONAD_RPC_URL}"; then
    echo "Unsafe MONAD_RPC_URL: ${MONAD_RPC_URL}" >&2
    exit 1
  fi

  local running_pids
  running_pids="$(find_keeper_pids)"
  if [[ -n "${running_pids}" ]]; then
    local first_pid
    first_pid="$(echo "${running_pids}" | head -n 1)"
    echo "${first_pid}" >"${PID_FILE}"
    echo "keeper already running (pids=$(echo "${running_pids}" | tr '\n' ',' | sed 's/,$//'))"
    return 0
  fi

  : "${KEEPER_POLL_MS:=5000}"
  : "${KEEPER_MIN_PRICE_SOURCES:=2}"
  : "${KEEPER_MAX_DEVIATION_PCT:=10}"
  : "${KEEPER_CHAIN_ID:=10143}"
  : "${KEEPER_DRY_RUN:=false}"
  : "${KEEPER_ALLOW_SHARED_SIGNER:=false}"
  : "${ALLOW_NONCE_CONFLICT:=false}"

  if ! command -v cast >/dev/null 2>&1; then
    echo "cast is required for keeper start safety checks" >&2
    exit 1
  fi

  local keeper_addr signer_addr
  keeper_addr=$(cast wallet address --private-key "${KEEPER_PRIVATE_KEY}")
  signer_addr=$(cast wallet address --private-key "${PRICE_SIGNER_PRIVATE_KEY}")
  if [[ "${KEEPER_ALLOW_SHARED_SIGNER}" != "true" && "$(echo "$keeper_addr" | tr '[:upper:]' '[:lower:]')" == "$(echo "$signer_addr" | tr '[:upper:]' '[:lower:]')" ]]; then
    echo "Refusing to start keeper: keeper and signer addresses are identical while KEEPER_ALLOW_SHARED_SIGNER=false." >&2
    exit 1
  fi

  if [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
    local owner_key_addr
    owner_key_addr=$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")
    if [[ "${ALLOW_NONCE_CONFLICT}" != "true" && "$(echo "$owner_key_addr" | tr '[:upper:]' '[:lower:]')" == "$(echo "$keeper_addr" | tr '[:upper:]' '[:lower:]')" ]]; then
      echo "Refusing to start keeper: owner key and keeper key are identical (nonce conflict risk). Set ALLOW_NONCE_CONFLICT=true only for temporary emergency use." >&2
      exit 1
    fi
  fi

  echo "starting keeper..."
  (
    cd "${ROOT_DIR}"
    nohup npx tsx scripts/keeper-signer.ts >>"${LOG_FILE}" 2>&1 &
    echo $! >"${PID_FILE}"
  )

  sleep 1
  pid=$(keeper_pid)
  if pid_is_running "$pid"; then
    echo "keeper started (pid=${pid})"
  else
    echo "keeper failed to start; see ${LOG_FILE}" >&2
    exit 1
  fi
}

stop_keeper() {
  local pids
  pids="$(find_keeper_pids)"
  if [[ -z "${pids}" ]] && ! pid=$(keeper_pid 2>/dev/null); then
    echo "keeper not running"
    return 0
  fi

  if [[ -z "${pids}" ]]; then
    pids="${pid}"
  fi

  echo "stopping keeper (pids=$(echo "${pids}" | tr '\n' ',' | sed 's/,$//'))..."
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    kill "${pid}" || true
  done <<<"${pids}"

  for _ in {1..30}; do
    local alive
    alive=0
    while IFS= read -r pid; do
      [[ -n "${pid}" ]] || continue
      if pid_is_running "${pid}"; then
        alive=1
        break
      fi
    done <<<"${pids}"
    if [[ "${alive}" -eq 0 ]]; then
      rm -f "${PID_FILE}"
      echo "keeper stopped"
      return 0
    fi
    sleep 0.5
  done

  echo "force killing keeper..."
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    kill -9 "${pid}" || true
  done <<<"${pids}"
  rm -f "${PID_FILE}"
}

status_keeper() {
  load_env
  local running_pids
  running_pids="$(find_keeper_pids)"
  if [[ -n "${running_pids}" ]]; then
    local first_pid
    first_pid="$(echo "${running_pids}" | head -n 1)"
    echo "${first_pid}" >"${PID_FILE}"
    echo "keeper: running (pids=$(echo "${running_pids}" | tr '\n' ',' | sed 's/,$//'))"
  else
    echo "keeper: stopped"
  fi

  if command -v cast >/dev/null 2>&1 && [[ -n "${PERPLY_ARENA_ADDRESS:-}" ]]; then
    set +e
    last_settle=$(cast call "${PERPLY_ARENA_ADDRESS}" "lastSettlementAt()(uint256)" --rpc-url "${MONAD_RPC_URL}" 2>/dev/null | awk '{print $1}')
    rc=$?
    set -e
    if [[ $rc -eq 0 && -n "${last_settle}" ]]; then
      now=$(now_ts)
      age=$(( now - last_settle ))
      echo "lastSettlementAt=${last_settle} ageSec=${age}"
    fi
  fi

  echo "log: ${LOG_FILE}"
}

logs_keeper() {
  touch "${LOG_FILE}"
  tail -n 120 -f "${LOG_FILE}"
}

case "${ACTION}" in
  start) start_keeper ;;
  stop) stop_keeper ;;
  restart) stop_keeper; start_keeper ;;
  status) status_keeper ;;
  logs) logs_keeper ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}" >&2
    exit 1
    ;;
esac
