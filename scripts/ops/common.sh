#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="${ROOT_DIR}/.ops"
mkdir -p "${STATE_DIR}"

# Cron/launchd often provide a minimal PATH, which can hide foundry/node bins.
bootstrap_path() {
  local path_parts=()
  [[ -n "${HOME:-}" ]] && path_parts+=("${HOME}/.foundry/bin")
  path_parts+=("/usr/local/bin" "/opt/homebrew/bin" "/usr/bin" "/bin")
  for part in "${path_parts[@]}"; do
    [[ -d "${part}" ]] || continue
    if [[ ":${PATH}:" != *":${part}:"* ]]; then
      PATH="${part}:${PATH}"
    fi
  done
  export PATH
}

bootstrap_path

safe_export_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  while IFS= read -r line || [[ -n "$line" ]]; do
    # Trim leading/trailing spaces.
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"

    if [[ ! "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      continue
    fi

    local key="${line%%=*}"
    local value="${line#*=}"
    # Remove matching surrounding quotes only.
    if [[ "$value" =~ ^\".*\"$ ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$key=$value"
  done < "$file"
}

load_env() {
  safe_export_env_file "${ROOT_DIR}/.env"
  safe_export_env_file "${ROOT_DIR}/.env.local"

  if [[ -z "${PERPLY_ARENA_ADDRESS:-}" && -n "${VITE_PERPLY_ARENA_ADDRESS:-}" ]]; then
    PERPLY_ARENA_ADDRESS="${VITE_PERPLY_ARENA_ADDRESS}"
    export PERPLY_ARENA_ADDRESS
  fi
  if [[ -z "${MONAD_RPC_URL:-}" ]]; then
    MONAD_RPC_URL="https://testnet-rpc.monad.xyz"
    export MONAD_RPC_URL
  fi
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env: ${key}" >&2
    exit 1
  fi
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

now_ts() {
  date +%s
}
