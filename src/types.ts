export interface BattleRecord {
  id: string;
  faction: 'left' | 'right';
  amount: string;
  time: string;
  kind: 'settlement' | 'congestion' | 'projection';
  label: string;
}

export interface Position {
  side: 'long' | 'short';
  amount: number;
  entryPrice: number;
  leverage: number;
  onchainPnl?: number;
  onchainEquity?: number;
  maintenanceMargin?: number;
  marginWei?: bigint;
  weightWei?: bigint;
  onchainPnlWei?: bigint;
  onchainEquityWei?: bigint;
  maintenanceMarginWei?: bigint;
}

export interface UserPositions {
  long: Position | null;
  short: Position | null;
}
