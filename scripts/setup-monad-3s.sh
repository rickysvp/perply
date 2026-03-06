#!/usr/bin/env bash
set -euo pipefail

# One-shot bootstrap for Monad testnet PerplyArena V1.2
# What it does:
# 1) Deploy contract (or use existing PERPLY_ARENA_ADDRESS)
# 2) Queue + execute keeper/priceSigner updates (timelocked)
# 3) Queue + execute risk params (minSettlementInterval=3)
# 4) Verify on-chain values
# 5) Write .env.local with the final arena address

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1"
    exit 1
  }
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env: $key"
    exit 1
  fi
}

is_hex_address() {
  [[ "$1" =~ ^0x[a-fA-F0-9]{40}$ ]]
}

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

to_dec() {
  local val="$1"
  if [[ "$val" == 0x* ]]; then
    cast to-dec "$val"
  else
    echo "$val"
  fi
}

wait_until() {
  local eta="$1"
  local label="$2"
  while true; do
    local now
    now="$(date +%s)"
    if (( now >= eta )); then
      break
    fi
    local left=$(( eta - now ))
    echo "[$label] waiting ${left}s..."
    sleep 5
  done
}

require_cmd cast
require_cmd forge
require_cmd npm

require_env DEPLOYER_PRIVATE_KEY
require_env KEEPER_PRIVATE_KEY
require_env PRICE_SIGNER_PRIVATE_KEY

MONAD_RPC_URL="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
INITIAL_BTC_PRICE_E8="${INITIAL_BTC_PRICE_E8:-9000000000000}"
WAIT_FOR_TIMELOCK="${WAIT_FOR_TIMELOCK:-true}"
WRITE_ENV_LOCAL="${WRITE_ENV_LOCAL:-true}"
STRICT_SETUP="${STRICT_SETUP:-true}"

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

OWNER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
KEEPER_ADDRESS="$(cast wallet address --private-key "$KEEPER_PRIVATE_KEY")"
PRICE_SIGNER_ADDRESS="$(cast wallet address --private-key "$PRICE_SIGNER_PRIVATE_KEY")"

if [[ "${KEEPER_ADDRESS,,}" == "${PRICE_SIGNER_ADDRESS,,}" ]]; then
  echo "Keeper and PriceSigner must be different addresses."
  exit 1
fi

echo "RPC: $MONAD_RPC_URL"
echo "Owner: $OWNER_ADDRESS"
echo "Keeper: $KEEPER_ADDRESS"
echo "PriceSigner: $PRICE_SIGNER_ADDRESS"

PERPLY_ARENA_ADDRESS="${PERPLY_ARENA_ADDRESS:-${VITE_PERPLY_ARENA_ADDRESS:-}}"
if [[ -n "$PERPLY_ARENA_ADDRESS" ]]; then
  if ! is_hex_address "$PERPLY_ARENA_ADDRESS"; then
    echo "PERPLY_ARENA_ADDRESS is not a valid EVM address: $PERPLY_ARENA_ADDRESS"
    exit 1
  fi
  code="$(cast code "$PERPLY_ARENA_ADDRESS" --rpc-url "$MONAD_RPC_URL")"
  if [[ "$code" == "0x" ]]; then
    echo "PERPLY_ARENA_ADDRESS has no bytecode: $PERPLY_ARENA_ADDRESS"
    exit 1
  fi
  echo "Using existing arena: $PERPLY_ARENA_ADDRESS"
else
  echo "Deploying PerplyArena..."
  deploy_out="$(forge create contracts/PerplyArena.sol:PerplyArena \
    --rpc-url "$MONAD_RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    --broadcast \
    --constructor-args "$INITIAL_BTC_PRICE_E8")"
  echo "$deploy_out"
  PERPLY_ARENA_ADDRESS="$(echo "$deploy_out" | sed -n 's/^Deployed to: \(0x[0-9a-fA-F]\{40\}\)$/\1/p' | tail -n1)"
  if [[ -z "$PERPLY_ARENA_ADDRESS" ]]; then
    echo "Failed to parse deployed address from forge output"
    exit 1
  fi
  echo "Deployed arena: $PERPLY_ARENA_ADDRESS"
fi

onchain_owner="$(cast call "$PERPLY_ARENA_ADDRESS" "owner()(address)" --rpc-url "$MONAD_RPC_URL")"
if [[ "${onchain_owner,,}" != "${OWNER_ADDRESS,,}" ]]; then
  echo "Owner mismatch: contract owner=$onchain_owner, deployer key owner=$OWNER_ADDRESS"
  echo "Use the correct owner private key in DEPLOYER_PRIVATE_KEY."
  exit 1
fi

admin_timelock_raw="$(cast call "$PERPLY_ARENA_ADDRESS" "adminOpsTimelockSec()(uint32)" --rpc-url "$MONAD_RPC_URL")"
risk_timelock_raw="$(cast call "$PERPLY_ARENA_ADDRESS" "riskParamsTimelockSec()(uint32)" --rpc-url "$MONAD_RPC_URL")"
admin_timelock="$(to_dec "$admin_timelock_raw")"
risk_timelock="$(to_dec "$risk_timelock_raw")"

