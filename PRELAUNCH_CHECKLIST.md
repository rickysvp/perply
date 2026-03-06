# Perply Prelaunch Checklist

Use this checklist before every production release candidate.

## 1) Smart Contract Governance

- [ ] `owner` and `keeper` addresses are verified against deployment plan.
- [ ] `priceSigner` is verified and rotated via timelock flow only.
- [ ] `adminOpsTimelockSec` and `riskParamsTimelockSec` are set to approved delays.
- [ ] No admin operation queue is left pending unexpectedly.
- [ ] `directSettlementEnabled` is set according to release policy.
- [ ] `paused` and `reduceOnly` defaults match release intent.

## 2) Risk/Funds Controls

- [ ] `systemBadDebt == 0` before enabling normal opening flow.
- [ ] Treasury and insurance withdrawal queues are empty or explicitly approved.
- [ ] Insurance recapitalization playbook is ready and tested.
- [ ] Emergency pause and reduce-only commands are documented for on-call.

## 3) Keeper Safety

- [ ] `KEEPER_CHAIN_ID` is correct for target network.
- [ ] `KEEPER_DRY_RUN=false` for real settlement; `true` for drills only.
- [ ] Keeper keys are loaded from secure secret store (not plain shell history).
- [ ] `KEEPER_MIN_PRICE_SOURCES` and `KEEPER_MAX_DEVIATION_PCT` are approved.
- [ ] Keeper logs are captured and monitored for repeated skip/error states.

## 4) Frontend/Server Runtime

- [ ] Wallet connect, guide flow, and basic trading path are smoke-tested.
- [ ] `/api/rpc/health` responds with at least one healthy RPC endpoint.
- [ ] `/api/market/coingecko` responds and cache fallback works.
- [ ] UI shows degraded status when sources drop below threshold.
- [ ] No critical console/runtime errors in browser during smoke test.

## 5) Automated Gates

- [ ] `npm run -s lint`
- [ ] `npm run -s build`
- [ ] `forge test`
- [ ] `npm run -s contract:build`
- [ ] `npm audit --omit=dev`
- [ ] `npm run -s preflight:security`

## 6) Incident Readiness

- [ ] On-call list and escalation path are current.
- [ ] Rollback plan is prepared (frontend + keeper config + admin toggles).
- [ ] Post-release monitoring window and owner are assigned.
- [ ] Emergency controls drill completed:
  `npm run drill:emergency` (plan-only) and approved on-chain drill window scheduled if needed.
