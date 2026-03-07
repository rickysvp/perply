# Perply.fun Arena V1.1 (Frontend + Smart Contract)

Web3 long/short arena on Monad testnet.

- Not a classic perp exchange
- Camp-vs-camp settlement engine
- Winner side gets value from loser side
- No backend required for core gameplay

- Frontend: React + Vite
- Smart contract: Solidity + Foundry
- No backend required for trading flow

## Monad Testnet Settings

- Chain Name: `Monad Testnet`
- Chain ID: `10143`
- RPC URL: `https://testnet-rpc.monad.xyz`
- Explorer: `https://testnet.monadvision.com`

## Prerequisites

1. Node.js (v20+ recommended)
2. Foundry (`forge`)
3. MetaMask wallet with Monad testnet configured

## Install

```bash
npm install
```

## Contract Commands

Compile contract:

```bash
npm run contract:build
```

Deploy `PerplyArena` to Monad testnet:

```bash
export DEPLOYER_PRIVATE_KEY=0xyour_private_key
export MONAD_RPC_URL=https://testnet-rpc.monad.xyz
export INITIAL_BTC_PRICE_E8=9000000000000
npm run contract:deploy:monad
```

Apply live risk params (including fees) on an existing deployment:

```bash
export DEPLOYER_PRIVATE_KEY=0xyour_private_key
export PERPLY_ARENA_ADDRESS=0xYourDeployedContractAddress
export MONAD_RPC_URL=https://testnet-rpc.monad.xyz
npm run contract:set-risk:monad
```

`setRiskParams` now queues config updates behind a timelock.  
Run execution after `queuedRiskParamsEta` is reached:

```bash
export EXECUTE_NOW=true
npm run contract:set-risk:monad
```

If a queue is already pending, the script now aborts by default.  
Set `CANCEL_EXISTING_QUEUE=true` to cancel and re-queue:

```bash
export CANCEL_EXISTING_QUEUE=true
npm run contract:set-risk:monad
```

Smoke check live fee params:

```bash
export PERPLY_ARENA_ADDRESS=0xYourDeployedContractAddress
export MONAD_RPC_URL=https://testnet-rpc.monad.xyz
npm run contract:smoke-fees:monad
```

## Frontend Env

Create `.env.local`:

```bash
VITE_PERPLY_ARENA_ADDRESS=0xYourDeployedContractAddress
VITE_PYTH_BTC_PRICE_ID=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
VITE_CHAINLINK_BTC_USD_FEED=0x... # optional
VITE_CHAINLINK_MAX_STALENESS_SEC=90
VITE_MONAD_RPC_URLS=https://testnet-rpc.monad.xyz,https://another-rpc.example
```

Security note: RPC URLs must use `https://` in production. `http://` is only accepted for `localhost`/`127.0.0.1` during local debugging.

## Run Frontend

```bash
npm run dev
```

## RPC Health Probe

- Server endpoint: `GET /api/rpc/health`
- Example response includes per-RPC latency and latest block probe.
- Market proxy endpoint: `GET /api/market/coingecko` (same-origin proxy + cache to avoid browser CORS/rate-limit noise)

## Off-Chain Keeper Signer

Run settlement keeper outside browser:

```bash
export PERPLY_ARENA_ADDRESS=0xYourDeployedContractAddress
export KEEPER_PRIVATE_KEY=0xyour_keeper_pk
export PRICE_SIGNER_PRIVATE_KEY=0xyour_price_signer_pk
export VITE_MONAD_RPC_URLS=https://testnet-rpc.monad.xyz,https://another-rpc.example
export KEEPER_POLL_MS=2000
export KEEPER_MIN_PRICE_SOURCES=2
export KEEPER_MAX_DEVIATION_PCT=10
export KEEPER_CHAIN_ID=10143
export KEEPER_DRY_RUN=false
# transition only (until timelocked signer update is executed):
export KEEPER_ALLOW_SHARED_SIGNER=false
export KEEPER_ALLOW_SHARED_SIGNER_UNTIL=0
npm run keeper:run
```

Security note: `KEEPER_PRIVATE_KEY` and `PRICE_SIGNER_PRIVATE_KEY` must be different keys.

## Secure Automation Ops

Use built-in ops scripts for safer unattended operation:

```bash
# keeper lifecycle
npm run ops:keeper:start
npm run ops:keeper:status
npm run ops:keeper:logs
npm run ops:keeper:restart
npm run ops:keeper:stop

# execute due timelock ops (idempotent)
npm run ops:timelock:run

# watchdog (single check by default)
npm run ops:watchdog:run
```

Ops scripts read `.env` and `.env.local` and write runtime state/logs into `.ops/`.

Print recommended cron entries:

```bash
npm run ops:cron:print
```

Recommended production policy:

1. Keep `owner`, `keeper`, and `priceSigner` on different keys.
2. Enable `KEEPER_ALLOW_SHARED_SIGNER=true` only as a short transition fallback.
3. Run timelock executor and watchdog from cron/systemd with persistent logs.
4. Rotate keys immediately if ever exposed.
5. Do not run owner and keeper with the same key. Ops scripts block this by default (`ALLOW_NONCE_CONFLICT=false`).
6. Keep `AUTO_EXECUTE_OWNERSHIP_TRANSFER=false` unless you intentionally want unattended ownership handover.

Run full security preflight before release:

```bash
npm run preflight:security
```

Release checklist:

- `PRELAUNCH_CHECKLIST.md`

Emergency controls drill (plan-only by default):

```bash
npm run drill:emergency
```

Execute real drill on-chain and auto-rollback to snapshot state:

```bash
export DEPLOYER_PRIVATE_KEY=0xyour_private_key
export PERPLY_ARENA_ADDRESS=0xYourDeployedContractAddress
export EXECUTE=true
export DRILL_CONFIRM=YES
npm run drill:emergency
```

## V1.1 Rules Implemented

1. Open fee `0.5%`
2. Close fee `0.5%`
3. Settlement fee `0.01%` per tick
4. Dynamic congestion surcharge on crowded side
5. Congestion surcharge split: `80%` to opposite camp, `20%` to treasury
6. Tick settlement: `3s` interval + early trigger when volatility threshold reached
7. Liquidation mechanism with maintenance margin and liquidation penalty
8. Frontend fee preview before placing bet (includes congestion surcharge and opponent reward)
9. Fee treasury reserved for future liquidity-pool subsidy programs

## Security Model (V1.2)

1. Direct `settleWithPrice` is disabled by default.
2. Production keeper should call `settleWithSignedPrice` with an off-chain signer.
3. `setRiskParams` is timelocked; execute with `executeRiskParams()` after delay.
4. `paused` and `reduceOnly` can be activated immediately for incident response; disabling them is timelocked.
5. Uncovered loss is tracked as `systemBadDebt`; new opens are blocked until debt is recapitalized.
6. `transferOwnership` and `setMaxPriceAgeSec` are timelocked admin operations (queue + execute).

## V1.1 Source Aggregation

Frontend uses aggregated BTC mark proxy from:

1. Binance
2. Pyth
3. Chainlink (if feed address configured)
4. CoinGecko
