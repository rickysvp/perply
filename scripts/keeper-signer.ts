import "dotenv/config";
import { ethers } from "ethers";

const DEFAULT_PYTH_BTC_PRICE_ID =
  "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const HTTP_TIMEOUT_MS = 2000;
const MAX_PRICE_E8 = 18_446_744_073_709_551_615n; // type(uint64).max
const COINGECKO_CACHE_TTL_MS = 30_000;
const COINGECKO_STALE_TTL_MS = 120_000;

let cachedCoingeckoPrice: number | null = null;
let cachedCoingeckoAt = 0;

const ARENA_ABI = [
  "function owner() view returns (address)",
  "function keeper() view returns (address)",
  "function priceSigner() view returns (address)",
  "function markPriceE8() view returns (uint256)",
  "function lastSettlementAt() view returns (uint256)",
  "function minSettlementInterval() view returns (uint32)",
  "function volatilityTriggerBps() view returns (uint16)",
  "function settleWithSignedPrice(uint256 newPriceE8, uint64 priceTimestamp, uint64 salt, bytes signature)",
] as const;

function envRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function envRequiredAddress(name: string): string {
  const value = envRequired(name);
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be a valid non-zero address`);
  }
  return value;
}

function isAllowedRpcUrl(urlRaw: string): boolean {
  try {
    const parsed = new URL(urlRaw);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function parseRpcUrls(): string[] {
  const list = (process.env.VITE_MONAD_RPC_URLS || "")
    .split(",")
    .map(item => item.trim())
    .filter(item => item.length > 0 && isAllowedRpcUrl(item));
  const single = (process.env.MONAD_RPC_URL || "").trim();
  const defaults = ["https://testnet-rpc.monad.xyz"];
  return Array.from(new Set([...list, ...(single && isAllowedRpcUrl(single) ? [single] : []), ...defaults]));
}

function toPriceE8(price: number): bigint {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid market price: ${price}`);
  }
  const e8 = BigInt(Math.round(price * 1e8));
  if (e8 <= 0n || e8 > MAX_PRICE_E8) {
    throw new Error(`Market price out of uint64 range: ${e8.toString()}`);
  }
  return e8;
}

function asBigInt(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") return BigInt(value);
  throw new Error(`Unexpected ${label} type: ${typeof value}`);
}

function asSafeNumber(value: unknown, label: string): number {
  const big = asBigInt(value, label);
  if (big < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`${label} is below MIN_SAFE_INTEGER`);
  }
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds MAX_SAFE_INTEGER`);
  }
  return Number(big);
}

async function fetchJson(url: string, timeoutMs = HTTP_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinancePrice(): Promise<number | null> {
  try {
    const data = (await fetchJson("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")) as { price?: string } | null;
    if (!data) return null;
    const price = Number(data.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchCoingeckoPrice(): Promise<number | null> {
  const now = Date.now();
  if (cachedCoingeckoPrice !== null && now - cachedCoingeckoAt < COINGECKO_CACHE_TTL_MS) {
    return cachedCoingeckoPrice;
  }
  try {
    const data = (await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")) as {
      bitcoin?: { usd?: number };
    } | null;
    if (!data) {
      if (cachedCoingeckoPrice !== null && now - cachedCoingeckoAt < COINGECKO_STALE_TTL_MS) {
        return cachedCoingeckoPrice;
      }
      return null;
    }
    const price = Number(data.bitcoin?.usd);
    if (!Number.isFinite(price) || price <= 0) return null;
    cachedCoingeckoPrice = price;
    cachedCoingeckoAt = now;
    return price;
  } catch {
    if (cachedCoingeckoPrice !== null && now - cachedCoingeckoAt < COINGECKO_STALE_TTL_MS) {
      return cachedCoingeckoPrice;
    }
    return null;
  }
}

async function fetchPythPrice(): Promise<number | null> {
  try {
    const configured = process.env.VITE_PYTH_BTC_PRICE_ID?.trim();
    const candidateIds = Array.from(new Set([DEFAULT_PYTH_BTC_PRICE_ID, configured].filter(Boolean))) as string[];

    for (const pythPriceId of candidateIds) {
      const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${pythPriceId}`;
      const data = (await fetchJson(url)) as {
        parsed?: Array<{ price?: { price?: string; expo?: number } }>;
      } | null;
      if (!data) continue;
      const entry = data.parsed?.[0]?.price;
      if (!entry?.price || entry.expo === undefined) continue;
      const value = Number(entry.price) * Math.pow(10, entry.expo);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchChainlinkPrice(provider: ethers.JsonRpcProvider): Promise<number | null> {
  try {
    const feedAddress = process.env.VITE_CHAINLINK_BTC_USD_FEED?.trim();
    if (!feedAddress) return null;
    const maxStalenessSec = Number(process.env.VITE_CHAINLINK_MAX_STALENESS_SEC || 90);
    if (!Number.isFinite(maxStalenessSec) || maxStalenessSec <= 0) return null;

    const feed = new ethers.Contract(
      feedAddress,
      ["function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"],
      provider
    );
    const round = (await feed.latestRoundData()) as [bigint, bigint, bigint, bigint, bigint];
    const roundId = round[0];
    const answer = round[1];
    const updatedAt = round[3];
    const answeredInRound = round[4];
    if (answer <= 0n || updatedAt === 0n || answeredInRound < roundId) return null;

    const ageSec = Math.floor(Date.now() / 1000) - Number(updatedAt);
    if (!Number.isFinite(ageSec) || ageSec < 0 || ageSec > maxStalenessSec) return null;
    const answerNum = Number(answer);
    return Number.isFinite(answerNum) && answerNum > 0 ? answerNum / 1e8 : null;
  } catch {
    return null;
  }
}

