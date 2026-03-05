#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY is required}"

MONAD_RPC_URL="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
INITIAL_BTC_PRICE_E8="${INITIAL_BTC_PRICE_E8:-9000000000000}"

echo "Deploying PerplyArena to Monad Testnet..."
echo "RPC: ${MONAD_RPC_URL}"
echo "Initial BTC price (1e8): ${INITIAL_BTC_PRICE_E8}"

forge create contracts/PerplyArena.sol:PerplyArena \
  --rpc-url "${MONAD_RPC_URL}" \
  --private-key "${DEPLOYER_PRIVATE_KEY}" \
  --broadcast \
  --constructor-args "${INITIAL_BTC_PRICE_E8}"
