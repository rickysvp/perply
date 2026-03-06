#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

run_check() {
  local name="$1"
  shift
  echo "==> ${name}"
  if "$@"; then
    echo "PASS: ${name}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: ${name}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return 1
  fi
  echo
}

run_optional_check() {
  local name="$1"
  shift
  echo "==> ${name}"
  if "$@"; then
    echo "PASS: ${name}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "SKIP: ${name}"
    SKIP_COUNT=$((SKIP_COUNT + 1))
  fi
  echo
}

echo "Perply Security Preflight"
echo "Workspace: ${ROOT_DIR}"
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo

run_check "TypeScript lint" npm run -s lint
run_check "Frontend production build" npm run -s build
run_check "Contract tests" forge test
run_check "Contract compile" npm run -s contract:build
run_check "Production dependency audit" npm audit --omit=dev

if [[ -f ".env.example" ]]; then
  run_check "Required keeper env keys declared" bash -lc "rg -n '^KEEPER_CHAIN_ID=' .env.example >/dev/null && rg -n '^KEEPER_DRY_RUN=' .env.example >/dev/null"
fi

if command -v curl >/dev/null 2>&1; then
  run_optional_check "Server /api/health reachable (localhost:3000)" \
    bash -lc "curl -sS --max-time 3 http://127.0.0.1:3000/api/health | rg -q '\"status\":\"ok\"'"

  run_optional_check "Server /api/rpc/health reachable (localhost:3000)" \
    bash -lc "curl -sS --max-time 6 http://127.0.0.1:3000/api/rpc/health | rg -q '\"results\"'"

  run_optional_check "Server /api/market/coingecko reachable (localhost:3000)" \
    bash -lc "curl -sS --max-time 6 http://127.0.0.1:3000/api/market/coingecko | rg -q '\"ok\":true'"
fi

echo "Preflight Summary: pass=${PASS_COUNT} fail=${FAIL_COUNT} skip=${SKIP_COUNT}"
if [[ ${FAIL_COUNT} -ne 0 ]]; then
  exit 1
fi