function aggregatePrices(prices: number[]): number | null {
  if (prices.length === 0) return null;
  if (prices.length === 1) return prices[0];
  const sorted = [...prices].sort((a, b) => a - b);
  if (sorted.length >= 3) {
    const trimmed = sorted.slice(1, sorted.length - 1);
    return trimmed.reduce((acc, val) => acc + val, 0) / trimmed.length;
  }
  return sorted.reduce((acc, val) => acc + val, 0) / sorted.length;
}

async function fetchAggregatedPrice(provider: ethers.JsonRpcProvider): Promise<{ price: number; sourceCount: number } | null> {
  const results = await Promise.all([
    fetchBinancePrice(),
    fetchPythPrice(),
    fetchCoingeckoPrice(),
    fetchChainlinkPrice(provider),
  ]);
  const prices = results.filter((val): val is number => typeof val === "number" && Number.isFinite(val) && val > 0);
  const aggregated = aggregatePrices(prices);
  if (!aggregated) return null;
  return { price: aggregated, sourceCount: prices.length };
}

async function getHealthyProvider(rpcUrls: string[]): Promise<ethers.JsonRpcProvider> {
  let lastError: unknown = null;
  for (const url of rpcUrls) {
    const provider = new ethers.JsonRpcProvider(url);
    try {
      await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`RPC timeout: ${url}`)), HTTP_TIMEOUT_MS)),
      ]);
      return provider;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`No healthy RPC endpoint. Last error: ${String(lastError)}`);
}

