import { ethers } from 'ethers';

export const MONAD_TESTNET = {
  chainId: 10143,
  chainIdHex: '0x279f',
  chainName: 'Monad Testnet',
  nativeCurrency: {
    name: 'Monad',
    symbol: 'MON',
    decimals: 18
  },
  rpcUrls: [
    'https://testnet-rpc.monad.xyz',
    'https://rpc.ankr.com/monad_testnet'
  ],
  blockExplorerUrls: ['https://testnet.monadvision.com']
} as const;

const DEFAULT_RPC_TIMEOUT_MS = 5000;
let cachedHealthyRpcUrl: string | null = null;

export const PERPLY_ARENA_ABI = [
  'function owner() view returns (address)',
  'function keeper() view returns (address)',
  'function markPriceE8() view returns (uint256)',
  'function lastSettlementAt() view returns (uint256)',
  'function minSettlementInterval() view returns (uint32)',
  'function volatilityTriggerBps() view returns (uint16)',
  'function settlementStrengthBps() view returns (uint16)',
  'function maxSettlementTransferBps() view returns (uint16)',
  'function settlementFeeBps() view returns (uint16)',
  'function availableBalance(address) view returns (uint256)',
  'function sideMargin(uint256) view returns (uint256)',
  'function getPosition(address trader, uint8 side) view returns (tuple(uint256 margin, uint256 weight, uint32 leverage, uint64 entryPriceE8, bool isOpen, int256 pnl, int256 equity, uint256 maintenanceMargin))',
  'function getCongestionRatesBps() view returns (uint16 longRate, uint16 shortRate)',
  'function cumulativeCongestionRewards(uint256 side) view returns (uint256)',
  'function sideWeight(uint256 side) view returns (uint256)',
  'function previewOpen(uint8 side, uint256 margin, uint32 leverage) view returns (uint256 openFee, uint16 congestionRateBps, uint256 congestionFee, uint256 congestionToOpposite, uint256 congestionToTreasury, uint256 totalRequired)',
  'function deposit() payable',
  'function withdraw(uint256 amount)',
  'function openPosition(uint8 side, uint256 margin, uint32 leverage)',
  'function closePosition(uint8 side)',
  'function settleWithPrice(uint256 newPriceE8)',
  'event Settled(uint256 oldPriceE8, uint256 newPriceE8, uint8 winnerSide, uint8 loserSide, uint256 grossTransfer, uint256 settlementFee, uint256 winnerNet, uint256 matchedWeight)',
  'event PositionOpened(address indexed trader, uint8 indexed side, uint256 margin, uint32 leverage, uint256 weight, uint256 openFee, uint16 congestionRateBps, uint256 congestionFee, uint256 congestionToOpposite, uint256 congestionToTreasury)',
  'event PositionClosed(address indexed trader, uint8 indexed side, uint256 margin, uint256 weight, uint32 leverage, int256 pnl, int256 equityBeforeFees, uint256 closeFee, uint256 payout)'
] as const;

export interface WalletProvider {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isOKExWallet?: boolean;
  isOkxWallet?: boolean;
  isBinance?: boolean;
  isBinanceWallet?: boolean;
  isBinanceChainWallet?: boolean;
  isRabby?: boolean;
  isBackpack?: boolean;
  isPhantom?: boolean;
  providers?: WalletProvider[];
}

export interface DiscoveredWallet {
  id: string;
  name: string;
  provider: WalletProvider;
  rdns?: string;
  icon?: string;
}

export interface ArenaPositionRaw {
  margin: bigint;
  weight: bigint;
  leverage: bigint;
  entryPriceE8: bigint;
  isOpen: boolean;
  pnl: bigint;
  equity: bigint;
  maintenanceMargin: bigint;
}

export interface RpcHealthProbe {
  url: string;
  ok: boolean;
  latencyMs: number;
  blockNumber?: number;
  error?: string;
}

