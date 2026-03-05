# Perply.fun V1 (Frontend + Smart Contract)

Web3 perpetual battle arena MVP on Monad testnet.

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
```

## Run Frontend

```bash
npm run dev
```

## V1 Features Implemented

1. MetaMask wallet connect and network switch to Monad testnet
2. On-chain `deposit` / `withdraw`
3. On-chain `openPosition` / `closePosition` (long/short)
4. On-chain position and balance sync in UI
5. Manual on-chain mark price sync from frontend (owner-only tx)
