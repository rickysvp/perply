/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from 'react';
import React from 'react';
import { ethers } from 'ethers';
import { Zap, Wallet, ChevronDown, ChevronUp, TrendingUp, TrendingDown } from 'lucide-react';
import BattleCanvas from './components/BattleCanvas';
import TradingModal from './components/TradingModal';

import { BattleRecord, UserPositions, Position } from './types';
import {
  discoverWallets,
  DiscoveredWallet,
  ensureMonadTestnet,
  fromPriceE8,
  getArenaAddress,
  getEthereumProvider,
  inferWalletName,
  MONAD_TESTNET,
  PERPLY_ARENA_ABI,
  WalletProvider,
  shortenAddress,
  toPriceE8
} from './web3/perplyArena';

const DEFAULT_PRICE = 64289.40;
const DEFAULT_BALANCE = 0;
const MIN_DEPOSIT_MON = 10;
const PRICE_HISTORY_POINTS = 40;
const MARKET_POLL_MS = 3000;
const DEFAULT_PYTH_BTC_PRICE_ID = '0xe62df6c8b4a85fe1fef3f1a6d5af3f4820553a4f8f8036f2fa14de3cd59adf04';

interface PriceAggregate {
  price: number;
  sourceCount: number;
}

interface OpenPreview {
  openFee: number;
  congestionRateBps: number;
  congestionFee: number;
  congestionToOpposite: number;
  congestionToTreasury: number;
  totalRequired: number;
}

interface SettlementRow {
  id: string;
  time: string;
  direction: 'up' | 'down' | 'flat';
  winner: 'LONG' | 'SHORT' | 'NONE';
  grossTransfer: number;
  winnerNet: number;
  settlementFee: number;
}

interface CongestionRow {
  id: string;
  time: string;
  trader: string;
  side: 'LONG' | 'SHORT';
  congestionRate: number;
  congestionFee: number;
  toOpposite: number;
  toTreasury: number;
}

