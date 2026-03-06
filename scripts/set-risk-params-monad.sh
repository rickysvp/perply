#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"

MONAD_RPC_URL="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
PERPLY_ARENA_ADDRESS="${PERPLY_ARENA_ADDRESS:-${VITE_PERPLY_ARENA_ADDRESS:-}}"
: "${PERPLY_ARENA_ADDRESS:?PERPLY_ARENA_ADDRESS (or VITE_PERPLY_ARENA_ADDRESS) is required}"

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

NEW_MIN_SETTLEMENT_INTERVAL="${NEW_MIN_SETTLEMENT_INTERVAL:-3}"
NEW_VOLATILITY_TRIGGER_BPS="${NEW_VOLATILITY_TRIGGER_BPS:-15}"
NEW_SETTLEMENT_STRENGTH_BPS="${NEW_SETTLEMENT_STRENGTH_BPS:-8000}"
NEW_MAX_SETTLEMENT_TRANSFER_BPS="${NEW_MAX_SETTLEMENT_TRANSFER_BPS:-3000}"
NEW_OPEN_FEE_BPS="${NEW_OPEN_FEE_BPS:-50}"
NEW_CLOSE_FEE_BPS="${NEW_CLOSE_FEE_BPS:-50}"
NEW_SETTLEMENT_FEE_BPS="${NEW_SETTLEMENT_FEE_BPS:-1}"
NEW_CONGESTION_START_BPS="${NEW_CONGESTION_START_BPS:-1000}"
NEW_CONGESTION_FULL_BPS="${NEW_CONGESTION_FULL_BPS:-5000}"
NEW_MAX_CONGESTION_FEE_BPS="${NEW_MAX_CONGESTION_FEE_BPS:-50}"
NEW_MAINTENANCE_BASE_BPS="${NEW_MAINTENANCE_BASE_BPS:-600}"
NEW_MAINTENANCE_LEVERAGE_BPS="${NEW_MAINTENANCE_LEVERAGE_BPS:-40}"
NEW_LIQUIDATION_PENALTY_BPS="${NEW_LIQUIDATION_PENALTY_BPS:-200}"
NEW_LIQUIDATOR_REWARD_SHARE_BPS="${NEW_LIQUIDATOR_REWARD_SHARE_BPS:-5000}"
EXECUTE_NOW="${EXECUTE_NOW:-false}"
CANCEL_EXISTING_QUEUE="${CANCEL_EXISTING_QUEUE:-false}"

HAS_QUEUED="$(cast call "${PERPLY_ARENA_ADDRESS}" "hasQueuedRiskParams()(bool)" --rpc-url "${MONAD_RPC_URL}")"
if [[ "${HAS_QUEUED}" == "true" ]]; then
  if [[ "${CANCEL_EXISTING_QUEUE}" == "true" ]]; then
    echo "Existing risk params queue detected. Sending cancelRiskParamsQueue() first..."
    cast send "${PERPLY_ARENA_ADDRESS}" \
      "cancelRiskParamsQueue()" \
      --rpc-url "${MONAD_RPC_URL}" \
      --private-key "${DEPLOYER_PRIVATE_KEY}"
  else
    echo "Abort: pending risk params queue exists."
    echo "Set CANCEL_EXISTING_QUEUE=true to cancel pending queue and submit a new one."
    exit 1
  fi
fi

echo "Queueing setRiskParams tx on Monad Testnet..."
echo "Arena: ${PERPLY_ARENA_ADDRESS}"
echo "RPC: ${MONAD_RPC_URL}"
echo "Fees (bps): open=${NEW_OPEN_FEE_BPS}, close=${NEW_CLOSE_FEE_BPS}, settlement=${NEW_SETTLEMENT_FEE_BPS}"

cast send "${PERPLY_ARENA_ADDRESS}" \
  "setRiskParams(uint32,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16)" \
  "${NEW_MIN_SETTLEMENT_INTERVAL}" \
  "${NEW_VOLATILITY_TRIGGER_BPS}" \
  "${NEW_SETTLEMENT_STRENGTH_BPS}" \
  "${NEW_MAX_SETTLEMENT_TRANSFER_BPS}" \
  "${NEW_OPEN_FEE_BPS}" \
  "${NEW_CLOSE_FEE_BPS}" \
  "${NEW_SETTLEMENT_FEE_BPS}" \
  "${NEW_CONGESTION_START_BPS}" \
  "${NEW_CONGESTION_FULL_BPS}" \
  "${NEW_MAX_CONGESTION_FEE_BPS}" \
  "${NEW_MAINTENANCE_BASE_BPS}" \
  "${NEW_MAINTENANCE_LEVERAGE_BPS}" \
  "${NEW_LIQUIDATION_PENALTY_BPS}" \
  "${NEW_LIQUIDATOR_REWARD_SHARE_BPS}" \
  --rpc-url "${MONAD_RPC_URL}" \
  --private-key "${DEPLOYER_PRIVATE_KEY}"

ETA="$(cast call "${PERPLY_ARENA_ADDRESS}" "queuedRiskParamsEta()(uint256)" --rpc-url "${MONAD_RPC_URL}")"
echo "Queued. executeRiskParams() available after timestamp: ${ETA}"

if [[ "${EXECUTE_NOW}" == "true" ]]; then
  ETA_DEC="${ETA}"
  if [[ "${ETA_DEC}" == 0x* ]]; then
    ETA_DEC="$(cast to-dec "${ETA_DEC}")"
  fi
  NOW_TS="$(date +%s)"
  if (( NOW_TS < ETA_DEC )); then
    echo "Skip executeRiskParams(): timelock not reached yet (now=${NOW_TS}, eta=${ETA_DEC})."
    exit 1
  fi
  echo "Executing executeRiskParams()..."
  cast send "${PERPLY_ARENA_ADDRESS}" \
    "executeRiskParams()" \
    --rpc-url "${MONAD_RPC_URL}" \
    --private-key "${DEPLOYER_PRIVATE_KEY}"
fi
