#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"

load_env
require_env PERPLY_ARENA_ADDRESS
require_env DEPLOYER_PRIVATE_KEY

if ! command -v cast >/dev/null 2>&1; then
  echo "cast is required" >&2
  exit 1
fi

if ! is_safe_rpc_url "${MONAD_RPC_URL}"; then
  echo "Unsafe MONAD_RPC_URL: ${MONAD_RPC_URL}" >&2
  exit 1
fi

: "${AUTO_EXECUTE_KEEPER_UPDATE:=true}"
: "${AUTO_EXECUTE_PRICE_SIGNER_UPDATE:=true}"
: "${AUTO_EXECUTE_OWNERSHIP_TRANSFER:=false}"
: "${AUTO_EXECUTE_DIRECT_SETTLEMENT_TOGGLE:=true}"
: "${AUTO_EXECUTE_PAUSE_DISABLE:=true}"
: "${AUTO_EXECUTE_REDUCE_ONLY_DISABLE:=true}"
: "${AUTO_EXECUTE_MAX_PRICE_AGE:=true}"
: "${AUTO_EXECUTE_RISK_PARAMS:=true}"
: "${ALLOW_NONCE_CONFLICT:=false}"

owner_onchain=$(cast call "${PERPLY_ARENA_ADDRESS}" "owner()(address)" --rpc-url "${MONAD_RPC_URL}")
owner_local=$(cast wallet address --private-key "${DEPLOYER_PRIVATE_KEY}")
if [[ "$(echo "$owner_onchain" | tr '[:upper:]' '[:lower:]')" != "$(echo "$owner_local" | tr '[:upper:]' '[:lower:]')" ]]; then
  echo "owner key mismatch: key=${owner_local} onchain=${owner_onchain}" >&2
  exit 1
fi

if [[ -n "${KEEPER_PRIVATE_KEY:-}" ]]; then
  keeper_local=$(cast wallet address --private-key "${KEEPER_PRIVATE_KEY}")
  if [[ "${ALLOW_NONCE_CONFLICT}" != "true" && "$(echo "$keeper_local" | tr '[:upper:]' '[:lower:]')" == "$(echo "$owner_local" | tr '[:upper:]' '[:lower:]')" ]]; then
    echo "Refusing timelock execution: owner key and keeper key are identical (nonce conflict risk). Set ALLOW_NONCE_CONFLICT=true only for temporary emergency use." >&2
    exit 1
  fi
fi

now=$(now_ts)
executed=0

run_if_due_address_op() {
  local enabled="$1"
  local getter_sig="$2"
  local exec_sig="$3"
  local label="$4"

  [[ "$enabled" == "true" ]] || return 0
  local out
  if ! out=$(cast call "${PERPLY_ARENA_ADDRESS}" "${getter_sig}" --rpc-url "${MONAD_RPC_URL}" 2>/dev/null); then
    echo "[${label}] getter unavailable; skip"
    return 0
  fi
  local value eta queued
  value=$(echo "$out" | sed -n '1p')
  eta=$(echo "$out" | sed -n '2p' | awk '{print $1}')
  queued=$(echo "$out" | sed -n '3p')

  if [[ "$queued" != "true" ]]; then
    echo "[${label}] no queued op"
    return 0
  fi

  if (( now < eta )); then
    echo "[${label}] queued for ${value}, eta=${eta} (not due)"
    return 0
  fi

  echo "[${label}] executing ${exec_sig}..."
  if cast send "${PERPLY_ARENA_ADDRESS}" "${exec_sig}" --rpc-url "${MONAD_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null 2>&1; then
    echo "[${label}] executed"
    executed=$((executed + 1))
  else
    echo "[${label}] execution failed; will retry on next run"
  fi
}

