'use strict';

// ── BearingFL Demo Animation ───────────────────────────────────────────────
// Canvas-based animated FL network visualization for the hero section.
// Shows: clients ↔ server gradient exchange, round counter, accuracy growth.

(function () {
  const PHASE_MS   = { training: 1400, upload: 1200, aggregate: 800, broadcast: 1000, rest: 600 };
  const PHASES     = ['training', 'upload', 'aggregate', 'broadcast', 'rest'];
  const MAX_ROUNDS = 10;
  const ACC_CURVE  = [62, 71, 78, 83, 87, 89.5, 91.2, 92.8, 93.9, 94.6]; // simulated accuracy per round

  const PHASE_LABELS = {
    training:  '⚡ Local training',
    upload:    '↑ Gradient upload',
    aggregate: '⚙ Aggregating',
    broadcast: '↓ Model broadcast',
    rest:      '✓ Round complete',
  };

  // Palette aligned with app theme
  const CLR = {
    bg:           '#0f172a',
    bgPanel:      '#1e293b',
    border:       '#334155',
    indigo:       '#6366f1',
    indigoSoft:   '#818cf8',
    green:        '#4ade80',
    cyan:         '#38bdf8',
    slate:        '#64748b',
    text:         '#e2e8f0',
    textMuted:    '#94a3b8',
  };

  class FLDemo {
    constructor(canvas, roundEl, accEl, phaseEl) {
      this.canvas   = canvas;
      this.ctx      = canvas.getContext('2d');
      this.roundEl  = roundEl;
      this.accEl    = accEl;
      this.phaseEl  = phaseEl;

      this.round      = 0;
      this.phaseIdx   = 0;
      this.phaseStart = performance.now();
      this.particles  = [];
      this.clientGlow = [];
      this.serverGlow = 0;

      this._resize();
      this._setupNodes();
      window.addEventListener('resize', () => { this._resize(); this._setupNodes(); });
      requestAnimationFrame(t => this._tick(t));
    }

    _resize() {
      const el = this.canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      this.canvas.width  = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width  = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.scale(dpr, dpr);
      this.W = w;
      this.H = h;
    }

    _setupNodes() {
      const cx = this.W * 0.46;
      const cy = this.H * 0.50;
      const r  = Math.min(this.W, this.H) * 0.30;
      const n  = 5;
      this.server  = { x: cx, y: cy };
      this.clients = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), id: i };
      });
      this.clientGlow = new Array(n).fill(0);
    }

    _currentPhase()     { return PHASES[this.phaseIdx]; }
    _phaseDuration()    { return PHASE_MS[this._currentPhase()]; }

    _tick(now) {
      const elapsed = now - this.phaseStart;
      if (elapsed >= this._phaseDuration()) {
        this._advancePhase();
      }
      const t = Math.min(elapsed / this._phaseDuration(), 1);
      this._update(t, now);
      this._draw(now);
      requestAnimationFrame(ts => this._tick(ts));
    }

    _advancePhase() {
      this.phaseStart = performance.now();
      this.phaseIdx   = (this.phaseIdx + 1) % PHASES.length;
      if (this._currentPhase() === 'training') {
        // Start a new round
        this.round = Math.min(this.round + 1, MAX_ROUNDS);
        if (this.round === MAX_ROUNDS) this.round = 0;
      }
      // Update HUD
      if (this.roundEl)  this.roundEl.textContent  = `${this.round || 1}/${MAX_ROUNDS}`;
      if (this.accEl)    this.accEl.textContent     = this.round > 0 ? `${ACC_CURVE[this.round - 1].toFixed(1)}%` : '–';
      if (this.phaseEl)  this.phaseEl.textContent   = PHASE_LABELS[this._currentPhase()];
    }

    _update(t, now) {
      const phase = this._currentPhase();

      // Client glow
      this.clientGlow = this.clientGlow.map((g, i) => {
        if (phase === 'training')  return 0.6 + 0.4 * Math.sin(now * 0.004 + i * 1.3);
        if (phase === 'upload')    return 0.5 + 0.5 * Math.sin(now * 0.006 + i);
        if (phase === 'broadcast') return 0.4 + 0.4 * Math.sin(now * 0.005 + i * 0.8);
        return Math.max(0, g - 0.04);
      });

      // Server glow
      this.serverGlow = (phase === 'aggregate' || phase === 'broadcast')
        ? 0.7 + 0.3 * Math.sin(now * 0.007) : Math.max(0, this.serverGlow - 0.04);

      // Spawn particles
      if (phase === 'upload' && Math.random() < 0.25) {
        const c = this.clients[Math.floor(Math.random() * this.clients.length)];
        this.particles.push({
          x: c.x, y: c.y,
          tx: this.server.x, ty: this.server.y,
          prog: 0, spd: 0.018 + Math.random() * 0.012,
          color: CLR.indigoSoft,
        });
      }
      if (phase === 'broadcast' && Math.random() < 0.2) {
        const c = this.clients[Math.floor(Math.random() * this.clients.length)];
        this.particles.push({
          x: this.server.x, y: this.server.y,
          tx: c.x, ty: c.y,
          prog: 0, spd: 0.018 + Math.random() * 0.012,
          color: CLR.green,
        });
      }

      // Move particles
      this.particles.forEach(p => {
        p.prog += p.spd;
        const ease = p.prog < 0.5 ? 2 * p.prog * p.prog : -1 + (4 - 2 * p.prog) * p.prog;
        p.cx = p.x + (p.tx - p.x) * ease;
        p.cy = p.y + (p.ty - p.y) * ease;
      });
      this.particles = this.particles.filter(p => p.prog < 1);
    }

    _draw(now) {
      const ctx = this.ctx;
      const { W, H } = this;
      ctx.clearRect(0, 0, W, H);

      // Background subtle grid
      ctx.strokeStyle = 'rgba(51,65,85,0.2)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // Connection lines
      this.clients.forEach(c => {
        const grad = ctx.createLinearGradient(c.x, c.y, this.server.x, this.server.y);
        grad.addColorStop(0, 'rgba(99,102,241,0.06)');
        grad.addColorStop(0.5, 'rgba(99,102,241,0.18)');
        grad.addColorStop(1, 'rgba(99,102,241,0.06)');
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(this.server.x, this.server.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Particles
      this.particles.forEach(p => {
        // Glow
        ctx.shadowBlur   = 10;
        ctx.shadowColor  = p.color;
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        // Trail
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, 7, 0, Math.PI * 2);
        ctx.fillStyle = p.color + '22';
        ctx.fill();
      });

      // ── Server node ──────────────────────────────────────────────
      const sx = this.server.x;
      const sy = this.server.y;
      const sr = 32;
      if (this.serverGlow > 0) {
        const sg = ctx.createRadialGradient(sx, sy, sr, sx, sy, sr * 3.2);
        sg.addColorStop(0, `rgba(99,102,241,${this.serverGlow * 0.35})`);
        sg.addColorStop(1, 'transparent');
        ctx.beginPath(); ctx.arc(sx, sy, sr * 3.2, 0, Math.PI * 2);
        ctx.fillStyle = sg; ctx.fill();
      }
      const sGrad = ctx.createRadialGradient(sx - 8, sy - 8, 2, sx, sy, sr);
      sGrad.addColorStop(0, this.serverGlow > 0.3 ? '#818cf8' : '#334155');
      sGrad.addColorStop(1, this.serverGlow > 0.3 ? '#4f46e5' : '#1e293b');
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fillStyle = sGrad; ctx.fill();
      ctx.strokeStyle = this.serverGlow > 0.3 ? CLR.indigo : CLR.border;
      ctx.lineWidth = 2; ctx.stroke();
      // Server icon
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('SERVER', sx, sy);

      // ── Client nodes ──────────────────────────────────────────────
      this.clients.forEach((c, i) => {
        const g = this.clientGlow[i];
        const cr = 22;
        if (g > 0.15) {
          const cg = ctx.createRadialGradient(c.x, c.y, cr, c.x, c.y, cr * 3);
          cg.addColorStop(0, `rgba(129,140,248,${g * 0.3})`);
          cg.addColorStop(1, 'transparent');
          ctx.beginPath(); ctx.arc(c.x, c.y, cr * 3, 0, Math.PI * 2);
          ctx.fillStyle = cg; ctx.fill();
        }
        const cGrad = ctx.createRadialGradient(c.x - 5, c.y - 5, 2, c.x, c.y, cr);
        cGrad.addColorStop(0, g > 0.3 ? '#a78bfa' : '#1e293b');
        cGrad.addColorStop(1, g > 0.3 ? '#6366f1' : '#0f172a');
        ctx.beginPath(); ctx.arc(c.x, c.y, cr, 0, Math.PI * 2);
        ctx.fillStyle = cGrad; ctx.fill();
        ctx.strokeStyle = g > 0.3 ? CLR.indigoSoft : CLR.border;
        ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = g > 0.3 ? '#fff' : CLR.slate;
        ctx.font = 'bold 9px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`C${i + 1}`, c.x, c.y);
      });

      // ── Accuracy mini-bar (bottom right area of canvas) ──────────
      if (this.round > 0) {
        const bx = W - 14;
        const by = H - 16;
        const bw = 100;
        const bh = 4;
        const acc = ACC_CURVE[Math.min(this.round - 1, MAX_ROUNDS - 1)];
        ctx.fillStyle = 'rgba(15,23,42,0.6)';
        _roundRect(ctx, bx - bw - 6, by - 14, bw + 12, 24, 6);
        ctx.fill();
        ctx.fillStyle = CLR.border;
        _roundRect(ctx, bx - bw, by - 2, bw, bh, 2);
        ctx.fill();
        const fillW = bw * (acc / 100);
        const barGrad = ctx.createLinearGradient(bx - bw, 0, bx, 0);
        barGrad.addColorStop(0, '#6366f1');
        barGrad.addColorStop(1, '#4ade80');
        ctx.fillStyle = barGrad;
        _roundRect(ctx, bx - bw, by - 2, fillW, bh, 2);
        ctx.fill();
        ctx.fillStyle = CLR.textMuted;
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${acc.toFixed(1)}%`, bx, by - 2 - 5);
      }
    }
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const canvas   = document.getElementById('demo-canvas');
    const roundEl  = document.getElementById('demo-round');
    const accEl    = document.getElementById('demo-acc');
    const phaseEl  = document.getElementById('demo-phase');
    if (canvas) new FLDemo(canvas, roundEl, accEl, phaseEl);
  });
})();
