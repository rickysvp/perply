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
  rpcUrls: ['https://testnet-rpc.monad.xyz'],
  blockExplorerUrls: ['https://testnet.monadexplorer.com']
} as const;

export const PERPLY_ARENA_ABI = [
  'function markPriceE8() view returns (uint256)',
  'function availableBalance(address) view returns (uint256)',
  'function lockedMargin(address) view returns (uint256)',
  'function getPosition(address trader, uint8 side) view returns (tuple(uint256 margin, uint32 leverage, uint64 entryPriceE8, bool isOpen))',
  'function deposit() payable',
  'function withdraw(uint256 amount)',
  'function openPosition(uint8 side, uint256 margin, uint32 leverage)',
  'function closePosition(uint8 side)',
  'function setMarkPrice(uint256 newPriceE8)',
  'event PositionOpened(address indexed trader, uint8 indexed side, uint256 margin, uint32 leverage, uint64 entryPriceE8, uint256 feePaid)',
  'event PositionClosed(address indexed trader, uint8 indexed side, uint256 margin, uint32 leverage, uint64 entryPriceE8, uint64 exitPriceE8, int256 pnl, uint256 settlement)'
] as const;

export interface WalletProvider {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export interface ArenaPositionRaw {
  margin: bigint;
  leverage: bigint;
  entryPriceE8: bigint;
  isOpen: boolean;
}

export function getEthereumProvider(): WalletProvider | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { ethereum?: WalletProvider }).ethereum ?? null;
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
  const provider = new ethers.JsonRpcProvider(MONAD_TESTNET.rpcUrls[0]);
  return new ethers.Contract(address, PERPLY_ARENA_ABI, provider);
}