run_if_due_bool_op() {
  local enabled="$1"
  local getter_sig="$2"
  local exec_sig="$3"
  local label="$4"

  [[ "$enabled" == "true" ]] || return 0
  local out
  if ! out=$(cast call "${PERPLY_ARENA_ADDRESS}" "${getter_sig}" --rpc-url "${MONAD_RPC_URL}" 2>/dev/null); then
    echo "[${label}] getter unavailable; skip"
    return 0
  fi
  local value eta queued
  value=$(echo "$out" | sed -n '1p')
  eta=$(echo "$out" | sed -n '2p' | awk '{print $1}')
  queued=$(echo "$out" | sed -n '3p')

  if [[ "$queued" != "true" ]]; then
    echo "[${label}] no queued op"
    return 0
  fi

  if (( now < eta )); then
    echo "[${label}] queued value=${value}, eta=${eta} (not due)"
    return 0
  fi

  echo "[${label}] executing ${exec_sig}..."
  if cast send "${PERPLY_ARENA_ADDRESS}" "${exec_sig}" --rpc-url "${MONAD_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null 2>&1; then
    echo "[${label}] executed"
    executed=$((executed + 1))
  else
    echo "[${label}] execution failed; will retry on next run"
  fi
}

run_if_due_risk_params() {
  [[ "${AUTO_EXECUTE_RISK_PARAMS}" == "true" ]] || return 0

  local queued eta
  if ! queued=$(cast call "${PERPLY_ARENA_ADDRESS}" "hasQueuedRiskParams()(bool)" --rpc-url "${MONAD_RPC_URL}" 2>/dev/null); then
    echo "[riskParams] getter unavailable; skip"
    return 0
  fi
  if [[ "$queued" != "true" ]]; then
    echo "[riskParams] no queued op"
    return 0
  fi

  if ! eta=$(cast call "${PERPLY_ARENA_ADDRESS}" "queuedRiskParamsEta()(uint256)" --rpc-url "${MONAD_RPC_URL}" 2>/dev/null | awk '{print $1}'); then
    echo "[riskParams] eta getter unavailable; skip"
    return 0
  fi
  if (( now < eta )); then
    echo "[riskParams] eta=${eta} (not due)"
    return 0
  fi

  echo "[riskParams] executing executeRiskParams()..."
  if cast send "${PERPLY_ARENA_ADDRESS}" "executeRiskParams()" --rpc-url "${MONAD_RPC_URL}" --private-key "${DEPLOYER_PRIVATE_KEY}" >/dev/null 2>&1; then
    echo "[riskParams] executed"
    executed=$((executed + 1))
  else
    echo "[riskParams] execution failed; will retry on next run"
  fi
}

run_if_due_address_op "${AUTO_EXECUTE_KEEPER_UPDATE}" "getQueuedKeeperUpdate()(address,uint256,bool)" "executeKeeperUpdate()" "keeper"
run_if_due_address_op "${AUTO_EXECUTE_PRICE_SIGNER_UPDATE}" "getQueuedPriceSignerUpdate()(address,uint256,bool)" "executePriceSignerUpdate()" "priceSigner"
run_if_due_address_op "${AUTO_EXECUTE_OWNERSHIP_TRANSFER}" "getQueuedOwnershipTransfer()(address,uint256,bool)" "executeOwnershipTransfer()" "ownership"
run_if_due_bool_op "${AUTO_EXECUTE_DIRECT_SETTLEMENT_TOGGLE}" "getQueuedDirectSettlementToggle()(bool,uint256,bool)" "executeDirectSettlementToggle()" "directSettlement"
run_if_due_bool_op "${AUTO_EXECUTE_PAUSE_DISABLE}" "getQueuedPauseDisable()(bool,uint256,bool)" "executePauseDisable()" "pauseDisable"
run_if_due_bool_op "${AUTO_EXECUTE_REDUCE_ONLY_DISABLE}" "getQueuedReduceOnlyDisable()(bool,uint256,bool)" "executeReduceOnlyDisable()" "reduceOnlyDisable"
run_if_due_bool_op "${AUTO_EXECUTE_MAX_PRICE_AGE}" "getQueuedMaxPriceAgeUpdate()(uint32,uint256,bool)" "executeMaxPriceAgeSecUpdate()" "maxPriceAge"
run_if_due_risk_params

echo "timelock executor done: executed=${executed}"
