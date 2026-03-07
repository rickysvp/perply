import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Rocket } from 'lucide-react';

interface OnboardingTourProps {
  isOpen: boolean;
  onClose: (remember: boolean) => void;
}

interface TourStep {
  label: string;
  title: string;
  subtitle: string;
  tags: string[];
}

const TOUR_STEPS: TourStep[] = [
  {
    label: 'Direction Edge',
    title: 'Call the Direction, Earn $MON',
    subtitle: 'Long or short the mark-price move. Winners get paid in seconds, not hours. Fast, fair, and on-chain.',
    tags: ['Second-Level Settlement', 'Instant Payouts', 'Long vs Short Arena']
  },
  {
    label: 'Low Friction',
    title: 'More Fun Than Traditional Perps',
    subtitle: 'No complex order books. Just pick a side, deploy, and watch the battle unfold. Fast, simple, and thrilling.',
    tags: ['Instant Entry', 'Battle Arena', 'Real-Time Thrills']
  },
  {
    label: 'Fast Start',
    title: 'Start Earning in Seconds',
    subtitle: 'Connect, deposit, trade. Your first profit could be just 10 seconds away. No waiting, no delays.',
    tags: ['10s To Profit', 'Instant Payouts', 'Trade & Earn']
  }
];

function VisualShell({
  children,
  accent = 'neutral'
}: {
  children: ReactNode;
  accent?: 'neutral' | 'battle' | 'flow';
}) {
  const accentLayer =
    accent === 'battle'
      ? 'bg-[radial-gradient(circle_at_18%_52%,rgba(57,255,20,0.2),transparent_42%),radial-gradient(circle_at_82%_52%,rgba(255,0,60,0.2),transparent_42%)]'
      : accent === 'flow'
        ? 'bg-[radial-gradient(circle_at_12%_48%,rgba(57,255,20,0.16),transparent_40%),radial-gradient(circle_at_82%_16%,rgba(57,255,20,0.1),transparent_42%)]'
        : 'bg-[radial-gradient(circle_at_12%_20%,rgba(57,255,20,0.14),transparent_40%),radial-gradient(circle_at_88%_88%,rgba(255,255,255,0.08),transparent_45%)]';

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-white/12 bg-[#060912]/90 p-2.5">
      <div className={`absolute inset-0 ${accentLayer}`} />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.28) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,0.28) 1px, transparent 1px)',
          backgroundSize: '22px 22px'
        }}
      />
      <div className="pointer-events-none absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
      <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-px bg-gradient-to-r from-transparent via-neon-green/45 to-transparent" />
      <div className="relative z-[1] h-full">{children}</div>
    </div>
  );
}

