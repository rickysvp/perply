#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"

MONAD_RPC_URL="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
INITIAL_BTC_PRICE_E8="${INITIAL_BTC_PRICE_E8:-9000000000000}"

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

echo "Deploying PerplyArena to Monad Testnet..."
echo "RPC: ${MONAD_RPC_URL}"
echo "Initial BTC price (1e8): ${INITIAL_BTC_PRICE_E8}"

forge create contracts/PerplyArena.sol:PerplyArena \
  --rpc-url "${MONAD_RPC_URL}" \
  --private-key "${DEPLOYER_PRIVATE_KEY}" \
  --broadcast \
  --constructor-args "${INITIAL_BTC_PRICE_E8}"
