import { useEffect, useRef } from 'react';

interface BattleCanvasProps {
  dominance: number; // -1 (bear/left shift) to 1 (bull/right shift), driven by price movement
  latestPnL: { faction: 'left' | 'right'; sideLabel: 'LONG' | 'SHORT'; amount: string; kind: 'settlement' | 'congestion' | 'projection' } | null;
  allianceLiquidity: number;
  syndicateLiquidity: number;
  trend: 'bull' | 'bear' | 'neutral';
}

export default function BattleCanvas({ dominance, latestPnL, allianceLiquidity, syndicateLiquidity, trend }: BattleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pnlContainerRef = useRef<HTMLDivElement>(null);
  
  // Use refs to keep track of latest props inside the animation loop without re-triggering init
  const dominanceRef = useRef(dominance);
  const currentDominanceRef = useRef(dominance); // For smooth interpolation
  const liquidityRef = useRef({ alliance: allianceLiquidity, syndicate: syndicateLiquidity });
  const trendRef = useRef(trend);
  const impactRef = useRef(0); // settlement shock offset impulse
  const waveBoostRef = useRef(0); // temporary wave intensity boost

  useEffect(() => {
    dominanceRef.current = dominance;
  }, [dominance]);

  useEffect(() => {
    trendRef.current = trend;
  }, [trend]);

  useEffect(() => {
    liquidityRef.current = { alliance: allianceLiquidity, syndicate: syndicateLiquidity };
  }, [allianceLiquidity, syndicateLiquidity]);

  const spawnPnL = (side: 'left' | 'right', sideLabel: 'LONG' | 'SHORT', value: string, kind: 'settlement' | 'congestion' | 'projection') => {
    const canvas = canvasRef.current;
    const pnlContainer = pnlContainerRef.current;
    if (!canvas || !pnlContainer) return;

    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    
    const pnl = document.createElement('div');
    const isPositive = side === 'left';
    
    pnl.className = `absolute font-mono font-black animate-float-up pointer-events-none select-none z-50`;
    pnl.style.fontSize = kind === 'projection' ? '30px' : '36px';
    pnl.style.animationDuration = kind === 'projection' ? '1.6s' : '2s';
    
    // Position based on price-driven frontline bias
    const centerOffset = (width * 0.3) * currentDominanceRef.current;
    const centerX = width / 2 + centerOffset;
    
    // Position clearly on the side of the faction
    const xPos = side === 'left' 
      ? centerX - 150 
      : centerX + 50;

    pnl.style.left = `${xPos}px`;
    pnl.style.top = `${height / 2 - 50}px`; // Center vertically
    pnl.style.color = isPositive ? '#39FF14' : '#FF003C';
    pnl.innerText = `${sideLabel} +${value}`;
    // Strong glow
    pnl.style.textShadow = `0 0 20px ${isPositive ? '#39FF14' : '#FF003C'}, 0 0 40px ${isPositive ? '#39FF14' : '#FF003C'}`;
    
    pnlContainer.appendChild(pnl);
    setTimeout(() => pnl.remove(), kind === 'projection' ? 1600 : 2000);
  };

  const triggerBattleImpact = (side: 'left' | 'right', amountRaw: string, kind: 'settlement' | 'congestion' | 'projection') => {
    const normalized = Number(amountRaw.replace(/,/g, ''));
    const amount = Number.isFinite(normalized) ? Math.max(0, normalized) : 0;
    const direction = side === 'left' ? 1 : -1;

    // Settlements should feel significantly stronger than congestion transfers.
    const baseKick = kind === 'settlement' ? 0.22 : kind === 'projection' ? 0.08 : 0.05;
    const maxKick = kind === 'settlement' ? 0.5 : kind === 'projection' ? 0.2 : 0.14;
    const scaledKick = Math.min(maxKick, baseKick + Math.log10(amount + 1) * 0.08);
    impactRef.current = Math.max(-1, Math.min(1, impactRef.current + direction * scaledKick));

    const boost = kind === 'settlement' ? 0.55 : kind === 'projection' ? 0.22 : 0.16;
    waveBoostRef.current = Math.max(0, Math.min(1.2, waveBoostRef.current + boost));
  };

  // Handle PnL Spawning via Prop
  useEffect(() => {
    if (latestPnL) {
      spawnPnL(latestPnL.faction, latestPnL.sideLabel, latestPnL.amount, latestPnL.kind);
      triggerBattleImpact(latestPnL.faction, latestPnL.amount, latestPnL.kind);
    }
  }, [latestPnL]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const pnlContainer = pnlContainerRef.current;
    if (!canvas || !pnlContainer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    
    // Resize function needs to be defined before Agent uses width/height
    const resize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };

    // Agent class definition
    class Agent {
      side: 'left' | 'right';
      x: number = 0;
      y: number = 0;
      size: number = 0;
      speed: number = 0;
      color: string = '';
      targetX: number = 0;
      targetY: number = 0;

      constructor(side: 'left' | 'right') {
        this.side = side;
        this.reset();
      }

      reset() {
        // Spawn logic
        if (this.side === 'left') {
           this.x = Math.random() * (width * 0.2);
        } else {
           this.x = width - Math.random() * (width * 0.2);
        }
        
        this.y = Math.random() * height;
        this.size = Math.random() * 3 + 2;
        this.speed = Math.random() * 2 + 1;
        this.color = this.side === 'left' ? '#39FF14' : '#FF003C';
        this.updateTarget();
      }

      updateTarget() {
        // The frontline moves based on interpolated price bias
        const centerOffset = (width * 0.32) * currentDominanceRef.current;
        const shockOffset = impactRef.current * width * 0.1;
        const centerX = Math.max(width * 0.16, Math.min(width * 0.84, width / 2 + centerOffset + shockOffset));
        
        this.targetX = centerX;
        this.targetY = height / 2 + (Math.random() - 0.5) * (height * 0.8);
      }

      update() {
        this.updateTarget(); // Constantly update target as frontline moves

        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > 1) {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }

        // Reset if they reach the frontline/center
        if (dist < 20) {
          this.reset();
        }
      }

      draw() {
        if (!ctx) return;
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        
        // Pixel art style unit
        ctx.fillRect(this.x, this.y, this.size, this.size);
        
        // Energy beam
        if (Math.random() > 0.98) {
          ctx.beginPath();
          ctx.strokeStyle = this.color;
          ctx.lineWidth = 0.5;
          ctx.moveTo(this.x, this.y);
          ctx.lineTo(this.targetX, this.targetY);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
    }

    const agents: Agent[] = [];
    const agentCount = 150;
    let animationFrameId: number;

    function init() {
      resize();
      agents.length = 0; // Clear existing agents
      
      for (let i = 0; i < agentCount; i++) {
        agents.push(new Agent(i < agentCount / 2 ? 'left' : 'right'));
      }
      
      animate();
    }

    function animate() {
      if (!ctx) return;
      
      // Smoothly interpolate dominance
      const targetDom = dominanceRef.current;
      const currentDom = currentDominanceRef.current;
      const diff = targetDom - currentDom;
      
      if (Math.abs(diff) > 0.0001) {
          currentDominanceRef.current += diff * 0.08;
      } else {
          currentDominanceRef.current = targetDom;
      }

      // Decay impulse/wave effects so each settlement creates a clear kick then cools down.
      impactRef.current *= 0.92;
      waveBoostRef.current *= 0.94;
      if (Math.abs(impactRef.current) < 0.002) impactRef.current = 0;
      if (waveBoostRef.current < 0.01) waveBoostRef.current = 0;

      ctx.clearRect(0, 0, width, height);
      
      const centerOffset = (width * 0.32) * currentDominanceRef.current;
      const shockOffset = impactRef.current * width * 0.12;
      const centerX = Math.max(width * 0.16, Math.min(width * 0.84, width / 2 + centerOffset + shockOffset));

      // Calculate intensity based on liquidity
      const maxLiq = 5000000;
      const allianceIntensity = Math.min(0.4, Math.max(0.05, liquidityRef.current.alliance / maxLiq));
      const syndicateIntensity = Math.min(0.4, Math.max(0.05, liquidityRef.current.syndicate / maxLiq));

      // Draw Dynamic Grid (Territory)
      const gridSize = 40;
      
      // Calculate offset to align with global background grid (fixed at 0,0)
      const rect = canvas.getBoundingClientRect();
      const offsetX = rect.left % gridSize;
      const offsetY = rect.top % gridSize;

      ctx.lineWidth = 1;
      
      // Vertical Lines with Color Blending and Edge Fade
      for (let x = -offsetX; x <= width; x += gridSize) {
        if (x < 0) continue;
        ctx.beginPath();
        
        let r, g, b, alpha;
        
        // Distance from frontline
        const dist = x - centerX;
        
        // Smooth transition zone width (pixels)
        const transition = 60;
        
        if (dist < -transition) {
            // Fully Alliance
            r = 57; g = 255; b = 20; 
            alpha = allianceIntensity;
        } else if (dist > transition) {
            // Fully Syndicate
            r = 255; g = 0; b = 60; 
            alpha = syndicateIntensity;
        } else {
            // Blend Colors
            const t = (dist + transition) / (transition * 2); // 0 to 1
            r = 57 + (255 - 57) * t;
            g = 255 + (0 - 255) * t;
            b = 20 + (60 - 20) * t;
            alpha = allianceIntensity + (syndicateIntensity - allianceIntensity) * t;
        }

        // Horizontal Fade (Left/Right Edges)
        const xEdgeDist = Math.min(x, width - x);
        const xFade = Math.min(1, xEdgeDist / 100); // Fade out over 100px
        alpha *= xFade;

        const gradient = ctx.createLinearGradient(x, 0, x, height);
        gradient.addColorStop(0, `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0)`);
        gradient.addColorStop(0.2, `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`);
        gradient.addColorStop(0.8, `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`);
        gradient.addColorStop(1, `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0)`);

        ctx.strokeStyle = gradient;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Horizontal Lines with Edge Fade
      for (let y = -offsetY; y <= height; y += gridSize) {
        if (y < 0) continue;
        ctx.beginPath();
        
        // Vertical Fade (Top/Bottom Edges)
        const yEdgeDist = Math.min(y, height - y);
        const yFade = Math.min(1, yEdgeDist / 100); // Fade out over 100px

        const gradient = ctx.createLinearGradient(0, y, width, y);
        
        const centerRatio = Math.max(0, Math.min(1, centerX / width));
        const softZone = 0.05; // 5% width transition

        // Helper to get color string with alpha
        const getColor = (r: number, g: number, b: number, a: number) => `rgba(${r}, ${g}, ${b}, ${a * yFade})`;

        gradient.addColorStop(0, getColor(57, 255, 20, 0)); // Fade left edge
        gradient.addColorStop(0.1, getColor(57, 255, 20, allianceIntensity));
        
        // Start blending before center
        gradient.addColorStop(Math.max(0, centerRatio - softZone), getColor(57, 255, 20, allianceIntensity));
        
        // End blending after center
        gradient.addColorStop(Math.min(1, centerRatio + softZone), getColor(255, 0, 60, syndicateIntensity));
        
        gradient.addColorStop(0.9, getColor(255, 0, 60, syndicateIntensity));
        gradient.addColorStop(1, getColor(255, 0, 60, 0)); // Fade right edge
        
        ctx.strokeStyle = gradient;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw Soft Neon Wave (Frontline)
      const currentTrend = trendRef.current;
      
      let baseColor = '0, 0, 0'; // Black (Neutral)
      if (currentTrend === 'bull') baseColor = '57, 255, 20'; // Green
      if (currentTrend === 'bear') baseColor = '255, 0, 60'; // Red
      
      // Define the wave path
      ctx.beginPath();
      // Use time for flowing animation
      const flowOffset = Date.now() * 0.004;
      const waveAmp = 7 + waveBoostRef.current * 14;
      const distortionAmp = 11 + waveBoostRef.current * 20;
      
      for (let i = 0; i <= height; i += 5) {
         // Persistent organic wave + settlement boost distortion.
         const wave = Math.sin(i * 0.02 - flowOffset) * waveAmp;
         const distortion = Math.sin(i * 0.01) * distortionAmp * currentDominanceRef.current;
         
         const x = centerX + wave + distortion;
         if (i === 0) ctx.moveTo(x, i);
         else ctx.lineTo(x, i);
      }

      // Draw Glow Layers for Soft Neon Effect
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Layer 1: Wide Outer Glow (Atmosphere)
      ctx.shadowBlur = 22 + waveBoostRef.current * 14;
      ctx.shadowColor = `rgba(${baseColor}, 0.4)`;
      ctx.strokeStyle = `rgba(${baseColor}, 0.1)`;
      ctx.lineWidth = 15 + waveBoostRef.current * 8;
      ctx.stroke();

      // Layer 2: Medium Glow (Halo)
      ctx.shadowBlur = 11 + waveBoostRef.current * 8;
      ctx.shadowColor = `rgba(${baseColor}, 0.6)`;
      ctx.strokeStyle = `rgba(${baseColor}, 0.4)`;
      ctx.lineWidth = 6 + waveBoostRef.current * 3;
      ctx.stroke();

      // Layer 3: Core (Bright Center)
      ctx.shadowBlur = 4 + waveBoostRef.current * 3;
      ctx.shadowColor = `rgba(${baseColor}, 1)`;
      ctx.strokeStyle = `rgba(${baseColor}, 1)`; // Match base color for core
      ctx.lineWidth = 2.2 + waveBoostRef.current * 1.2;
      ctx.stroke();
      
      // Reset
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;

      agents.forEach(agent => {
        agent.update();
        agent.draw();
      });

      animationFrameId = requestAnimationFrame(animate);
    }

    window.addEventListener('resize', resize);
    init();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <>
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 w-full h-full z-10" 
        id="battleCanvas"
      />
      <div 
        ref={pnlContainerRef} 
        className="absolute inset-0 pointer-events-none z-40 overflow-hidden" 
        id="pnlContainer"
      />
    </>
  );
}