async function fetchBinancePrice(): Promise<number | null> {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    if (!res.ok) return null;
    const data = await res.json() as { price?: string };
    const price = Number(data.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchCoingeckoPrice(): Promise<number | null> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    if (!res.ok) return null;
    const data = await res.json() as { bitcoin?: { usd?: number } };
    const price = Number(data.bitcoin?.usd);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchPythPrice(): Promise<number | null> {
  try {
    const pythPriceId = import.meta.env.VITE_PYTH_BTC_PRICE_ID || DEFAULT_PYTH_BTC_PRICE_ID;
    const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${pythPriceId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as {
      parsed?: Array<{ price?: { price?: string; expo?: number } }>;
    };
    const entry = data.parsed?.[0]?.price;
    if (!entry?.price || entry.expo === undefined) return null;
    const value = Number(entry.price) * Math.pow(10, entry.expo);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function fetchChainlinkPrice(): Promise<number | null> {
  try {
    const feedAddress = import.meta.env.VITE_CHAINLINK_BTC_USD_FEED;
    if (!feedAddress) return null;
    const provider = new ethers.JsonRpcProvider(MONAD_TESTNET.rpcUrls[0]);
    const feed = new ethers.Contract(
      feedAddress,
      ['function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'],
      provider
    );
    const round = await feed.latestRoundData() as [bigint, bigint, bigint, bigint, bigint];
    const answer = Number(round[1]);
    if (!Number.isFinite(answer) || answer <= 0) return null;
    return answer / 1e8;
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
    const sum = trimmed.reduce((acc, val) => acc + val, 0);
    return sum / trimmed.length;
  }

  const sum = sorted.reduce((acc, val) => acc + val, 0);
  return sum / sorted.length;
}

async function fetchBtcPrice(): Promise<PriceAggregate | null> {
  const results = await Promise.all([
    fetchBinancePrice(),
    fetchPythPrice(),
    fetchChainlinkPrice(),
    fetchCoingeckoPrice()
  ]);
  const prices = results.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const aggregated = aggregatePrices(prices);
  if (!aggregated) return null;
  return { price: aggregated, sourceCount: prices.length };
}

export default function App() {
  const [price, setPrice] = useState(DEFAULT_PRICE);
  const [priceHistory, setPriceHistory] = useState<number[]>(Array(PRICE_HISTORY_POINTS).fill(DEFAULT_PRICE));
  const [dominance, setDominance] = useState(0);
  const [allianceLiquidity, setAllianceLiquidity] = useState(0);
  const [syndicateLiquidity, setSyndicateLiquidity] = useState(0);
  const [trend, setTrend] = useState<'bull' | 'bear' | 'neutral'>('neutral');
  const [latestPnL, setLatestPnL] = useState<{ faction: 'left' | 'right'; amount: string } | null>(null);
  const [battleHistory, setBattleHistory] = useState<BattleRecord[]>([]);
  const [isGlitching, setIsGlitching] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletProvider, setWalletProvider] = useState<WalletProvider | null>(null);
  const [connectedWalletName, setConnectedWalletName] = useState<string | null>(null);
  const [walletOptions, setWalletOptions] = useState<DiscoveredWallet[]>([]);
  const [isWalletPickerOpen, setIsWalletPickerOpen] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [priceFeedStatus, setPriceFeedStatus] = useState<'live' | 'degraded'>('live');
  const [isTxPending, setIsTxPending] = useState(false);
  const [onchainMarkPrice, setOnchainMarkPrice] = useState<number | null>(null);
  const [longCongestionRateBps, setLongCongestionRateBps] = useState(0);
  const [shortCongestionRateBps, setShortCongestionRateBps] = useState(0);
  const [longCongestionRewards, setLongCongestionRewards] = useState(0);
  const [shortCongestionRewards, setShortCongestionRewards] = useState(0);
  const [contractOwner, setContractOwner] = useState<string | null>(null);
  const [contractKeeper, setContractKeeper] = useState<string | null>(null);
  const [minSettlementIntervalSec, setMinSettlementIntervalSec] = useState(10);
  const [volatilityTriggerPct, setVolatilityTriggerPct] = useState(0.15);
  const [lastSettlementAt, setLastSettlementAt] = useState<number | null>(null);
  const [isAutoKeeperEnabled, setIsAutoKeeperEnabled] = useState(false);
  const [recentSettlements, setRecentSettlements] = useState<SettlementRow[]>([]);
  const [recentCongestionFees, setRecentCongestionFees] = useState<CongestionRow[]>([]);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [isTradingModalOpen, setIsTradingModalOpen] = useState(false);
  const [tradingSide, setTradingSide] = useState<'long' | 'short'>('long');

  const [userBalance, setUserBalance] = useState(DEFAULT_BALANCE);
  const [userPositions, setUserPositions] = useState<UserPositions>({
    long: null,
    short: null
  });
  const arenaAddress = getArenaAddress();
  const isContractConfigured = Boolean(arenaAddress);
  const isWalletConnected = walletAddress !== null;
  const walletLabel = shortenAddress(walletAddress);
  const connectedWalletLabel = connectedWalletName ?? 'Wallet';
  const isKeeperAuthorized = useMemo(() => {
    if (!walletAddress) return false;
    const addr = walletAddress.toLowerCase();
    return addr === contractOwner?.toLowerCase() || addr === contractKeeper?.toLowerCase();
  }, [walletAddress, contractOwner, contractKeeper]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(val);
  };

  const formatAmount = (val: number, maxFractionDigits = 4) => {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxFractionDigits }).format(val);
  };

  const formatFixedAmount = (val: number, fractionDigits = 2) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(val);
  };

  const parseAmountInput = (raw: string | null): number | null => {
    if (raw === null) return null;
    const normalized = raw.trim().replace(',', '.');
    if (!normalized) return null;
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0) {
      setWalletError('Invalid amount. Example: 0.1');
      return null;
    }
    return amount;
  };

  const toReadableError = (error: unknown, fallback: string): string => {
    const code = (error as { code?: number })?.code;
    const message = (error as { shortMessage?: string; message?: string })?.shortMessage
      ?? (error as { message?: string })?.message
      ?? fallback;
    const lower = message.toLowerCase();

    if (code === 4001 || lower.includes('user rejected')) {
      return 'Transaction rejected in wallet';
    }
    if (lower.includes('insufficient funds')) {
      return 'Wallet MON balance is insufficient (amount + gas)';
    }
    if (lower.includes('missing v')) {
      return 'Invalid wallet signature payload';
    }
    return message;
  };

  const formatTimestamp = (timestampSec: number): string => {
    return new Date(timestampSec * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const parseEventOrder = (id: string): number => {
    const [blockRaw, idxRaw] = id.split('-');
    const block = Number(blockRaw);
    const idx = Number(idxRaw ?? '0');
    if (!Number.isFinite(block)) return 0;
    return block * 1_000_000 + (Number.isFinite(idx) ? idx : 0);
  };

  const refreshArenaHistory = async (provider: ethers.JsonRpcProvider, contract: ethers.Contract) => {
    try {
      const latestBlock = await provider.getBlockNumber();
      const fromBlock = latestBlock > 2000 ? latestBlock - 2000 : 0;

      const [settledLogs, openLogs] = await Promise.all([
        contract.queryFilter(contract.filters.Settled(), fromBlock, latestBlock),
        contract.queryFilter(contract.filters.PositionOpened(), fromBlock, latestBlock)
      ]);

      const settlementRows: SettlementRow[] = settledLogs.slice(-12).reverse().map((log: any) => {
        const args = log.args;
        const oldPrice = Number(args.oldPriceE8 ?? args[0]) / 1e8;
        const newPrice = Number(args.newPriceE8 ?? args[1]) / 1e8;
        const direction: 'up' | 'down' | 'flat' = newPrice > oldPrice ? 'up' : (newPrice < oldPrice ? 'down' : 'flat');
        const winnerSide = Number(args.winnerSide ?? args[2]);
        const winner = winnerSide === 0 ? 'LONG' : winnerSide === 1 ? 'SHORT' : 'NONE';
        const blockTime = Number((log as any).blockTimestamp ?? 0);

        return {
          id: `${log.blockNumber}-${log.index}`,
          time: blockTime > 0 ? formatTimestamp(blockTime) : `${log.blockNumber}`,
          direction,
          winner,
          grossTransfer: Number(ethers.formatEther(args.grossTransfer ?? args[4])),
          winnerNet: Number(ethers.formatEther(args.winnerNet ?? args[6])),
          settlementFee: Number(ethers.formatEther(args.settlementFee ?? args[5]))
        };
      });

      const congestionRows: CongestionRow[] = openLogs
        .filter((log: any) => Number(log.args?.congestionFee ?? log.args?.[7] ?? 0) > 0)
        .slice(-12)
        .reverse()
        .map((log: any) => {
          const args = log.args;
          const side = Number(args.side ?? args[1]) === 0 ? 'LONG' : 'SHORT';
          const blockTime = Number((log as any).blockTimestamp ?? 0);
          return {
            id: `${log.blockNumber}-${log.index}`,
            time: blockTime > 0 ? formatTimestamp(blockTime) : `${log.blockNumber}`,
            trader: shortenAddress(args.trader ?? args[0]),
            side,
            congestionRate: Number(args.congestionRateBps ?? args[6]) / 100,
            congestionFee: Number(ethers.formatEther(args.congestionFee ?? args[7])),
            toOpposite: Number(ethers.formatEther(args.congestionToOpposite ?? args[8])),
            toTreasury: Number(ethers.formatEther(args.congestionToTreasury ?? args[9]))
          };
        });

      setRecentSettlements(settlementRows);
      setRecentCongestionFees(congestionRows);
    } catch {
      // event read is best-effort for dashboard visibility
    }
  };

  // Calculate unrealized PnL for a position
  const calculatePnL = (position: Position | null): number => {
    if (!position) return 0;
    if (typeof position.onchainPnl === 'number') return position.onchainPnl;
    if (position.side === 'long') {
      return (price - position.entryPrice) * ((position.amount * position.leverage) / position.entryPrice);
    } else {
      return (position.entryPrice - price) * ((position.amount * position.leverage) / position.entryPrice);
    }
  };

  // Calculate ROE for a position
  const calculateROE = (position: Position | null): number => {
    if (!position || position.amount === 0) return 0;
    if (typeof position.onchainEquity === 'number') {
      const pnl = (position.onchainEquity ?? position.amount) - position.amount;
      return (pnl / position.amount) * 100;
    }
    const pnl = calculatePnL(position);
    return (pnl / position.amount) * 100;
  };

  // Total unrealized PnL
  const totalUnrealizedPnL = useMemo(() => {
    return calculatePnL(userPositions.long) + calculatePnL(userPositions.short);
  }, [userPositions, price]);

  // Total margin locked
  const totalMargin = useMemo(() => {
    return (userPositions.long?.amount || 0) + (userPositions.short?.amount || 0);
  }, [userPositions]);

  const mapOnchainPosition = (
    raw: {
      margin: bigint;
      leverage: bigint;
      entryPriceE8: bigint;
      isOpen: boolean;
      pnl: bigint;
      equity: bigint;
      maintenanceMargin: bigint;
    },
    side: 'long' | 'short'
  ): Position | null => {
    if (!raw.isOpen) return null;
    return {
      side,
      amount: Number(ethers.formatEther(raw.margin)),
      entryPrice: fromPriceE8(raw.entryPriceE8),
      leverage: Number(raw.leverage),
      onchainPnl: Number(ethers.formatEther(raw.pnl)),
      onchainEquity: Number(ethers.formatEther(raw.equity)),
      maintenanceMargin: Number(ethers.formatEther(raw.maintenanceMargin))
    };
  };

  const getWriteContract = async () => {
    const provider = walletProvider ?? getEthereumProvider();
    if (!provider) throw new Error('Wallet provider not found');
    if (!arenaAddress) throw new Error('Missing VITE_PERPLY_ARENA_ADDRESS');
    await ensureMonadTestnet(provider);
    const browserProvider = new ethers.BrowserProvider(provider);
    const signer = await browserProvider.getSigner();
    return new ethers.Contract(arenaAddress, PERPLY_ARENA_ABI, signer);
  };

  const refreshOnchainState = async (addressOverride?: string) => {
    if (!arenaAddress) {
      setUserBalance(DEFAULT_BALANCE);
      setUserPositions({ long: null, short: null });
      setLongCongestionRateBps(0);
      setShortCongestionRateBps(0);
      setLongCongestionRewards(0);
      setShortCongestionRewards(0);
      setAllianceLiquidity(0);
      setSyndicateLiquidity(0);
      setDominance(0);
      setContractOwner(null);
      setContractKeeper(null);
      setLastSettlementAt(null);
      setRecentSettlements([]);
      setRecentCongestionFees([]);
      return;
    }
    const trader = addressOverride ?? walletAddress ?? ethers.ZeroAddress;

    try {
      const readProvider = new ethers.JsonRpcProvider(MONAD_TESTNET.rpcUrls[0]);
      const readContract = new ethers.Contract(arenaAddress, PERPLY_ARENA_ABI, readProvider);
      const emptyPosition = {
        margin: 0n,
        weight: 0n,
        leverage: 0n,
        entryPriceE8: 0n,
        isOpen: false,
        pnl: 0n,
        equity: 0n,
        maintenanceMargin: 0n
      };
      const [
        availableResult,
        longPosResult,
        shortPosResult,
        congestionRatesResult,
        longRewardsResult,
        shortRewardsResult,
        longWeightResult,
        shortWeightResult
      ] = await Promise.allSettled([
        readContract.availableBalance(trader) as Promise<bigint>,
        readContract.getPosition(trader, 0) as Promise<{
          margin: bigint;
          weight: bigint;
          leverage: bigint;
          entryPriceE8: bigint;
          isOpen: boolean;
          pnl: bigint;
          equity: bigint;
          maintenanceMargin: bigint;
        }>,
        readContract.getPosition(trader, 1) as Promise<{
          margin: bigint;
          weight: bigint;
          leverage: bigint;
          entryPriceE8: bigint;
          isOpen: boolean;
          pnl: bigint;
          equity: bigint;
          maintenanceMargin: bigint;
        }>,
        readContract.getCongestionRatesBps() as Promise<[bigint, bigint]>,
        readContract.cumulativeCongestionRewards(0) as Promise<bigint>,
        readContract.cumulativeCongestionRewards(1) as Promise<bigint>,
        readContract.sideWeight(0) as Promise<bigint>,
        readContract.sideWeight(1) as Promise<bigint>
      ]);

      const [
        ownerResult,
        keeperResult,
        lastSettleResult,
        minIntervalResult,
        volTriggerBpsResult,
        markPriceResult
      ] = await Promise.allSettled([
        readContract.owner() as Promise<string>,
        readContract.keeper() as Promise<string>,
        readContract.lastSettlementAt() as Promise<bigint>,
        readContract.minSettlementInterval() as Promise<bigint>,
        readContract.volatilityTriggerBps() as Promise<bigint>,
        readContract.markPriceE8() as Promise<bigint>
      ]);

      const requiredResults = [
        availableResult,
        longPosResult,
        shortPosResult,
        congestionRatesResult,
        longRewardsResult,
        shortRewardsResult,
        longWeightResult,
        shortWeightResult
      ];
      const allRequiredReadsFailed = requiredResults.every(result => result.status === 'rejected');
      if (allRequiredReadsFailed) {
        setWalletError('Cannot read arena contract. Verify contract address and Monad testnet network.');
        setUserBalance(DEFAULT_BALANCE);
        setUserPositions({ long: null, short: null });
        setAllianceLiquidity(0);
        setSyndicateLiquidity(0);
        setDominance(0);
        setRecentSettlements([]);
        setRecentCongestionFees([]);
        return;
      }

      const available = availableResult.status === 'fulfilled' ? availableResult.value : 0n;
      const longPos = longPosResult.status === 'fulfilled' ? longPosResult.value : emptyPosition;
      const shortPos = shortPosResult.status === 'fulfilled' ? shortPosResult.value : emptyPosition;
      const congestionRates = congestionRatesResult.status === 'fulfilled' ? congestionRatesResult.value : [0n, 0n];
      const longRewards = longRewardsResult.status === 'fulfilled' ? longRewardsResult.value : 0n;
      const shortRewards = shortRewardsResult.status === 'fulfilled' ? shortRewardsResult.value : 0n;
      const longWeight = longWeightResult.status === 'fulfilled' ? longWeightResult.value : 0n;
      const shortWeight = shortWeightResult.status === 'fulfilled' ? shortWeightResult.value : 0n;

      setUserBalance(Number(ethers.formatEther(available)));
      setUserPositions({
        long: mapOnchainPosition(longPos, 'long'),
        short: mapOnchainPosition(shortPos, 'short')
      });
      setContractOwner(ownerResult.status === 'fulfilled' ? ownerResult.value : null);
      setContractKeeper(keeperResult.status === 'fulfilled' ? keeperResult.value : null);
      setLastSettlementAt(lastSettleResult.status === 'fulfilled' ? Number(lastSettleResult.value) : null);
      setMinSettlementIntervalSec(minIntervalResult.status === 'fulfilled' ? Number(minIntervalResult.value) : 10);
      setVolatilityTriggerPct(volTriggerBpsResult.status === 'fulfilled' ? Number(volTriggerBpsResult.value) / 100 : 0.15);
      if (markPriceResult.status === 'fulfilled') {
        setOnchainMarkPrice(fromPriceE8(markPriceResult.value));
      } else {
        setOnchainMarkPrice(null);
      }
      setLongCongestionRateBps(Number(congestionRates[0]));
      setShortCongestionRateBps(Number(congestionRates[1]));
      setLongCongestionRewards(Number(ethers.formatEther(longRewards)));
      setShortCongestionRewards(Number(ethers.formatEther(shortRewards)));
      const longLiquidity = Number(ethers.formatEther(longWeight));
      const shortLiquidity = Number(ethers.formatEther(shortWeight));
      setAllianceLiquidity(longLiquidity);
      setSyndicateLiquidity(shortLiquidity);
      const totalLiquidity = longLiquidity + shortLiquidity;
      setDominance(totalLiquidity > 0 ? (longLiquidity - shortLiquidity) / totalLiquidity : 0);
      await refreshArenaHistory(readProvider, readContract);
      setWalletError(null);
    } catch (error) {
      setWalletError(toReadableError(error, 'Failed to load on-chain state'));
    }
  };

  const connectWallet = async (providerOverride?: WalletProvider, walletNameOverride?: string) => {
    const provider = providerOverride ?? walletProvider ?? getEthereumProvider();
    if (!provider) {
      setWalletError('No EVM wallet detected. Install MetaMask / OKX / Rabby / Backpack / Phantom');
      return;
    }
    if (!isContractConfigured) {
      setWalletError('Set VITE_PERPLY_ARENA_ADDRESS first');
      return;
    }

    try {
      await ensureMonadTestnet(provider);
      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
      if (!accounts?.length) {
        setWalletError('No wallet account authorized');
        return;
      }

      setWalletProvider(provider);
      setConnectedWalletName(walletNameOverride ?? inferWalletName(provider));
      setWalletAddress(accounts[0]);
      setWalletError(null);
      setIsWalletPickerOpen(false);
      setShowWalletMenu(false);
      await refreshOnchainState(accounts[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wallet connection failed';
      setWalletError(message);
    }
  };

  const handleDeposit = async () => {
    if (!isWalletConnected) {
      setWalletError('Connect wallet first');
      return;
    }
    const input = window.prompt(`Deposit MON amount (min ${MIN_DEPOSIT_MON})`, `${MIN_DEPOSIT_MON}`);
    const amount = parseAmountInput(input);
    if (!amount) return;
    if (amount < MIN_DEPOSIT_MON) {
      setWalletError(`Minimum deposit is ${MIN_DEPOSIT_MON} MON`);
      return;
    }

    try {
      setIsTxPending(true);
      const provider = walletProvider ?? getEthereumProvider();
      if (!provider) throw new Error('Wallet provider not found');
      const browserProvider = new ethers.BrowserProvider(provider);
      const signer = await browserProvider.getSigner();
      const walletNativeBalance = await browserProvider.getBalance(await signer.getAddress());
      const value = ethers.parseEther(amount.toString());
      if (walletNativeBalance < value) {
        setWalletError('Wallet MON balance is lower than deposit amount');
        return;
      }
      const contract = await getWriteContract();
      const tx = await contract.deposit({ value });
      await tx.wait();
      await refreshOnchainState();
      window.setTimeout(() => { void refreshOnchainState(); }, 1200);
      setShowWalletMenu(false);
      setWalletError(null);
    } catch (error) {
      setWalletError(toReadableError(error, 'Deposit failed'));
    } finally {
      setIsTxPending(false);
    }
  };

  const handleWithdraw = async () => {
    if (!isWalletConnected) {
      setWalletError('Connect wallet first');
      return;
    }
    const input = window.prompt('Withdraw MON amount', '1');
    const amount = parseAmountInput(input);
    if (!amount) return;
    if (amount > userBalance) {
      setWalletError(`Insufficient contract available balance: ${formatFixedAmount(userBalance, 2)} MON`);
      return;
    }

    try {
      setIsTxPending(true);
      const contract = await getWriteContract();
      const tx = await contract.withdraw(ethers.parseEther(amount.toString()));
      await tx.wait();
      await refreshOnchainState();
      window.setTimeout(() => { void refreshOnchainState(); }, 1200);
      setShowWalletMenu(false);
      setWalletError(null);
    } catch (error) {
      setWalletError(toReadableError(error, 'Withdraw failed'));
    } finally {
      setIsTxPending(false);
    }
  };

  const handleSyncOnchainPrice = async () => {
    if (!isWalletConnected) return;
    if (!isKeeperAuthorized) {
      setWalletError('Connected wallet is not owner/keeper');
      return;
    }
    try {
      setIsTxPending(true);
      const contract = await getWriteContract();
      const tx = await contract.settleWithPrice(toPriceE8(price));
      await tx.wait();
      await refreshOnchainState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Settlement tick failed';
      setWalletError(message);
    } finally {
      setIsTxPending(false);
    }
  };

  const loadWalletOptions = async (): Promise<DiscoveredWallet[]> => {
    const wallets = await discoverWallets();
    setWalletOptions(wallets);
    return wallets;
  };

  const openWalletPicker = async () => {
    const wallets = await loadWalletOptions();
    if (wallets.length === 0) {
      setWalletError('No EVM wallet detected. Install MetaMask / OKX / Rabby / Backpack / Phantom');
      return;
    }
    setWalletError(null);
    setIsWalletPickerOpen(true);
  };

  // Detect wallet session on load
  useEffect(() => {
    let active = true;
    const detect = async () => {
      const wallets = await discoverWallets();
      if (!active) return;
      setWalletOptions(wallets);
      for (const wallet of wallets) {
        try {
          const result = await wallet.provider.request({ method: 'eth_accounts' });
          const accounts = Array.isArray(result) ? result as string[] : [];
          if (accounts.length > 0) {
            setWalletProvider(wallet.provider);
            setConnectedWalletName(wallet.name);
            setWalletAddress(accounts[0]);
            setWalletError(null);
            void refreshOnchainState(accounts[0]);
            break;
          }
        } catch {
          // ignore passive wallet detection errors
        }
      }
    };
    void detect();
    return () => {
      active = false;
    };
  }, []);

  // Track wallet account and network switching from provider events.
  useEffect(() => {
    const provider = walletProvider;
    if (!provider?.on) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0] as string[] : [];
      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        setWalletError(null);
        void refreshOnchainState(accounts[0]);
      } else {
        setWalletAddress(null);
        setShowWalletMenu(false);
        setUserBalance(DEFAULT_BALANCE);
        setUserPositions({ long: null, short: null });
      }
    };

    const onChainChanged = () => {
      if (walletAddress) {
        void refreshOnchainState(walletAddress);
      }
    };

    provider.on('accountsChanged', onAccountsChanged);
    provider.on('chainChanged', onChainChanged);
    return () => {
      provider.removeListener?.('accountsChanged', onAccountsChanged);
      provider.removeListener?.('chainChanged', onChainChanged);
    };
  }, [walletProvider, walletAddress]);

  // Live market data loop (Binance / Pyth / Chainlink / CoinGecko aggregate)
  useEffect(() => {
    let active = true;
    const updateMarket = async () => {
      const aggregate = await fetchBtcPrice();
      if (!active) return;
      if (!aggregate) {
        setPriceFeedStatus('degraded');
        return;
      }

      setPriceFeedStatus(aggregate.sourceCount >= 2 ? 'live' : 'degraded');
      setPrice(prevPrice => {
        const nextPrice = aggregate.price;
        const delta = nextPrice - prevPrice;
        setPriceHistory(prev => {
          const newHistory = [...prev, nextPrice];
          if (newHistory.length > PRICE_HISTORY_POINTS) newHistory.shift();
          return newHistory;
        });

        if (delta !== 0) {
          const nextTrend = delta > 0 ? 'bull' : 'bear';
          setTrend(prev => {
            if (prev !== nextTrend) {
              setIsGlitching(true);
              setTimeout(() => setIsGlitching(false), 300);
            }
            return nextTrend;
          });
        } else {
          setTrend('neutral');
        }

        return nextPrice;
      });
    };

    void updateMarket();
    const interval = window.setInterval(() => {
      void updateMarket();
    }, MARKET_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!arenaAddress) return;
    void refreshOnchainState(walletAddress ?? undefined);
    const interval = window.setInterval(() => {
      void refreshOnchainState(walletAddress ?? undefined);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [walletAddress, arenaAddress]);

  useEffect(() => {
    if (!isAutoKeeperEnabled) return;
    if (!isWalletConnected || !isKeeperAuthorized || !isContractConfigured) return;

    const interval = window.setInterval(() => {
      if (isTxPending) return;
      if (!onchainMarkPrice || !Number.isFinite(onchainMarkPrice) || onchainMarkPrice <= 0) return;

      const nowSec = Math.floor(Date.now() / 1000);
      const elapsed = lastSettlementAt ? nowSec - lastSettlementAt : Number.MAX_SAFE_INTEGER;
      const deltaPct = Math.abs(price - onchainMarkPrice) / onchainMarkPrice * 100;
      const meetsTime = elapsed >= minSettlementIntervalSec;
      const meetsVol = deltaPct >= volatilityTriggerPct;

      if (meetsTime || meetsVol) {
        void handleSyncOnchainPrice();
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [
    isAutoKeeperEnabled,
    isWalletConnected,
    isKeeperAuthorized,
    isContractConfigured,
    isTxPending,
    onchainMarkPrice,
    price,
    lastSettlementAt,
    minSettlementIntervalSec,
    volatilityTriggerPct
  ]);

  useEffect(() => {
    const settlementRecords = recentSettlements
      .filter(item => item.winner !== 'NONE' && item.winnerNet > 0)
      .map(item => ({
        sort: parseEventOrder(item.id),
        record: {
          id: `settle-${item.id}`,
          faction: item.winner === 'LONG' ? 'left' as const : 'right' as const,
          amount: formatAmount(item.winnerNet, 4),
          time: item.time,
          kind: 'settlement' as const,
          label: 'SETTLE'
        }
      }));

    const congestionRecords = recentCongestionFees
      .filter(item => item.toOpposite > 0)
      .map(item => ({
        sort: parseEventOrder(item.id),
        record: {
          id: `congestion-${item.id}`,
          faction: item.side === 'LONG' ? 'right' as const : 'left' as const,
          amount: formatAmount(item.toOpposite, 4),
          time: item.time,
          kind: 'congestion' as const,
          label: 'CONGEST'
        }
      }));

    const merged = [...settlementRecords, ...congestionRecords]
      .sort((a, b) => b.sort - a.sort)
      .slice(0, 24)
      .map(item => item.record);

    setBattleHistory(merged);
    if (merged.length > 0) {
      setLatestPnL({ faction: merged[0].faction, amount: merged[0].amount });
    } else {
      setLatestPnL(null);
    }
  }, [recentSettlements, recentCongestionFees]);

  const getOpenPreview = async (side: 'long' | 'short', margin: number, leverage: number): Promise<OpenPreview | null> => {
    if (!arenaAddress || margin <= 0 || leverage <= 0) return null;
    try {
      const provider = new ethers.JsonRpcProvider(MONAD_TESTNET.rpcUrls[0]);
      const contract = new ethers.Contract(arenaAddress, PERPLY_ARENA_ABI, provider);
      const sideId = side === 'long' ? 0 : 1;
      const result = await contract.previewOpen(sideId, ethers.parseEther(margin.toString()), leverage) as [
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint
      ];
      return {
        openFee: Number(ethers.formatEther(result[0])),
        congestionRateBps: Number(result[1]),
        congestionFee: Number(ethers.formatEther(result[2])),
        congestionToOpposite: Number(ethers.formatEther(result[3])),
        congestionToTreasury: Number(ethers.formatEther(result[4])),
        totalRequired: Number(ethers.formatEther(result[5]))
      };
    } catch {
      return null;
    }
  };

  const handlePreviewRequest = async (margin: number, leverage: number): Promise<OpenPreview | null> => {
    if (!isContractConfigured) {
      return null;
    }
    const preview = await getOpenPreview(tradingSide, margin, leverage);
    return preview;
  };

  const handleWalletClick = () => {
    if (!isWalletConnected) {
      void openWalletPicker();
      return;
    }
    setShowWalletMenu(prev => !prev);
  };

  const handleDisconnect = () => {
    setWalletAddress(null);
    setWalletProvider(null);
    setConnectedWalletName(null);
    setWalletError(null);
    setIsWalletPickerOpen(false);
    setShowWalletMenu(false);
    setIsAutoKeeperEnabled(false);
    setUserBalance(DEFAULT_BALANCE);
    setUserPositions({ long: null, short: null });
  };

  const handleBet = async (side: 'long' | 'short') => {
    if (!isWalletConnected) {
      void openWalletPicker();
      return;
    }
    if (!isContractConfigured) {
      setWalletError('Set VITE_PERPLY_ARENA_ADDRESS first');
      return;
    }

    const existingPosition = side === 'long' ? userPositions.long : userPositions.short;

    if (existingPosition) {
      try {
        setIsTxPending(true);
        const contract = await getWriteContract();
        const sideId = side === 'long' ? 0 : 1;
        const tx = await contract.closePosition(sideId);
        await tx.wait();
        await refreshOnchainState();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Close position failed';
        setWalletError(message);
      } finally {
        setIsTxPending(false);
      }
      return;
    }

    setTradingSide(side);
    setIsTradingModalOpen(true);
  };

  const confirmTrading = async (margin: number, leverage: number) => {
    if (!isWalletConnected || !isContractConfigured) return;

    const preview = await getOpenPreview(tradingSide, margin, leverage);
    if (!preview || margin <= 0 || preview.totalRequired > userBalance) {
      return;
    }

    try {
      setIsTxPending(true);
      const contract = await getWriteContract();
      const sideId = tradingSide === 'long' ? 0 : 1;
      const marginWei = ethers.parseEther(margin.toString());
      const tx = await contract.openPosition(sideId, marginWei, leverage);
      await tx.wait();
      setIsTradingModalOpen(false);
      await refreshOnchainState();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Open position failed';
      setWalletError(message);
    } finally {
      setIsTxPending(false);
    }
  };

  // Render position info card
  const renderPositionInfo = (position: Position | null, side: 'long' | 'short') => {
    if (!position) return null;

    const pnl = calculatePnL(position);
    const roe = calculateROE(position);
    const equity = typeof position.onchainEquity === 'number' ? position.onchainEquity : position.amount + pnl;
    const isLong = side === 'long';

    return (
      <div className="pt-4 border-t border-white/10 space-y-3">
        <div className="flex justify-between items-center">
          <div className="text-[8px] text-zinc-500 uppercase font-black tracking-widest">Active Position</div>
          <div className={`px-1.5 py-0.5 rounded text-[7px] font-bold uppercase ${isLong ? 'bg-neon-green/20 text-neon-green' : 'bg-crimson-red/20 text-crimson-red'}`}>
            {side}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-y-3 gap-x-4">
          <div>
            <div className="text-[7px] text-zinc-500 uppercase font-bold">Margin</div>
            <div className="text-xs font-mono font-black text-white">{formatCurrency(position.amount)} <span className="text-[8px] opacity-50">$MON</span></div>
          </div>
          <div>
            <div className="text-[7px] text-zinc-500 uppercase font-bold">Leverage</div>
            <div className="text-xs font-mono font-black text-neon-yellow">{position.leverage}x</div>
          </div>
          <div>
            <div className="text-[7px] text-zinc-500 uppercase font-bold">Unrealized PnL</div>
            <div className={`text-xs font-mono font-black ${pnl >= 0 ? 'text-neon-green' : 'text-crimson-red'}`}>
              {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)} <span className="text-[8px] opacity-50">$MON</span>
            </div>
          </div>
          <div>
            <div className="text-[7px] text-zinc-500 uppercase font-bold">ROE</div>
            <div className={`text-xs font-mono font-black ${roe >= 0 ? 'text-neon-green' : 'text-crimson-red'}`}>
              {roe >= 0 ? '+' : ''}{roe.toFixed(2)}%
            </div>
          </div>
          <div>
            <div className="text-[7px] text-zinc-500 uppercase font-bold">Equity</div>
            <div className="text-xs font-mono font-black text-white">
              {formatCurrency(equity)} <span className="text-[8px] opacity-50">$MON</span>
            </div>
          </div>
          <div>
            <div className="text-[7px] text-zinc-500 uppercase font-bold">MMR</div>
            <div className="text-xs font-mono font-black text-neon-yellow">
              {formatCurrency(position.maintenanceMargin ?? 0)} <span className="text-[8px] opacity-50">$MON</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Background Layer */}
      <div className="fixed inset-0 grid-bg z-0 opacity-20"></div>
      <div className="scanline-effect opacity-30"></div>

      {/* Main Layout */}
      <div className="relative z-10 h-full flex flex-col h-screen overflow-hidden">

        {/* Header */}
        <header className="fixed top-0 left-0 w-full z-50 pointer-events-none">
          <div className="h-12 w-full bg-black/90 border-b border-white/10 flex items-center justify-between px-8 pointer-events-auto relative">
            <div className="absolute inset-0 data-stream-bg opacity-10"></div>

            {/* Left: Logo */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3 group cursor-pointer">
                <div className="relative w-8 h-8 flex items-center justify-center">
                  {/* Dashed rotating ring */}
                  <div className="absolute inset-0 border-2 border-dashed border-neon-green/50 rounded-full animate-spin-slow"></div>
                  {/* Inner solid ring rotating reverse */}
                  <div className="absolute inset-1 border border-neon-green/30 rounded-full animate-spin-slow" style={{ animationDirection: 'reverse', animationDuration: '15s' }}></div>
                  {/* Pulsing lightning bolt */}
                  <Zap size={16} className="text-neon-green animate-pulse relative z-10" style={{ filter: 'drop-shadow(0 0 4px #39FF14)' }} />
                </div>
                
                {/* Italic Styled Text */}
                <h1 className="text-xl font-black italic tracking-normal" style={{ fontFamily: "'Orbitron', sans-serif", fontStyle: 'italic' }}>
                  <span className="text-white">perply</span>
                  <span className="text-crimson-red">.</span>
                  <span className="text-neon-green">fun</span>
                </h1>
              </div>
            </div>

            {/* Right: Wallet & User Stats */}
            <div className="flex items-center space-x-6 relative">
              {/* Wallet Connected: Show User Stats - Near Wallet */}
              {isWalletConnected && (
                <div className="hidden lg:flex items-center space-x-6 border-r border-white/10 pr-6 bg-black/70 px-4 py-2 rounded backdrop-blur-sm">
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-mono">Balance</span>
                    <span className="text-[14px] font-bold text-white font-mono">{formatFixedAmount(userBalance, 2)} <span className="font-mono text-[11px]">$MON</span></span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-mono">Margin</span>
                    <span className="text-[14px] font-bold text-neon-blue font-mono">{formatCurrency(totalMargin)} <span className="font-mono text-[11px]">$MON</span></span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-mono">PnL</span>
                    <span className={`text-[14px] font-bold font-mono ${totalUnrealizedPnL >= 0 ? 'text-neon-green' : 'text-crimson-red'}`}>
                      {totalUnrealizedPnL >= 0 ? '+' : ''}{formatCurrency(totalUnrealizedPnL)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-mono">ROE</span>
                    <span className={`text-[14px] font-bold font-mono ${totalUnrealizedPnL >= 0 ? 'text-neon-green' : 'text-crimson-red'}`}>
                      {totalMargin > 0 ? ((totalUnrealizedPnL / totalMargin) * 100).toFixed(2) : '0.00'}%
                    </span>
                  </div>
                </div>
              )}
              <div className="relative">
                <button
                  onClick={handleWalletClick}
                  disabled={isTxPending}
                  className={`h-8 px-4 rounded-sm border text-[10px] font-mono uppercase tracking-[0.2em] transition-all relative group overflow-hidden flex items-center space-x-2 ${
                    isWalletConnected
                    ? 'border-neon-blue/50 text-neon-blue bg-neon-blue/5'
                    : 'border-white/20 text-white hover:border-neon-blue hover:bg-neon-blue/5'
                  } ${isTxPending ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  <div className="absolute inset-0 bg-neon-blue/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                  <span className="relative z-10">
                    {isTxPending ? 'Pending Tx...' : (isWalletConnected ? walletLabel : 'Connect Wallet')}
                  </span>
                  {isWalletConnected && (
                    <div className="relative z-10">
                      {showWalletMenu ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </div>
                  )}
                </button>
                {walletError && (
                  <div className="absolute right-0 mt-2 text-[8px] text-crimson-red font-mono whitespace-nowrap">{walletError}</div>
                )}
                {!isContractConfigured && (
                  <div className="absolute right-0 mt-2 text-[8px] text-neon-yellow font-mono whitespace-nowrap">
                    Missing VITE_PERPLY_ARENA_ADDRESS
                  </div>
                )}
                {!isWalletConnected && isWalletPickerOpen && (
                  <div className="absolute right-0 top-full mt-3 w-72 bg-black/95 border border-white/10 rounded-sm shadow-[0_20px_50px_rgba(0,0,0,0.8)] z-50 overflow-hidden backdrop-blur-2xl pointer-events-auto">
                    <div className="px-4 py-3 border-b border-white/5 bg-white/5">
                      <div className="text-[9px] text-zinc-400 uppercase tracking-[0.2em] font-bold">Select Wallet</div>
                    </div>
                    <div className="p-2 space-y-1">
                      {walletOptions.map(wallet => (
                        <button
                          key={wallet.id}
                          onClick={() => void connectWallet(wallet.provider, wallet.name)}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-sm hover:bg-white/10 border border-transparent hover:border-white/10 transition-all"
                        >
                          <span className="text-[10px] text-white font-bold uppercase tracking-wider">{wallet.name}</span>
                          <span className="text-[8px] text-zinc-500 font-mono">
                            {wallet.rdns ? wallet.rdns.split('.').slice(-2).join('.') : 'Injected'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Wallet Dropdown */}
                {isWalletConnected && showWalletMenu && (
                  <div className="absolute right-0 top-full mt-3 w-72 bg-black/95 border border-white/10 rounded-sm shadow-[0_20px_50px_rgba(0,0,0,0.8)] z-50 overflow-hidden backdrop-blur-2xl cyber-border-glow pointer-events-auto">
                    <div className="px-5 py-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-neon-blue/20 flex items-center justify-center border border-neon-blue/40">
                          <Wallet size={14} className="text-neon-blue" />
                        </div>
                        <div>
                          <div className="text-[10px] text-white font-bold tracking-wider">{walletLabel}</div>
                          <div className="text-[8px] text-zinc-500 uppercase tracking-wider">{connectedWalletLabel}</div>
                          <div className="text-[8px] text-neon-green uppercase font-bold tracking-widest flex items-center">
                            <span className="w-1 h-1 bg-neon-green rounded-full mr-1 animate-pulse"></span>
                            Connected
                          </div>
                          <div className="text-[7px] text-zinc-500 mt-1 font-mono">
                            Owner: {contractOwner ? shortenAddress(contractOwner) : 'N/A'} | Keeper: {contractKeeper ? shortenAddress(contractKeeper) : 'N/A'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-white/5 rounded-sm border border-white/5">
                          <div className="text-[8px] text-zinc-500 uppercase font-bold mb-1">Available</div>
                          <div className="text-xs font-mono font-bold text-white">{formatFixedAmount(userBalance, 2)} <span className="text-[8px] text-zinc-500">$MON</span></div>
                        </div>
                        <div className="p-3 bg-white/5 rounded-sm border border-white/5">
                          <div className="text-[8px] text-zinc-500 uppercase font-bold mb-1">Margin Locked</div>
                          <div className="text-xs font-mono font-bold text-neon-blue">{formatCurrency(totalMargin)} <span className="text-[8px] text-zinc-500">$MON</span></div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-[9px] uppercase font-bold">
                          <span className="text-zinc-500">Unrealized PnL</span>
                          <span className={totalUnrealizedPnL >= 0 ? 'text-neon-green' : 'text-crimson-red'}>
                            {totalUnrealizedPnL >= 0 ? '+' : ''}{formatCurrency(totalUnrealizedPnL)} $MON
                          </span>
                        </div>
                        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-1000 ${totalUnrealizedPnL >= 0 ? 'bg-neon-green shadow-[0_0_10px_#39FF14]' : 'bg-crimson-red shadow-[0_0_10px_#FF003C]'}`}
                            style={{ width: `${Math.min(100, Math.max(0, 50 + (totalUnrealizedPnL / 1000) * 50))}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    <div className="px-5 py-3 bg-white/5 border-t border-white/5 flex flex-col space-y-2">
                      <button
                        onClick={handleDeposit}
                        disabled={isTxPending}
                        className="w-full py-2 bg-neon-blue/10 hover:bg-neon-blue/20 border border-neon-blue/30 rounded-sm text-[9px] text-neon-blue font-black uppercase tracking-widest transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Deposit Assets
                      </button>
                      <button
                        onClick={handleWithdraw}
                        disabled={isTxPending}
                        className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-sm text-[9px] text-white font-black uppercase tracking-widest transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Withdraw Assets
                      </button>
                      {isKeeperAuthorized && (
                        <>
                          <button
                            onClick={handleSyncOnchainPrice}
                            disabled={isTxPending}
                            className="w-full py-2 bg-neon-green/10 hover:bg-neon-green/20 border border-neon-green/30 rounded-sm text-[9px] text-neon-green font-black uppercase tracking-widest transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            Run Settlement Tick
                          </button>
                          <button
                            onClick={() => setIsAutoKeeperEnabled(prev => !prev)}
                            disabled={isTxPending}
                            className="w-full py-2 bg-neon-yellow/10 hover:bg-neon-yellow/20 border border-neon-yellow/30 rounded-sm text-[9px] text-neon-yellow font-black uppercase tracking-widest transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {isAutoKeeperEnabled ? 'Auto Keeper: ON' : 'Auto Keeper: OFF'}
                          </button>
                        </>
                      )}
                      <button
                        onClick={handleDisconnect}
                        className="w-full py-2 hover:bg-crimson-red/10 rounded-sm text-[9px] text-zinc-500 hover:text-crimson-red font-black uppercase tracking-widest transition-all text-center"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </header>

        {/* Main Arena */}
        <main className="absolute inset-0 z-10 flex flex-col overflow-hidden">
          <div className="absolute inset-0 pointer-events-none z-15 bg-[radial-gradient(circle_at_center,transparent_50%,#050505_100%)]"></div>
          <div className="absolute inset-0 war-zone-gradient pointer-events-none opacity-30"></div>

          <div className="relative flex-1">
            {/* LEFT SIDE - LONG POOL & LONG POSITION */}
            <div className="absolute left-8 top-12 z-20 cyber-panel-v2 p-6 min-w-[240px] md:min-w-[320px] shadow-[0_0_50px_rgba(0,0,0,0.5)]">
              <div className="cyber-rail-l cyber-rail-green"></div>
              <div className="cyber-rail-r cyber-rail-green opacity-30"></div>

              <div className="flex flex-col space-y-6 relative z-10">
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-mono text-neon-green uppercase tracking-[0.4em] mb-2">LONG POOL</span>
                    <span className="text-2xl md:text-4xl font-black text-neon-green" style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em' }}>
                      {formatCurrency(allianceLiquidity)}
                      <span className="text-[10px] md:text-xs ml-2 opacity-50" style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.05em' }}>$MON</span>
                    </span>
                    <span className="text-[8px] mt-1 text-neon-green/80 font-mono">
                      Congestion Bonus Earned: +{formatCurrency(longCongestionRewards)} MON
                    </span>
                    <span className="text-[8px] text-zinc-500 font-mono">
                      Long-side surcharge now: {(longCongestionRateBps / 100).toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* User Long Position */}
                {renderPositionInfo(userPositions.long, 'long')}
              </div>
            </div>

            {/* RIGHT SIDE - SHORT POOL & SHORT POSITION */}
            <div className="absolute right-8 top-12 z-20 cyber-panel-v2 p-6 min-w-[240px] md:min-w-[320px] shadow-[0_0_50px_rgba(0,0,0,0.5)] text-right">
              <div className="cyber-rail-r cyber-rail-red"></div>
              <div className="cyber-rail-l cyber-rail-red opacity-30"></div>

              <div className="flex flex-col space-y-6 relative z-10">
                <div className="flex justify-between items-start flex-row-reverse">
                  <div className="flex flex-col items-end">
                    <span className="text-[11px] font-mono text-crimson-red uppercase tracking-[0.4em] mb-2">SHORT POOL</span>
                    <span className="text-2xl md:text-4xl font-black text-crimson-red" style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em' }}>
                      {formatCurrency(syndicateLiquidity)}
                      <span className="text-[10px] md:text-xs ml-2 opacity-50" style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.05em' }}>$MON</span>
                    </span>
                    <span className="text-[8px] mt-1 text-crimson-red/80 font-mono">
                      Congestion Bonus Earned: +{formatCurrency(shortCongestionRewards)} MON
                    </span>
                    <span className="text-[8px] text-zinc-500 font-mono">
                      Short-side surcharge now: {(shortCongestionRateBps / 100).toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* User Short Position */}
                {renderPositionInfo(userPositions.short, 'short')}
              </div>
            </div>

            {/* Epicenter Ticker */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center w-full max-w-[280px] md:max-w-none px-4">
              <div className={`absolute inset-0 w-48 h-48 md:w-64 md:h-64 bg-white/5 rounded-full scale-150 animate-pulse opacity-20 -z-10 blur-xl ${trend === 'bull' ? 'bg-neon-green/20' : 'bg-crimson-red/20'}`}></div>

              <div className={`w-full md:w-auto bg-black/80 border-2 p-4 md:p-6 rounded-xl backdrop-blur-xl shadow-2xl flex flex-col items-center group cursor-pointer transition-all relative overflow-hidden ${trend === 'bull' ? 'border-neon-green/40 shadow-neon-green/20' : 'border-crimson-red/40 shadow-crimson-red/20'}`}>
                <div className="flex items-center space-x-2 mb-1 z-10">
                  <span className="text-[10px] md:text-xs font-bold text-zinc-500 uppercase tracking-widest">BTC</span>
                  <span className="text-[8px] text-zinc-600">/</span>
                  <span className="text-[10px] md:text-xs font-bold text-zinc-500 uppercase tracking-widest">USD</span>
                  <span className="text-[7px] px-1.5 py-0.5 rounded bg-neon-blue/20 text-neon-blue border border-neon-blue/30 ml-2">PERP</span>
                  <span className={`text-[7px] px-1.5 py-0.5 rounded border ml-1 ${
                    priceFeedStatus === 'live'
                      ? 'bg-neon-green/15 text-neon-green border-neon-green/40'
                      : 'bg-neon-yellow/15 text-neon-yellow border-neon-yellow/40'
                  }`}>
                    {priceFeedStatus === 'live' ? 'LIVE' : 'DEGRADED'}
                  </span>
                  <span className="text-[7px] px-1.5 py-0.5 rounded border ml-1 bg-white/5 text-zinc-300 border-white/15">
                    MONAD #{MONAD_TESTNET.chainId}
                  </span>
                </div>
                <div className={`text-3xl md:text-5xl font-black font-mono tracking-tight transition-colors z-10 ${trend === 'bull' ? 'text-neon-green' : 'text-crimson-red'} ${isGlitching ? 'animate-glitch' : ''}`}>
                  {price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="w-full h-8 md:h-12 mt-2 z-10">
                  <PriceChart data={priceHistory} color={trend === 'bull' ? '#39FF14' : '#FF003C'} />
                </div>
                <div className={`mt-2 md:mt-3 px-2 md:px-3 py-1 text-white text-[8px] md:text-[10px] font-bold rounded animate-pulse z-10 ${trend === 'bull' ? 'bg-neon-green/80' : 'bg-crimson-red/80'}`}>
                  {trend === 'bull' ? 'BULLISH MOMENTUM' : 'BEARISH PRESSURE'}
                </div>
                <div className="mt-2 text-[8px] text-zinc-400 font-mono tracking-wider z-10">
                  On-chain Mark: {onchainMarkPrice ? formatCurrency(onchainMarkPrice) : 'N/A'}
                </div>
                <div className="mt-1 text-[8px] text-zinc-500 font-mono tracking-wider z-10">
                  Tick: {minSettlementIntervalSec}s | Trigger: {volatilityTriggerPct.toFixed(2)}% | Keeper: {isKeeperAuthorized ? (isAutoKeeperEnabled ? 'AUTO' : 'MANUAL') : 'SYSTEM'}
                </div>
              </div>

              {/* Betting Controls */}
              <div className="mt-8 flex items-center space-x-4 z-40">
                <button
                  onClick={() => void handleBet('long')}
                  disabled={isTxPending}
                  className={`flex items-center space-x-3 px-8 py-4 rounded-xl font-black uppercase tracking-widest transition-all duration-300 border-2 ${
                    userPositions.long
                    ? 'bg-neon-green text-black border-neon-green shadow-[0_0_30px_rgba(57,255,20,0.5)] scale-105'
                    : 'bg-black/60 text-neon-green border-neon-green/40 hover:bg-neon-green/10 hover:shadow-[0_0_20px_rgba(57,255,20,0.2)]'
                  } ${isTxPending ? 'opacity-60 cursor-not-allowed' : ''}`}
                  style={{ fontFamily: "'Orbitron', sans-serif" }}
                >
                  <TrendingUp size={20} />
                  <span>{isTxPending ? 'PENDING...' : (userPositions.long ? 'CLOSE LONG' : 'LONG')}</span>
                </button>

                <button
                  onClick={() => void handleBet('short')}
                  disabled={isTxPending}
                  className={`flex items-center space-x-3 px-8 py-4 rounded-xl font-black uppercase tracking-widest transition-all duration-300 border-2 ${
                    userPositions.short
                    ? 'bg-crimson-red text-white border-crimson-red shadow-[0_0_30px_rgba(255,0,60,0.5)] scale-105'
                    : 'bg-black/60 text-crimson-red border-crimson-red/40 hover:bg-crimson-red/10 hover:shadow-[0_0_20px_rgba(255,0,60,0.2)]'
                  } ${isTxPending ? 'opacity-60 cursor-not-allowed' : ''}`}
                  style={{ fontFamily: "'Orbitron', sans-serif" }}
                >
                  <TrendingDown size={20} />
                  <span>{isTxPending ? 'PENDING...' : (userPositions.short ? 'CLOSE SHORT' : 'SHORT')}</span>
                </button>
              </div>
            </div>

            {/* Dynamic Battleground */}
            <BattleCanvas
              dominance={dominance}
              latestPnL={latestPnL}
              allianceLiquidity={allianceLiquidity}
              syndicateLiquidity={syndicateLiquidity}
              trend={trend}
            />

            {/* Battle Records */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30 w-full max-w-[320px] px-4">
              <div className="relative group">
                <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/80 to-transparent pointer-events-none z-10"></div>
                <div className="bg-transparent overflow-hidden h-16 transition-all duration-500 group-hover:h-40 group-hover:bg-black/60 group-hover:backdrop-blur-md group-hover:shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
                  <div className="px-2 py-1 flex justify-between items-center sticky top-0 z-20 opacity-30 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-center space-x-2">
                      <div className="w-1 h-1 rounded-full bg-neon-blue animate-pulse"></div>
                      <span className="text-[7px] uppercase text-zinc-500 font-bold tracking-[0.3em]" style={{ fontFamily: "'Syncopate', sans-serif" }}>Battle Log</span>
                    </div>
                    <span className="text-[7px] text-zinc-600 font-mono italic opacity-0 group-hover:opacity-100 transition-opacity">Scroll to view history</span>
                  </div>
                  <div className="overflow-y-auto h-full scrollbar-none group-hover:scrollbar-thin scrollbar-thumb-neon-blue/20 px-2 pb-6 space-y-0.5">
                    {battleHistory.length === 0 ? (
                      <div className="text-[8px] text-zinc-700 font-mono text-center py-4 tracking-widest uppercase">No Battle Events Yet</div>
                    ) : (
                      battleHistory.map((record) => (
                        <div key={record.id} className="flex justify-between items-center text-[8px] font-mono py-0.5 border-b border-white/5 last:border-0 group/item hover:bg-white/5 transition-colors">
                          <div className="flex items-center space-x-3">
                            <span className="text-zinc-600 text-[7px]">{record.time}</span>
                            <span className={`font-bold tracking-tighter ${record.faction === 'left' ? 'text-neon-green neon-text-glow-green' : 'text-crimson-red neon-text-glow-red'}`}>
                              {record.faction === 'left' ? 'ALLIANCE' : 'SYNDICATE'}
                            </span>
                            <span className="text-[6px] px-1 py-[1px] rounded border border-white/10 text-zinc-400 tracking-widest">
                              {record.label}
                            </span>
                          </div>
                          <span className="text-white/90 font-bold group-hover/item:text-white transition-colors">+{record.amount}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Keeper & Fee Dashboard */}
            <div className="absolute right-6 bottom-10 z-30 w-[320px] hidden xl:block">
              <div className="bg-black/70 border border-white/10 backdrop-blur-md rounded-lg p-3 space-y-3 shadow-[0_0_25px_rgba(0,0,0,0.5)]">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-[0.2em] text-zinc-400 font-bold">Settlement Feed</span>
                  <span className={`text-[8px] font-mono ${isKeeperAuthorized ? (isAutoKeeperEnabled ? 'text-neon-green' : 'text-zinc-500') : 'text-zinc-500'}`}>
                    {isKeeperAuthorized ? (isAutoKeeperEnabled ? 'AUTO' : 'MANUAL') : 'SYSTEM'}
                  </span>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto scrollbar-none">
                  {recentSettlements.length === 0 ? (
                    <div className="text-[8px] text-zinc-600 font-mono">No settlement events yet.</div>
                  ) : recentSettlements.map(item => (
                    <div key={item.id} className="border border-white/5 rounded p-1.5 text-[8px] font-mono bg-white/[0.02]">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">{item.time}</span>
                        <span className={item.direction === 'up' ? 'text-neon-green' : item.direction === 'down' ? 'text-crimson-red' : 'text-zinc-500'}>
                          {item.direction.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex justify-between mt-0.5">
                        <span className="text-zinc-400">Winner: {item.winner}</span>
                        <span className="text-white">Net {item.winnerNet.toFixed(3)}</span>
                      </div>
                      <div className="flex justify-between text-zinc-500 mt-0.5">
                        <span>Gross {item.grossTransfer.toFixed(3)}</span>
                        <span>Fee {item.settlementFee.toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="h-px bg-white/10"></div>

                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-[0.2em] text-zinc-400 font-bold">Congestion Fee Feed</span>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto scrollbar-none">
                  {recentCongestionFees.length === 0 ? (
                    <div className="text-[8px] text-zinc-600 font-mono">No congestion surcharge events yet.</div>
                  ) : recentCongestionFees.map(item => (
                    <div key={item.id} className="border border-white/5 rounded p-1.5 text-[8px] font-mono bg-white/[0.02]">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">{item.time}</span>
                        <span className={item.side === 'LONG' ? 'text-neon-green' : 'text-crimson-red'}>{item.side}</span>
                      </div>
                      <div className="flex justify-between mt-0.5">
                        <span className="text-zinc-400">{item.trader}</span>
                        <span className="text-zinc-300">{item.congestionRate.toFixed(2)}%</span>
                      </div>
                      <div className="flex justify-between mt-0.5">
                        <span className="text-neon-green">Opp +{item.toOpposite.toFixed(4)}</span>
                        <span className="text-zinc-400">Treasury {item.toTreasury.toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Trading Modal */}
      <TradingModal
        isOpen={isTradingModalOpen}
        onClose={() => setIsTradingModalOpen(false)}
        side={tradingSide}
        currentPrice={price}
        userBalance={userBalance}
        isTxPending={isTxPending}
        onConfirm={confirmTrading}
        onPreview={handlePreviewRequest}
      />
    </>
  );
}

function PriceChart({ data, color }: { data: number[], color: string }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((val - min) / range) * 100;
    return [x, y];
  });

  let d = `M ${points[0][0]},${points[0][1]}`;

  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    const [prevX, prevY] = points[i - 1];
    const cp1x = prevX + (x - prevX) / 2;
    const cp1y = prevY;
    const cp2x = prevX + (x - prevX) / 2;
    const cp2y = y;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${x},${y}`;
  }

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible" preserveAspectRatio="none">
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="drop-shadow(0 0 4px rgba(255,255,255,0.5))"
      />
    </svg>
  );
}