echo "adminOpsTimelockSec=$admin_timelock"
echo "riskParamsTimelockSec=$risk_timelock"

queue_or_note() {
  local label="$1"
  shift
  set +e
  out="$($@ 2>&1)"
  rc=$?
  set -e
  if (( rc != 0 )); then
    echo "[$label] queue skipped/failed:"
    echo "$out"
    if [[ "$STRICT_SETUP" == "true" ]]; then
      echo "[$label] strict mode enabled, aborting."
      exit 1
    fi
  else
    echo "[$label] queued"
  fi
}

# Queue admin ops
queue_or_note "keeper" cast send "$PERPLY_ARENA_ADDRESS" "setKeeper(address)" "$KEEPER_ADDRESS" --rpc-url "$MONAD_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
queue_or_note "priceSigner" cast send "$PERPLY_ARENA_ADDRESS" "setPriceSigner(address)" "$PRICE_SIGNER_ADDRESS" --rpc-url "$MONAD_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"

if [[ "$WAIT_FOR_TIMELOCK" == "true" ]]; then
  now="$(date +%s)"
  admin_eta=$(( now + admin_timelock + 2 ))
  wait_until "$admin_eta" "admin-timelock"

  set +e
  cast send "$PERPLY_ARENA_ADDRESS" "executeKeeperUpdate()" --rpc-url "$MONAD_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
  set -e
  set +e
  cast send "$PERPLY_ARENA_ADDRESS" "executePriceSignerUpdate()" --rpc-url "$MONAD_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
  set -e
else
  echo "WAIT_FOR_TIMELOCK=false: remember to executeKeeperUpdate/executePriceSignerUpdate later"
fi

# Queue risk params
queue_or_note "risk-params" cast send "$PERPLY_ARENA_ADDRESS" \
  "setRiskParams(uint32,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16)" \
  "$NEW_MIN_SETTLEMENT_INTERVAL" \
  "$NEW_VOLATILITY_TRIGGER_BPS" \
  "$NEW_SETTLEMENT_STRENGTH_BPS" \
  "$NEW_MAX_SETTLEMENT_TRANSFER_BPS" \
  "$NEW_OPEN_FEE_BPS" \
  "$NEW_CLOSE_FEE_BPS" \
  "$NEW_SETTLEMENT_FEE_BPS" \
  "$NEW_CONGESTION_START_BPS" \
  "$NEW_CONGESTION_FULL_BPS" \
  "$NEW_MAX_CONGESTION_FEE_BPS" \
  "$NEW_MAINTENANCE_BASE_BPS" \
  "$NEW_MAINTENANCE_LEVERAGE_BPS" \
  "$NEW_LIQUIDATION_PENALTY_BPS" \
  "$NEW_LIQUIDATOR_REWARD_SHARE_BPS" \
  --rpc-url "$MONAD_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"

queued_eta_raw="$(cast call "$PERPLY_ARENA_ADDRESS" "queuedRiskParamsEta()(uint256)" --rpc-url "$MONAD_RPC_URL" || echo 0)"
queued_eta="$(to_dec "$queued_eta_raw")"

if [[ "$WAIT_FOR_TIMELOCK" == "true" && "$queued_eta" =~ ^[0-9]+$ && "$queued_eta" -gt 0 ]]; then
  wait_until "$queued_eta" "risk-timelock"
  set +e
  cast send "$PERPLY_ARENA_ADDRESS" "executeRiskParams()" --rpc-url "$MONAD_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
  set -e
else
  echo "WAIT_FOR_TIMELOCK=false or no risk queue ETA: executeRiskParams later"
fi

# Verification
echo "=== VERIFY ==="
cast call "$PERPLY_ARENA_ADDRESS" "owner()(address)" --rpc-url "$MONAD_RPC_URL"
cast call "$PERPLY_ARENA_ADDRESS" "keeper()(address)" --rpc-url "$MONAD_RPC_URL"
set +e
cast call "$PERPLY_ARENA_ADDRESS" "priceSigner()(address)" --rpc-url "$MONAD_RPC_URL"
set -e
cast call "$PERPLY_ARENA_ADDRESS" "minSettlementInterval()(uint32)" --rpc-url "$MONAD_RPC_URL"
cast call "$PERPLY_ARENA_ADDRESS" "volatilityTriggerBps()(uint16)" --rpc-url "$MONAD_RPC_URL"

if [[ "$WRITE_ENV_LOCAL" == "true" ]]; then
  cat > .env.local <<ENVEOF
VITE_PERPLY_ARENA_ADDRESS=$PERPLY_ARENA_ADDRESS
VITE_PYTH_BTC_PRICE_ID=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
VITE_CHAINLINK_BTC_USD_FEED=
VITE_CHAINLINK_MAX_STALENESS_SEC=90
VITE_MONAD_RPC_URLS=$MONAD_RPC_URL
ENVEOF
  echo "Wrote .env.local with VITE_PERPLY_ARENA_ADDRESS=$PERPLY_ARENA_ADDRESS"
fi

echo "DONE. Arena=$PERPLY_ARENA_ADDRESS"