function buildFrontlinePath(centerPct: number, flow: number): string {
  let path = '';
  for (let y = 5; y <= 95; y += 2.5) {
    const wave = Math.sin(y * 0.12 - flow * 1.8) * 0.42;
    const micro = Math.sin(y * 0.048 + flow * 0.84) * 0.22;
    const x = Math.max(7, Math.min(93, centerPct + wave + micro));
    path += y === 5 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return path;
}

function StepVisual({ step, battlePhase, battleFlow }: { step: number; battlePhase: number; battleFlow: number }) {
  if (step === 1) {
    const centerPct = 50 + battlePhase * 20;
    const direction: 'left' | 'right' | 'neutral' = battlePhase < -0.05 ? 'left' : battlePhase > 0.05 ? 'right' : 'neutral';
    const isLeft = direction === 'left';
    const lineColor = direction === 'neutral' ? '220,220,220' : isLeft ? '57,255,20' : '255,0,60';
    const frontlinePath = buildFrontlinePath(centerPct, battleFlow);
    
    // Floating PnL animation like BattleCanvas
    const cycle = (battleFlow * 0.5) % 1;
    const showLeft = cycle < 0.5;
    const floatProgress = showLeft ? cycle * 2 : (cycle - 0.5) * 2;
    const floatY = -30 * floatProgress;
    const floatOpacity = 1 - floatProgress;
    const floatValue = Math.floor(500 + Math.random() * 500);

    return (
      <VisualShell accent="battle">
        <div className="relative h-full rounded-xl border border-white/10 bg-black/35 overflow-hidden">
          {/* Background gradients */}
          <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-neon-green/10 via-neon-green/5 to-transparent" />
          <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-crimson-red/10 via-crimson-red/5 to-transparent" />

          {/* Top header - Price */}
          <div className="absolute left-1/2 top-3 z-[3] -translate-x-1/2 text-center">
            <div className="text-[9px] font-bold tracking-[0.2em] text-zinc-500 uppercase">BTC-PERP</div>
            <div className="text-lg font-black text-white font-mono mt-0.5">$64,289.40</div>
            <div className={`text-[10px] font-bold mt-0.5 ${direction === 'neutral' ? 'text-zinc-400' : isLeft ? 'text-neon-green' : 'text-crimson-red'}`}>
              {direction === 'neutral' ? '0.00%' : isLeft ? '+0.24%' : '-0.24%'}
            </div>
          </div>

          {/* Center battle visualization */}
          <div className="absolute inset-0 flex items-center justify-center">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
              {/* Frontline with glow - thinner, more refined */}
              <path 
                d={frontlinePath} 
                stroke={`rgba(${lineColor},0.15)`} 
                strokeWidth="6" 
                fill="none" 
                strokeLinecap="round"
                filter={`drop-shadow(0 0 4px rgba(${lineColor},0.4))`}
              />
              <path 
                d={frontlinePath} 
                stroke={`rgba(${lineColor},0.5)`} 
                strokeWidth="2.5" 
                fill="none" 
                strokeLinecap="round"
                filter={`drop-shadow(0 0 2px rgba(${lineColor},0.6))`}
              />
              <path 
                d={frontlinePath} 
                stroke={`rgba(${lineColor},1)`} 
                strokeWidth="1" 
                fill="none" 
                strokeLinecap="round"
              />
            </svg>
          </div>

          {/* Side labels */}
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-center">
            <div className="text-[10px] font-black text-neon-green tracking-wider">LONG</div>
            <div className="text-[8px] text-zinc-500 mt-1">BULLISH</div>
          </div>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-center">
            <div className="text-[10px] font-black text-crimson-red tracking-wider">SHORT</div>
            <div className="text-[8px] text-zinc-500 mt-1">BEARISH</div>
          </div>

          {/* Floating PnL effects like BattleCanvas */}
          {showLeft && (
            <div 
              className="absolute left-[15%] top-1/2 font-mono font-black text-[14px] text-neon-green pointer-events-none z-50"
              style={{ 
                transform: `translateY(${floatY}px)`,
                opacity: floatOpacity,
                textShadow: '0 0 10px #39FF14, 0 0 20px #39FF14'
              }}
            >
              LONG +{floatValue} $MON
            </div>
          )}
          {!showLeft && (
            <div 
              className="absolute right-[15%] top-1/2 font-mono font-black text-[14px] text-crimson-red pointer-events-none z-50"
              style={{ 
                transform: `translateY(${floatY}px)`,
                opacity: floatOpacity,
                textShadow: '0 0 10px #FF003C, 0 0 20px #FF003C'
              }}
            >
              SHORT +{floatValue} $MON
            </div>
          )}

          {/* Bottom status */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
              <span className="text-[9px] text-zinc-400">Live Market</span>
            </div>
            <div className="h-3 w-px bg-white/20" />
            <div className="text-[9px] text-zinc-500">Mark-Price Driven</div>
          </div>
        </div>
      </VisualShell>
    );
  }

  if (step === 2) {
    return (
      <VisualShell>
        <div className="flex h-full flex-col px-2 sm:px-3 pt-1 pb-2">
          {/* Side by side columns with headers */}
          <div className="grid grid-cols-2 gap-3 h-full">
            {/* Left Column - Hyperliquid */}
            <div className="flex flex-col">
              <div className="text-center mb-1 pb-1 border-b border-white/10">
                <div className="text-[10px] sm:text-[11px] font-black text-zinc-400 uppercase tracking-wider">Hyperliquid</div>
              </div>
              <div className="flex-1 flex flex-col gap-1">
                {['Funding Rate', 'Liq Price', 'Order Controls', 'Advanced Setup'].map((item, i) => (
                  <div
                    key={item}
                    className="flex-1 flex items-center justify-center rounded border border-white/10 bg-white/[0.03] px-2 text-[9px] sm:text-[10px] font-medium text-zinc-300 text-center"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column - Perply.fun */}
            <div className="flex flex-col">
              <div className="text-center mb-1 pb-1 border-b border-neon-green/20">
                <div className="text-[10px] sm:text-[11px] font-black text-neon-green uppercase tracking-wider">Perply.fun</div>
              </div>
              <div className="flex-1 flex flex-col gap-1">
                {['Pick LONG/SHORT', 'Deploy', 'Earn $MON'].map((item, i) => (
                  <div
                    key={item}
                    className="flex-1 flex items-center justify-center rounded border border-neon-green/40 bg-neon-green/15 px-2 text-[10px] sm:text-[11px] font-bold text-neon-green text-center"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </VisualShell>
    );
  }

  return (
    <VisualShell accent="flow">
      <div className="grid h-full grid-rows-[auto_1fr_auto] gap-2">
        <div className="flex items-center justify-between rounded-xl border border-white/15 bg-black/45 px-2.5 py-1.5">
          <div className="text-[11px] font-black text-white md:text-xs">Earn in ~10s</div>
          <div className="text-[10px] text-neon-green md:text-[11px]">Wallet Connected</div>
        </div>

        <div className="grid min-h-0 grid-cols-[repeat(4,minmax(0,1fr))] gap-1">
          {['Connect', 'Deposit', 'Long/Short', 'Profit'].map((item, idx) => (
            <div
              key={item}
              className={`relative flex min-h-0 items-center justify-center rounded-md border px-1 text-center text-[10px] font-black md:text-[11px] ${
                idx >= 2
                  ? 'border-neon-green/45 bg-neon-green/12 text-neon-green'
                  : 'border-white/15 bg-white/[0.04] text-zinc-100'
              }`}
            >
              <span className="whitespace-nowrap">{item}</span>
              {idx < 3 && <span className="absolute -right-[7px] top-1/2 -translate-y-1/2 text-zinc-500">→</span>}
            </div>
          ))}
        </div>


      </div>
    </VisualShell>
  );
}

export default function OnboardingTour({ isOpen, onClose }: OnboardingTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [battlePhase, setBattlePhase] = useState(0);
  const [battleFlow, setBattleFlow] = useState(0);

  const stepNo = stepIndex + 1;
  const step = useMemo(() => TOUR_STEPS[stepIndex], [stepIndex]);

  useEffect(() => {
    if (!isOpen) return;
    setStepIndex(0);
    setDontShowAgain(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || stepIndex !== 0) return;
    let raf = 0;
    const startAt = performance.now();

    const tick = (ts: number) => {
      const t = (ts - startAt) / 1000;
      const wave = Math.sin(t * 1.4);
      const eased = Math.tanh(wave * 1.28);
      setBattlePhase(Math.max(-1, Math.min(1, eased)));
      setBattleFlow(t);
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [isOpen, stepIndex]);

  if (!isOpen) return null;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  const handleSkip = () => {
    onClose(dontShowAgain);
  };

  const handleNext = () => {
    if (isLast) {
      onClose(dontShowAgain);
      return;
    }
    setStepIndex(prev => Math.min(TOUR_STEPS.length - 1, prev + 1));
  };

  const handlePrev = () => {
    setStepIndex(prev => Math.max(0, prev - 1));
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-3 md:p-4">
      <div className="absolute inset-0 bg-black/88 backdrop-blur-[1px]" />

      <div className="relative w-[min(96vw,520px)] max-h-[92vh] overflow-hidden rounded-[16px] sm:rounded-[18px] md:rounded-[20px] border border-white/15 bg-gradient-to-b from-[#05070e] to-black shadow-[0_0_60px_rgba(0,0,0,0.95)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(57,255,20,0.08),transparent_45%)]" />

        <div className="relative flex items-center justify-between border-b border-white/10 px-3 py-2 sm:px-4 sm:py-2.5">
          <div className="inline-flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-neon-green shadow-[0_0_8px_#39FF14]" />
            <div className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300" style={{ fontFamily: "'Syncopate', sans-serif" }}>
              Earn in ~10s
            </div>
          </div>
          <div className="text-sm sm:text-base font-mono text-zinc-400">
            {stepNo}/{TOUR_STEPS.length}
          </div>
        </div>

        <div className="relative p-2.5 sm:p-3 md:p-4">
          <div className="flex flex-col rounded-[12px] sm:rounded-[14px] md:rounded-[16px] p-2 sm:p-2.5">
            <div className="h-[140px] sm:h-[160px] md:h-[180px]">
              <StepVisual step={stepNo} battlePhase={battlePhase} battleFlow={battleFlow} />
            </div>
            <h2 className="mt-1 text-[14px] sm:text-[16px] md:text-[20px] leading-[1.2] font-black text-white" style={{ fontFamily: "'Bruno Ace SC', sans-serif" }}>
              {step.title}
            </h2>
            <p className="mt-0.5 text-[10px] sm:text-[11px] leading-snug text-zinc-300">{step.subtitle}</p>
            <div className="mt-1 flex flex-wrap gap-1 sm:gap-1.5">
              {step.tags.map(tag => (
                <div
                  key={tag}
                  className="rounded-full border border-neon-green/35 bg-neon-green/10 px-1.5 py-0.5 text-[7px] sm:text-[8px] font-bold tracking-wide text-neon-green"
                >
                  {tag}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-1.5 flex items-center gap-1.5 sm:gap-2">
            {TOUR_STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 sm:h-2 rounded-full transition-all duration-300 ${idx === stepIndex ? 'w-8 sm:w-10 bg-neon-green shadow-[0_0_8px_#39FF14]' : 'w-3 sm:w-4 bg-white/20'}`}
              />
            ))}
          </div>
        </div>

        <div className="relative flex flex-col gap-2 sm:gap-3 border-t border-white/10 px-3 py-3 sm:px-4 sm:py-3.5 md:flex-row md:items-end md:justify-between">
          <div className="min-h-[20px] sm:min-h-[24px]">
            {isLast && (
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] sm:text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={e => setDontShowAgain(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-white/30 bg-black accent-neon-green"
                />
                Don&apos;t show again
              </label>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 self-end">
            <button
              onClick={handleSkip}
              className="h-8 sm:h-9 min-w-[70px] sm:min-w-[80px] rounded-lg sm:rounded-xl border border-white/20 px-2.5 sm:px-3 text-xs sm:text-sm font-bold text-zinc-300 transition hover:border-white/35 hover:text-white"
            >
              Skip
            </button>
            <button
              onClick={handlePrev}
              disabled={stepIndex === 0}
              className="h-8 sm:h-9 min-w-[80px] sm:min-w-[90px] rounded-lg sm:rounded-xl border border-white/20 px-2.5 sm:px-3 text-xs sm:text-sm font-bold text-zinc-300 transition hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            >
              Prev
            </button>
            <button
              onClick={handleNext}
              className="h-8 sm:h-9 min-w-[100px] sm:min-w-[120px] rounded-lg sm:rounded-xl border border-neon-green/40 bg-neon-green px-2.5 sm:px-3 text-sm sm:text-base font-black text-black transition hover:brightness-95"
            >
              {isLast ? (
                <span className="inline-flex items-center gap-1">
                  <Rocket size={14} />
                  Start
                </span>
              ) : (
                'Next'
              )}
            </button>
          </div>
        </div>

        <div
          className="absolute bottom-0 left-0 h-[2px] sm:h-[3px] bg-neon-green transition-all duration-300"
          style={{ width: `${(stepNo / TOUR_STEPS.length) * 100}%` }}
        />
      </div>
    </div>
  );
}
