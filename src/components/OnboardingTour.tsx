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
    title: 'Win The Direction Battle',
    subtitle: 'Follow mark-price momentum, choose LONG/SHORT, and capture MON from the losing side.',
    tags: ['Live Mark Price', 'Second-Level Settlement', 'Winner Takes Opposite Flow']
  },
  {
    label: 'Low Friction',
    title: 'Simpler Than Traditional Perps',
    subtitle: 'No heavy setup. Choose direction, amount, and leverage, then deploy in one flow.',
    tags: ['Simple Entry Flow', 'No Heavy Setup', 'More Shots At Profit']
  },
  {
    label: 'Fast Start',
    title: 'Start Earning In 10 Seconds',
    subtitle: 'Connect wallet, deposit MON, choose direction, and go live in one fast flow.',
    tags: ['10s To Start Earning', 'On-Chain Traceable', 'Anytime Exit']
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
      ? 'bg-[radial-gradient(circle_at_18%_52%,rgba(57,255,20,0.16),transparent_40%),radial-gradient(circle_at_82%_52%,rgba(255,0,60,0.16),transparent_40%)]'
      : accent === 'flow'
        ? 'bg-[radial-gradient(circle_at_12%_50%,rgba(57,255,20,0.14),transparent_38%),radial-gradient(circle_at_88%_20%,rgba(57,255,20,0.09),transparent_42%)]'
        : 'bg-[radial-gradient(circle_at_12%_20%,rgba(57,255,20,0.1),transparent_38%),radial-gradient(circle_at_88%_88%,rgba(255,255,255,0.05),transparent_42%)]';

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-white/12 bg-[#05070d]/90 p-2.5">
      <div className={`absolute inset-0 ${accentLayer}`} />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
          backgroundSize: '22px 22px'
        }}
      />
      <div className="pointer-events-none absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
      <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-px bg-gradient-to-r from-transparent via-neon-green/40 to-transparent" />
      <div className="relative z-[1] h-full">{children}</div>
    </div>
  );
}