async function main() {
  const arenaAddress = envRequiredAddress("PERPLY_ARENA_ADDRESS");
  const keeperPk = envRequired("KEEPER_PRIVATE_KEY");
  const priceSignerPk = envRequired("PRICE_SIGNER_PRIVATE_KEY");
  const pollMs = Number(process.env.KEEPER_POLL_MS || 5_000);
  const minSources = Number(process.env.KEEPER_MIN_PRICE_SOURCES || 2);
  const maxDeviationPct = Number(process.env.KEEPER_MAX_DEVIATION_PCT || 10);
  const expectedChainId = BigInt(process.env.KEEPER_CHAIN_ID || 10143);
  const dryRun = (process.env.KEEPER_DRY_RUN || "").toLowerCase() === "true";
  const rpcUrls = parseRpcUrls();

  if (!Number.isFinite(pollMs) || pollMs < 2_000) {
    throw new Error("KEEPER_POLL_MS must be >= 2000");
  }
  if (!Number.isFinite(minSources) || minSources < 1) {
    throw new Error("KEEPER_MIN_PRICE_SOURCES must be >= 1");
  }
  if (!Number.isFinite(maxDeviationPct) || maxDeviationPct <= 0) {
    throw new Error("KEEPER_MAX_DEVIATION_PCT must be > 0");
  }
  if (expectedChainId <= 0n) {
    throw new Error("KEEPER_CHAIN_ID must be a positive integer");
  }
  if (keeperPk === priceSignerPk) {
    throw new Error("KEEPER_PRIVATE_KEY and PRICE_SIGNER_PRIVATE_KEY must be different");
  }

  let running = false;
  let saltSeed = BigInt(Math.floor(Date.now() / 1000));

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const provider = await getHealthyProvider(rpcUrls);
      const keeperWallet = new ethers.Wallet(keeperPk, provider);
      const signerWallet = new ethers.Wallet(priceSignerPk);
      if (keeperWallet.address.toLowerCase() === signerWallet.address.toLowerCase()) {
        throw new Error("keeper and price signer addresses must be different");
      }
      const keeperContract = new ethers.Contract(arenaAddress, ARENA_ABI, keeperWallet);
      const readContract = new ethers.Contract(arenaAddress, ARENA_ABI, provider);

      const [owner, keeper, configuredSigner, markPriceE8Raw, lastSettlementAtRaw, minSettlementIntervalRaw, volatilityTriggerBpsRaw] =
        await Promise.all([
          readContract.owner() as Promise<string>,
          readContract.keeper() as Promise<string>,
          readContract.priceSigner() as Promise<string>,
          readContract.markPriceE8() as Promise<unknown>,
          readContract.lastSettlementAt() as Promise<unknown>,
          readContract.minSettlementInterval() as Promise<unknown>,
          readContract.volatilityTriggerBps() as Promise<unknown>,
        ]);
      const market = await fetchAggregatedPrice(provider);

      if (!market) {
        console.log("[keeper] skip: no market price source available");
        return;
      }
      if (market.sourceCount < minSources) {
        console.log(`[keeper] skip: insufficient price sources (${market.sourceCount}/${minSources})`);
        return;
      }

      const keeperAddr = keeperWallet.address.toLowerCase();
      if (keeperAddr !== owner.toLowerCase() && keeperAddr !== keeper.toLowerCase()) {
        console.log("[keeper] skip: KEEPER_PRIVATE_KEY is not owner/keeper");
        return;
      }

      if (configuredSigner.toLowerCase() !== signerWallet.address.toLowerCase()) {
        console.log("[keeper] skip: PRICE_SIGNER_PRIVATE_KEY does not match contract priceSigner");
        return;
      }

      const markPriceE8 = asBigInt(markPriceE8Raw, "markPriceE8");
      const lastSettlementAt = asSafeNumber(lastSettlementAtRaw, "lastSettlementAt");
      const minSettlementInterval = asSafeNumber(minSettlementIntervalRaw, "minSettlementInterval");
      const volatilityTriggerBps = asSafeNumber(volatilityTriggerBpsRaw, "volatilityTriggerBps");

      const currentMark = Number(markPriceE8) / 1e8;
      const deltaPct = currentMark > 0 ? Math.abs(market.price - currentMark) / currentMark * 100 : 0;
      const nowSec = Math.floor(Date.now() / 1000);
      const elapsed = nowSec - lastSettlementAt;
      if (nowSec <= lastSettlementAt) {
        console.log(`[keeper] skip: local clock is not ahead of last settlement (${nowSec} <= ${lastSettlementAt})`);
        return;
      }
      const triggerPct = volatilityTriggerBps / 100;
      const shouldSettle = elapsed >= minSettlementInterval || deltaPct >= triggerPct;

      if (!shouldSettle) {
        console.log(
          `[keeper] idle: price=${market.price.toFixed(2)} mark=${currentMark.toFixed(2)} ` +
          `elapsed=${elapsed}s/${minSettlementInterval}s delta=${deltaPct.toFixed(4)}% trigger=${triggerPct.toFixed(4)}%`
        );
        return;
      }
      if (deltaPct > maxDeviationPct) {
        console.log(`[keeper] skip: delta ${deltaPct.toFixed(4)}% exceeds max deviation ${maxDeviationPct.toFixed(4)}%`);
        return;
      }

      const network = await provider.getNetwork();
      if (network.chainId !== expectedChainId) {
        console.log(`[keeper] skip: chainId mismatch (${network.chainId.toString()} != ${expectedChainId.toString()})`);
        return;
      }
      const priceE8 = toPriceE8(market.price);
      const timestampSec = BigInt(nowSec);
      saltSeed += 1n;
      const salt = saltSeed;

      const digest = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "uint64", "uint64"],
        [arenaAddress, network.chainId, priceE8, timestampSec, salt]
      );
      const signature = await signerWallet.signMessage(ethers.getBytes(digest));

      if (dryRun) {
        console.log(
          `[keeper] dry-run: would settle price=${market.price.toFixed(2)} sources=${market.sourceCount} ` +
          `timestamp=${timestampSec.toString()}`
        );
        return;
      }

      const tx = await keeperContract.settleWithSignedPrice(priceE8, timestampSec, salt, signature);
      const receipt = await tx.wait();
      console.log(
        `[keeper] settled: tx=${tx.hash} block=${receipt?.blockNumber ?? "?"} ` +
        `price=${market.price.toFixed(2)} sources=${market.sourceCount}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[keeper] error: ${message}`);
    } finally {
      running = false;
    }
  };

  console.log(`[keeper] start: arena=${arenaAddress} poll=${pollMs}ms dryRun=${dryRun} rpc=${rpcUrls.join(",")}`);
  await tick();
  const timer = setInterval(() => {
    void tick();
  }, pollMs);

  const shutdown = () => {
    clearInterval(timer);
    console.log("[keeper] stopped");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
