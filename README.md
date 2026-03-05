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
- Explorer: `https://testnet.monadexplorer.com`

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

## Frontend Env

Create `.env.local`:

```bash
VITE_PERPLY_ARENA_ADDRESS=0xYourDeployedContractAddress
VITE_PYTH_BTC_PRICE_ID=0xe62df6c8b4a85fe1fef3f1a6d5af3f4820553a4f8f8036f2fa14de3cd59adf04
VITE_CHAINLINK_BTC_USD_FEED=0x... # optional
```

## Run Frontend

```bash
npm run dev
```

## V1.1 Rules Implemented

1. Open fee `0.5%`
2. Close fee `0.5%`
3. Settlement fee `0.01%` per tick
4. Dynamic congestion surcharge on crowded side
5. Congestion surcharge split: `80%` to opposite camp, `20%` to treasury
6. Tick settlement: `10s` interval + early trigger when volatility threshold reached
7. Liquidation mechanism with maintenance margin and liquidation penalty
8. Frontend fee preview before placing bet (includes congestion surcharge and opponent reward)
9. Fee treasury reserved for future liquidity-pool subsidy programs

## V1.1 Source Aggregation

Frontend uses aggregated BTC mark proxy from:

1. Binance
2. Pyth
3. Chainlink (if feed address configured)
4. CoinGecko