function StepVisual({ step, battlePhase, battleFlow }: { step: number; battlePhase: number; battleFlow: number }) {
  if (step === 1) {
    const frontlinePct = 50 + battlePhase * 33;
    const directionalLeft = battlePhase < 0;
    const payoutSide = battlePhase <= -0.86 ? 'left' : battlePhase >= 0.86 ? 'right' : null;
    const leftWin = payoutSide === 'left';
    const rightWin = payoutSide === 'right';
    const edgeIntensity = Math.max(0, (Math.abs(battlePhase) - 0.8) / 0.2);
    const callLabel = '+1000 MON';
    const pressureWidth = Math.max(8, Math.min(92, 50 + battlePhase * 40));
    const lineColor = directionalLeft ? '57,255,20' : '255,0,60';
    const flowOffset = battleFlow * 4.6;

    let frontlinePath = '';
    for (let y = 40; y <= 100; y += 3) {
      const wave = Math.sin(y * 0.22 - flowOffset) * 1.8;
      const distortion = Math.sin(y * 0.1 + flowOffset * 0.7) * battlePhase * 6.2;
      const x = frontlinePct + wave + distortion;
      frontlinePath += y === 40 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }

    return (
      <VisualShell accent="battle">
        <div className="relative h-full rounded-xl border border-white/10 bg-black/35">
          <div className="absolute inset-y-0 left-0 w-[49%] bg-gradient-to-r from-neon-green/22 via-neon-green/8 to-transparent" />
          <div className="absolute inset-y-0 right-0 w-[49%] bg-gradient-to-l from-crimson-red/22 via-crimson-red/8 to-transparent" />

          <div className="absolute left-1/2 top-[8px] -translate-x-1/2 rounded-full border border-white/15 bg-black/60 px-2 py-0.5 text-[10px] font-bold tracking-[0.16em] text-zinc-300">
            BTC-PERP MARK PRICE
          </div>
          <div className="absolute left-1/2 top-[28px] -translate-x-1/2 text-base font-black text-white font-mono md:text-lg">
            $64,289.40
          </div>
          <div className={`absolute left-1/2 top-[49px] -translate-x-1/2 text-[11px] font-bold ${directionalLeft ? 'text-neon-green' : 'text-crimson-red'}`}>
            {directionalLeft ? '+0.24%' : '-0.24%'}
          </div>

          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
            <path
              d={frontlinePath}
              stroke={`rgba(${lineColor},0.14)`}
              strokeWidth="10"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={frontlinePath}
              stroke={`rgba(${lineColor},0.48)`}
              strokeWidth="4.2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={frontlinePath}
              stroke={`rgba(${lineColor},0.95)`}
              strokeWidth="1.7"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <div
            className={`absolute left-2 top-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-[10px] font-black tracking-wide transition-all duration-300 md:text-[11px] ${
              leftWin
                ? 'border-neon-green/55 bg-neon-green/18 text-neon-green shadow-[0_0_18px_rgba(57,255,20,0.34)]'
                : directionalLeft
                  ? 'border-neon-green/30 bg-neon-green/8 text-neon-green/80'
                  : 'border-white/15 bg-black/35 text-zinc-500'
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <span>LONG</span>
              <span className="transition-opacity duration-300" style={{ opacity: leftWin ? edgeIntensity : 0 }}>
                {callLabel}
              </span>
            </span>
          </div>
          <div
            className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-[10px] font-black tracking-wide transition-all duration-300 md:text-[11px] ${
              rightWin
                ? 'border-crimson-red/55 bg-crimson-red/16 text-crimson-red shadow-[0_0_18px_rgba(255,0,60,0.34)]'
                : !directionalLeft
                  ? 'border-crimson-red/30 bg-crimson-red/8 text-crimson-red/80'
                  : 'border-white/15 bg-black/35 text-zinc-500'
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <span>SHORT</span>
              <span className="transition-opacity duration-300" style={{ opacity: rightWin ? edgeIntensity : 0 }}>
                {callLabel}
              </span>
            </span>
          </div>

          <div className="absolute bottom-[8px] left-2 right-2 rounded-full border border-white/15 bg-black/55 p-[2px]">
            <div className="relative h-1.5 rounded-full bg-zinc-900">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-neon-green via-zinc-200 to-crimson-red"
                style={{ width: `${pressureWidth}%` }}
              />
            </div>
            <div className="mt-0.5 flex items-center justify-between text-[9px] uppercase tracking-[0.16em] text-zinc-500">
              <span>LONG Pressure</span>
              <span>SHORT Pressure</span>
            </div>
          </div>
        </div>
      </VisualShell>
    );
  }

  if (step === 2) {
    return (
      <VisualShell>
        <div className="grid h-full min-h-0 grid-cols-2 gap-2">
          <div className="flex min-h-0 flex-col rounded-xl border border-white/12 bg-black/42 p-2">
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">PERPS</div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              {['Funding/Index', 'Liq Price', 'Order Controls'].map(item => (
                <div
                  key={item}
                  className="flex-1 rounded-md border border-white/12 bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-zinc-300 md:text-[11px]"
                >
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">6+ setup decisions</div>
          </div>

          <div className="flex min-h-0 flex-col rounded-xl border border-neon-green/40 bg-neon-green/10 p-2">
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-neon-green">PERPLY</div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              {['Pick LONG/SHORT', 'Set Amount + Leverage', 'Deploy + Track PnL'].map(item => (
                <div
                  key={item}
                  className="flex-1 rounded-md border border-neon-green/40 bg-neon-green/12 px-2 py-1 text-[10px] font-semibold text-neon-green md:text-[11px]"
                >
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-neon-green/90">single-flow execution</div>
          </div>
        </div>
      </VisualShell>
    );
  }

  return (
    <VisualShell accent="flow">
      <div className="grid h-full grid-rows-[auto_1fr_auto] gap-2">
        <div className="flex items-center justify-between rounded-xl border border-white/15 bg-black/45 px-2.5 py-1.5">
          <div className="text-[11px] font-black text-white md:text-xs">Ready To Enter In ~10s</div>
          <div className="text-[10px] text-neon-green md:text-[11px]">Wallet Connected</div>
        </div>

        <div className="grid min-h-0 grid-cols-[repeat(5,minmax(0,1fr))] gap-1">
          {['Connect', 'Deposit', 'Long/Short', 'Deploy', 'Profit'].map((item, idx) => (
            <div
              key={item}
              className={`relative flex min-h-0 items-center justify-center rounded-md border px-1 text-center text-[10px] font-black md:text-[11px] ${
                idx >= 2
                  ? 'border-neon-green/45 bg-neon-green/12 text-neon-green'
                  : 'border-white/15 bg-white/[0.04] text-zinc-100'
              }`}
            >
              <span className="whitespace-nowrap">{item}</span>
              {idx < 4 && <span className="absolute -right-[7px] top-1/2 -translate-y-1/2 text-zinc-500">→</span>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-neon-green/30 bg-neon-green/10 px-2.5 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.14em] text-neon-green/90">Settlement Fee</div>
            <div className="text-[11px] font-black text-neon-green md:text-xs">0.01% winner-side only</div>
          </div>
          <div className="rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">Congestion Split</div>
            <div className="text-[11px] font-black text-zinc-100 md:text-xs">80% rival side / 20% treasury</div>
          </div>
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
      // Smooth center-to-edge oscillation with arena-like flowing wave distortion.
      const wave = Math.sin(t * 1.95);
      setBattlePhase(Math.max(-1, Math.min(1, wave)));
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 md:p-6">
      <div className="absolute inset-0 bg-black/88 backdrop-blur-[1px]" />

      <div className="relative w-[min(92vw,760px)] max-h-[88vh] overflow-hidden rounded-[22px] border border-white/15 bg-gradient-to-b from-[#05070e] to-black shadow-[0_0_90px_rgba(0,0,0,0.95)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(57,255,20,0.08),transparent_45%)]" />

        <div className="relative flex items-center justify-between border-b border-white/10 px-4 py-3 md:px-5">
          <div className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-neon-green shadow-[0_0_10px_#39FF14]" />
            <div className="text-[10px] md:text-xs font-black uppercase tracking-[0.28em] text-zinc-300" style={{ fontFamily: "'Syncopate', sans-serif" }}>
              Quick Guide To Earn MON
            </div>
          </div>
          <div className="text-base md:text-lg font-mono text-zinc-400">
            {stepNo}/{TOUR_STEPS.length}
          </div>
        </div>

        <div className="relative overflow-y-auto p-4 md:p-5">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-neon-green">{step.label}</div>
          <div className="flex min-h-[360px] flex-col rounded-[18px] border border-neon-green/20 bg-gradient-to-b from-neon-green/5 via-transparent to-transparent p-2.5 md:min-h-[384px] md:p-3">
            <div className="h-[178px] md:h-[196px]">
              <StepVisual step={stepNo} battlePhase={battlePhase} battleFlow={battleFlow} />
            </div>
            <h2 className="mt-4 text-[28px] leading-[1.1] font-black text-white md:text-[32px]" style={{ fontFamily: "'Bruno Ace SC', sans-serif" }}>
              {step.title}
            </h2>
            <p className="mt-2 min-h-[48px] text-sm leading-relaxed text-zinc-300 md:min-h-[52px] md:text-base">{step.subtitle}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {step.tags.map(tag => (
                <div
                  key={tag}
                  className="rounded-full border border-neon-green/35 bg-neon-green/10 px-3 py-1 text-[10px] font-bold tracking-wide text-neon-green md:text-[11px]"
                >
                  {tag}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            {TOUR_STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`h-2 rounded-full transition-all duration-300 ${idx === stepIndex ? 'w-10 bg-neon-green shadow-[0_0_12px_#39FF14]' : 'w-4 bg-white/20'}`}
              />
            ))}
          </div>
        </div>

        <div className="relative flex flex-col gap-3 border-t border-white/10 px-4 py-4 md:flex-row md:items-end md:justify-between md:px-5">
          <div className="min-h-[24px]">
            {isLast && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400 md:text-sm">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={e => setDontShowAgain(e.target.checked)}
                  className="h-4 w-4 rounded border-white/30 bg-black accent-neon-green"
                />
                Don&apos;t show again
              </label>
            )}
          </div>

          <div className="flex items-center gap-2 self-end">
            <button
              onClick={handleSkip}
              className="h-10 min-w-[92px] rounded-xl border border-white/20 px-4 text-sm font-bold text-zinc-300 transition hover:border-white/35 hover:text-white"
            >
              Skip
            </button>
            <button
              onClick={handlePrev}
              disabled={stepIndex === 0}
              className="h-10 min-w-[110px] rounded-xl border border-white/20 px-4 text-sm font-bold text-zinc-300 transition hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            >
              Previous
            </button>
            <button
              onClick={handleNext}
              className="h-10 min-w-[140px] rounded-xl border border-neon-green/40 bg-neon-green px-4 text-base font-black text-black transition hover:brightness-95"
            >
              {isLast ? (
                <span className="inline-flex items-center gap-1.5">
                  <Rocket size={16} />
                  Start
                </span>
              ) : (
                'Next'
              )}
            </button>
          </div>
        </div>

        <div
          className="absolute bottom-0 left-0 h-[3px] bg-neon-green transition-all duration-300"
          style={{ width: `${(stepNo / TOUR_STEPS.length) * 100}%` }}
        />
      </div>
    </div>
  );
}
