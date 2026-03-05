import React, { useState, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, Info, Zap, ShieldAlert } from 'lucide-react';

interface TradingModalProps {
  isOpen: boolean;
  onClose: () => void;
  side: 'long' | 'short';
  currentPrice: number;
  userBalance: number;
  onConfirm: (margin: number, leverage: number) => void;
}

export default function TradingModal({ isOpen, onClose, side, currentPrice, userBalance, onConfirm }: TradingModalProps) {
  const [margin, setMargin] = useState<number>(1000);
  const [leverage, setLeverage] = useState<number>(10);
  
  if (!isOpen) return null;

  const positionSize = margin * leverage;
  const entryFee = positionSize * 0.001; // 0.1% fee

  const handleConfirm = () => {
    if (margin > userBalance) return;
    onConfirm(margin, leverage);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
      
      {/* Modal Container */}
      <div className="relative w-full max-w-md bg-zinc-950 border border-white/10 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,1)] overflow-hidden animate-in fade-in zoom-in duration-300">
        {/* Cyberpunk Header Decoration */}
        <div className={`h-1 w-full ${side === 'long' ? 'bg-neon-green shadow-[0_0_15px_#39FF14]' : 'bg-crimson-red shadow-[0_0_15px_#FF003C]'}`}></div>
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${side === 'long' ? 'bg-neon-green/10 text-neon-green' : 'bg-crimson-red/10 text-crimson-red'}`}>
              {side === 'long' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            </div>
            <div>
              <h2 className="text-lg font-black uppercase tracking-widest text-white" style={{ fontFamily: "'Audiowide', sans-serif" }}>
                {side === 'long' ? 'Bet Long' : 'Bet Short'}
              </h2>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">BTC / USD Trend Prediction</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-zinc-500 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Margin Input */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Bet Amount (Margin)</label>
              <span className="text-[10px] text-zinc-400 font-mono">Available: {userBalance.toLocaleString()} $MON</span>
            </div>
            <div className="relative group">
              <input 
                type="number" 
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:border-neon-blue/50 transition-all"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-zinc-500">$MON</div>
            </div>
            <div className="flex space-x-2">
              {[25, 50, 75, 100].map(pct => (
                <button 
                  key={pct}
                  onClick={() => setMargin(Math.floor(userBalance * (pct / 100)))}
                  className="flex-1 py-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-md text-[9px] font-bold text-zinc-400 hover:text-white transition-all"
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          {/* Leverage Slider */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Leverage</label>
              <span className="text-xs font-mono font-black text-neon-yellow">{leverage}x</span>
            </div>
            <input 
              type="range" 
              min="2" 
              max="20" 
              step="1"
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-neon-blue"
            />
            <div className="flex justify-between text-[8px] text-zinc-600 font-bold uppercase tracking-tighter">
              <span>2x</span>
              <span>5x</span>
              <span>10x</span>
              <span>15x</span>
              <span>20x</span>
            </div>
          </div>

          {/* Summary HUD */}
          <div className="bg-black/60 border border-white/5 rounded-xl p-4 space-y-3 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
            
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-zinc-500 font-bold uppercase tracking-wider flex items-center">
                <Zap size={10} className="mr-1.5 text-neon-yellow" />
                Position Size
              </span>
              <span className="text-white font-mono font-bold">{positionSize.toLocaleString()} $MON</span>
            </div>

            <div className="flex justify-between items-center text-[10px]">
              <span className="text-zinc-500 font-bold uppercase tracking-wider flex items-center">
                <Info size={10} className="mr-1.5 text-neon-blue" />
                Deployment Fee (0.1%)
              </span>
              <span className="text-zinc-400 font-mono font-bold">{entryFee.toFixed(2)} $MON</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-5 bg-white/5 border-t border-white/5">
          <button 
            onClick={handleConfirm}
            disabled={margin > userBalance || margin <= 0}
            className={`w-full py-4 rounded-xl font-black uppercase tracking-[0.2em] transition-all duration-300 border-2 ${
              margin > userBalance 
              ? 'bg-zinc-800 text-zinc-500 border-transparent cursor-not-allowed'
              : side === 'long'
                ? 'bg-neon-green text-black border-neon-green shadow-[0_0_30px_rgba(57,255,20,0.3)] hover:shadow-[0_0_50px_rgba(57,255,20,0.5)]'
                : 'bg-crimson-red text-white border-crimson-red shadow-[0_0_30px_rgba(255,0,60,0.3)] hover:shadow-[0_0_50px_rgba(255,0,60,0.5)]'
            }`}
            style={{ fontFamily: "'Bruno Ace SC', sans-serif" }}
          >
            {margin > userBalance ? 'Insufficient Balance' : `Confirm ${side === 'long' ? 'Long' : 'Short'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
