#!/usr/bin/env bash
set -euo pipefail

MONAD_RPC_URL="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
PERPLY_ARENA_ADDRESS="${PERPLY_ARENA_ADDRESS:-${VITE_PERPLY_ARENA_ADDRESS:-}}"
: "${PERPLY_ARENA_ADDRESS:?PERPLY_ARENA_ADDRESS (or VITE_PERPLY_ARENA_ADDRESS) is required}"

echo "Running fee smoke check..."
echo "Arena: ${PERPLY_ARENA_ADDRESS}"
echo "RPC: ${MONAD_RPC_URL}"
echo

OPEN_BPS="$(cast call "${PERPLY_ARENA_ADDRESS}" "openFeeBps()(uint16)" --rpc-url "${MONAD_RPC_URL}")"
CLOSE_BPS="$(cast call "${PERPLY_ARENA_ADDRESS}" "closeFeeBps()(uint16)" --rpc-url "${MONAD_RPC_URL}")"
SETTLE_BPS="$(cast call "${PERPLY_ARENA_ADDRESS}" "settlementFeeBps()(uint16)" --rpc-url "${MONAD_RPC_URL}")"

echo "openFeeBps:       ${OPEN_BPS}"
echo "closeFeeBps:      ${CLOSE_BPS}"
echo "settlementFeeBps: ${SETTLE_BPS}"
echo

echo "previewOpen LONG (margin=1e18, leverage=10):"
cast call \
  "${PERPLY_ARENA_ADDRESS}" \
  "previewOpen(uint8,uint256,uint32)(uint256,uint16,uint256,uint256,uint256,uint256)" \
  0 \
  1000000000000000000 \
  10 \
  --rpc-url "${MONAD_RPC_URL}"
echo

if [[ "${OPEN_BPS}" == "50" && "${CLOSE_BPS}" == "50" && "${SETTLE_BPS}" == "1" ]]; then
  echo "PASS: fee params are set to 0.5% / 0.5% / 0.01%"
else
  echo "WARN: fee params do not match expected 50 / 50 / 1"
fi