function parseRpcUrls(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

function isAllowedRpcUrl(urlRaw: string): boolean {
  try {
    const parsed = new URL(urlRaw);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol !== 'http:') return false;
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

function prioritizeRpcUrls(urls: string[]): string[] {
  return [...urls].sort((a, b) => {
    const aRateLimited = a.includes('testnet-rpc.monad.xyz') ? 1 : 0;
    const bRateLimited = b.includes('testnet-rpc.monad.xyz') ? 1 : 0;
    return aRateLimited - bRateLimited;
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, reason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(reason)), timeoutMs);
    promise
      .then(value => {
        globalThis.clearTimeout(timer);
        resolve(value);
      })
      .catch(error => {
        globalThis.clearTimeout(timer);
        reject(error);
      });
  });
}

export function getMonadRpcUrls(): string[] {
  const customList = parseRpcUrls(import.meta.env.VITE_MONAD_RPC_URLS).filter(isAllowedRpcUrl);
  const single = parseRpcUrls(import.meta.env.VITE_MONAD_RPC_URL).filter(isAllowedRpcUrl);
  return prioritizeRpcUrls(uniqueUrls([...customList, ...single, ...MONAD_TESTNET.rpcUrls]));
}

export async function probeMonadRpcUrls(timeoutMs = DEFAULT_RPC_TIMEOUT_MS): Promise<RpcHealthProbe[]> {
  const urls = getMonadRpcUrls();
  const probes = await Promise.all(urls.map(async (url): Promise<RpcHealthProbe> => {
    const provider = new ethers.JsonRpcProvider(url);
    const start = Date.now();
    try {
      const blockNumber = await withTimeout(
        provider.getBlockNumber(),
        timeoutMs,
        `RPC timeout: ${url}`
      );
      const latencyMs = Date.now() - start;
      return {
        url,
        ok: true,
        latencyMs: Math.round(latencyMs),
        blockNumber
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        url,
        ok: false,
        latencyMs: Math.round(latencyMs),
        error: message
      };
    }
  }));
  return probes;
}

export async function getRpcProviderWithFallback(timeoutMs = DEFAULT_RPC_TIMEOUT_MS): Promise<ethers.JsonRpcProvider> {
  const urls = getMonadRpcUrls();
  const ordered = cachedHealthyRpcUrl
    ? [cachedHealthyRpcUrl, ...urls.filter(url => url !== cachedHealthyRpcUrl)]
    : urls;

  for (const url of ordered) {
    const provider = new ethers.JsonRpcProvider(url);
    try {
      await withTimeout(provider.getBlockNumber(), timeoutMs, `RPC timeout: ${url}`);
      cachedHealthyRpcUrl = url;
      return provider;
    } catch {
      // try next rpc endpoint
    }
  }

  throw new Error(`No healthy Monad RPC endpoint from: ${ordered.join(', ')}`);
}

export function getEthereumProvider(): WalletProvider | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { ethereum?: WalletProvider }).ethereum ?? null;
}

function classifyWalletName(provider: WalletProvider, hint?: string): string {
  const text = (hint ?? '').toLowerCase();
  if (provider.isRabby || text.includes('rabby')) return 'Rabby';
  if (provider.isOKExWallet || provider.isOkxWallet || text.includes('okx')) return 'OKX Wallet';
  if (provider.isBinance || provider.isBinanceWallet || provider.isBinanceChainWallet || text.includes('binance') || text.includes('bnb')) return 'Binance Wallet';
  if (provider.isBackpack || text.includes('backpack')) return 'Backpack';
  if (provider.isPhantom || text.includes('phantom')) return 'Phantom';
  if (provider.isMetaMask || text.includes('metamask')) return 'MetaMask';
  return hint?.trim() || 'EVM Wallet';
}

function walletPriority(name: string): number {
  const normalized = name.toLowerCase();
  if (normalized.includes('metamask')) return 0;
  if (normalized.includes('okx')) return 1;
  if (normalized.includes('rabby')) return 2;
  if (normalized.includes('binance')) return 3;
  if (normalized.includes('backpack')) return 4;
  if (normalized.includes('phantom')) return 5;
  return 50;
}

function isWalletProvider(value: unknown): value is WalletProvider {
  return Boolean(value) && typeof (value as WalletProvider).request === 'function';
}

export function inferWalletName(provider: WalletProvider | null): string {
  if (!provider) return 'Wallet';
  return classifyWalletName(provider);
}

