export interface BattleRecord {
  id: string;
  faction: 'left' | 'right';
  amount: string;
  time: string;
  kind: 'settlement' | 'congestion';
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
}

export interface UserPositions {
  long: Position | null;
  short: Position | null;
}
