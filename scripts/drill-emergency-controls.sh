#!/usr/bin/env bash
set -euo pipefail

if ! command -v cast >/dev/null 2>&1; then
  echo "cast is required (Foundry)."
  exit 1
fi

MONAD_RPC_URL="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
PERPLY_ARENA_ADDRESS="${PERPLY_ARENA_ADDRESS:-${VITE_PERPLY_ARENA_ADDRESS:-}}"
EXECUTE="${EXECUTE:-false}"
DRILL_CONFIRM="${DRILL_CONFIRM:-}"

is_safe_rpc_url() {
  local url="$1"
  if [[ "$url" =~ ^https:// ]]; then
    return 0
  fi
  if [[ "$url" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?(/.*)?$ ]]; then
    return 0
  fi
  return 1
}

if ! is_safe_rpc_url "${MONAD_RPC_URL}"; then
  echo "MONAD_RPC_URL must use https:// (http only allowed for localhost/127.0.0.1)."
  exit 1
fi

if [[ -z "${PERPLY_ARENA_ADDRESS}" ]]; then
  echo "PERPLY_ARENA_ADDRESS (or VITE_PERPLY_ARENA_ADDRESS) is required."
  exit 1
fi

if ! [[ "${PERPLY_ARENA_ADDRESS}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "PERPLY_ARENA_ADDRESS must be a valid 0x-prefixed 20-byte address."
  exit 1
fi

if [[ "${EXECUTE}" == "true" ]]; then
  : "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required when EXECUTE=true}"
  if [[ "${DRILL_CONFIRM}" != "YES" ]]; then
    echo "Safety check: set DRILL_CONFIRM=YES when EXECUTE=true."
    exit 1
  fi
fi

read_bool() {
  local fn_sig="$1"
  cast call "${PERPLY_ARENA_ADDRESS}" "${fn_sig}" --rpc-url "${MONAD_RPC_URL}" | tr '[:upper:]' '[:lower:]'
}

ensure_contract_code() {
  local code
  code="$(cast code "${PERPLY_ARENA_ADDRESS}" --rpc-url "${MONAD_RPC_URL}")"
  if [[ "${code}" == "0x" ]]; then
    echo "No contract code found at ${PERPLY_ARENA_ADDRESS} on ${MONAD_RPC_URL}."
    exit 1
  fi
}

send_tx() {
  local fn_sig="$1"
  local arg="${2:-}"
  if [[ -n "${arg}" ]]; then
    cast send "${PERPLY_ARENA_ADDRESS}" "${fn_sig}" "${arg}" \
      --rpc-url "${MONAD_RPC_URL}" \
      --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
  else
    cast send "${PERPLY_ARENA_ADDRESS}" "${fn_sig}" \
      --rpc-url "${MONAD_RPC_URL}" \
      --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null
  fi
}

echo "Emergency Controls Drill"
echo "Arena: ${PERPLY_ARENA_ADDRESS}"
echo "RPC: ${MONAD_RPC_URL}"
echo "Mode: ${EXECUTE}"
echo

ensure_contract_code

initial_paused="$(read_bool 'paused()(bool)')"
initial_reduce_only="$(read_bool 'reduceOnly()(bool)')"

echo "Initial state:"
echo "  paused=${initial_paused}"
echo "  reduceOnly=${initial_reduce_only}"
echo

if [[ "${EXECUTE}" != "true" ]]; then
  echo "Plan only (no on-chain writes):"
  echo "  1) setPaused(true)"
  echo "  2) setReduceOnly(true)"
  echo "  3) verify paused/reduceOnly are true"
  echo "  4) rollback to initial snapshot:"
  echo "     - setReduceOnly(${initial_reduce_only})"
  echo "     - setPaused(${initial_paused})"
  echo "  5) verify restored snapshot"
  echo
  echo "To execute drill:"
  echo "  EXECUTE=true DRILL_CONFIRM=YES DEPLOYER_PRIVATE_KEY=0x... PERPLY_ARENA_ADDRESS=${PERPLY_ARENA_ADDRESS} bash scripts/drill-emergency-controls.sh"
  exit 0
fi

echo "Executing drill..."

echo "- setPaused(true)"
send_tx "setPaused(bool)" "true"
echo "- setReduceOnly(true)"
send_tx "setReduceOnly(bool)" "true"

after_pause="$(read_bool 'paused()(bool)')"
after_reduce="$(read_bool 'reduceOnly()(bool)')"

if [[ "${after_pause}" != "true" || "${after_reduce}" != "true" ]]; then
  echo "Drill failed: emergency switches did not activate as expected."
  exit 1
fi

echo "- rollback setReduceOnly(${initial_reduce_only})"
send_tx "setReduceOnly(bool)" "${initial_reduce_only}"
echo "- rollback setPaused(${initial_paused})"
send_tx "setPaused(bool)" "${initial_paused}"

final_paused="$(read_bool 'paused()(bool)')"
final_reduce_only="$(read_bool 'reduceOnly()(bool)')"

if [[ "${final_paused}" != "${initial_paused}" || "${final_reduce_only}" != "${initial_reduce_only}" ]]; then
  echo "Rollback failed."
  echo "Expected: paused=${initial_paused}, reduceOnly=${initial_reduce_only}"
  echo "Actual:   paused=${final_paused}, reduceOnly=${final_reduce_only}"
  exit 1
fi

echo
echo "Drill success."
echo "Restored state:"
echo "  paused=${final_paused}"
echo "  reduceOnly=${final_reduce_only}"