export async function discoverWallets(timeoutMs = 220): Promise<DiscoveredWallet[]> {
  if (typeof window === 'undefined') return [];

  const wallets: DiscoveredWallet[] = [];
  const seen = new WeakSet<object>();
  const usedIds = new Set<string>();

  const addWallet = (
    provider: unknown,
    meta?: {
      name?: string;
      rdns?: string;
      icon?: string;
      uuid?: string;
    }
  ) => {
    if (!isWalletProvider(provider)) return;
    if (seen.has(provider as object)) return;

    seen.add(provider as object);
    const name = classifyWalletName(provider, meta?.name);
    const baseIdRaw = meta?.uuid || meta?.rdns || name;
    const baseId = baseIdRaw.toLowerCase().replace(/[^a-z0-9-_.]+/g, '-');
    let id = baseId;
    let i = 1;
    while (usedIds.has(id)) {
      i += 1;
      id = `${baseId}-${i}`;
    }
    usedIds.add(id);

    wallets.push({
      id,
      name,
      provider,
      rdns: meta?.rdns,
      icon: meta?.icon
    });
  };

  const eip6963Handler = (event: Event) => {
    const detail = (event as CustomEvent).detail as
      | {
          info?: { name?: string; rdns?: string; icon?: string; uuid?: string };
          provider?: WalletProvider;
        }
      | undefined;
    addWallet(detail?.provider, detail?.info);
  };

  window.addEventListener('eip6963:announceProvider', eip6963Handler as EventListener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  await new Promise(resolve => window.setTimeout(resolve, timeoutMs));
  window.removeEventListener('eip6963:announceProvider', eip6963Handler as EventListener);

  const w = window as Window & {
    ethereum?: WalletProvider;
    okxwallet?: { ethereum?: WalletProvider };
    binancew3w?: { ethereum?: WalletProvider };
    binance?: { ethereum?: WalletProvider };
    BinanceChain?: WalletProvider;
    rabby?: { ethereum?: WalletProvider };
    backpack?: { ethereum?: WalletProvider };
    phantom?: { ethereum?: WalletProvider };
  };

  const maybeEthereum = w.ethereum;
  if (maybeEthereum?.providers && Array.isArray(maybeEthereum.providers)) {
    for (const provider of maybeEthereum.providers) {
      addWallet(provider);
    }
  }
  addWallet(maybeEthereum);
  addWallet(w.okxwallet?.ethereum, { name: 'OKX Wallet', rdns: 'com.okex.wallet' });
  addWallet(w.binancew3w?.ethereum, { name: 'Binance Wallet', rdns: 'com.binance.wallet' });
  addWallet(w.binance?.ethereum, { name: 'Binance Wallet', rdns: 'com.binance.wallet' });
  addWallet(w.BinanceChain, { name: 'Binance Wallet', rdns: 'com.binance.wallet' });
  addWallet(w.rabby?.ethereum, { name: 'Rabby', rdns: 'io.rabby' });
  addWallet(w.backpack?.ethereum, { name: 'Backpack', rdns: 'io.backpack' });
  addWallet(w.phantom?.ethereum, { name: 'Phantom', rdns: 'app.phantom' });

  wallets.sort((a, b) => {
    const p = walletPriority(a.name) - walletPriority(b.name);
    if (p !== 0) return p;
    return a.name.localeCompare(b.name);
  });

  return wallets;
}

export function getArenaAddress(): string | null {
  const raw = import.meta.env.VITE_PERPLY_ARENA_ADDRESS;
  if (!raw || typeof raw !== 'string') return null;
  return raw.trim() || null;
}

export function shortenAddress(address: string | null): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function toPriceE8(price: number): bigint {
  return BigInt(Math.round(price * 1e8));
}

export function fromPriceE8(value: bigint): number {
  return Number(value) / 1e8;
}

export async function ensureMonadTestnet(provider: WalletProvider): Promise<void> {
  const currentChain = await provider.request({ method: 'eth_chainId' }) as string;
  if (currentChain?.toLowerCase() === MONAD_TESTNET.chainIdHex) return;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: MONAD_TESTNET.chainIdHex }]
    });
    return;
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code !== 4902) throw error;
  }

  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [MONAD_TESTNET]
  });
}

export async function getReadonlyArenaContract() {
  const address = getArenaAddress();
  if (!address) return null;
  const provider = await getRpcProviderWithFallback();
  return new ethers.Contract(address, PERPLY_ARENA_ABI, provider);
}
