/**
 * Minimal canvas charts.
 *
 * Deliberately dependency-free rather than pulling in a charting library:
 *  - the whole tool stays self-contained and works offline from a file:// path
 *  - there is no third-party request on page load
 *  - HiDPI and theming are handled explicitly instead of fought with
 *
 * The API is intentionally narrow — four chart shapes is all the report needs.
 */

const SERIES = {
  flick: '#f43f5e',
  track: '#34d399',
  micro: '#a78bfa',
  accent: '#60a5fa',
  muted: '#94a3b8',
  grid: 'rgba(148, 163, 184, 0.18)',
};

/** Size a canvas for the device pixel ratio and return a drawing context. */
function prepare(canvas, cssHeight = 240) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement?.clientWidth ?? canvas.clientWidth ?? 480;
  const width = Math.max(240, cssWidth - 32);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, cssHeight);
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  return { ctx, w: width, h: cssHeight };
}

function palette() {
  const light = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  return {
    text: light ? '#292524' : '#f1f5f9',
    muted: light ? '#6b6560' : '#94a3b8',
    grid: light ? 'rgba(41,37,36,0.14)' : 'rgba(148,163,184,0.18)',
    surface: light ? '#ffffff' : '#243449',
  };
}

function axesFrame(ctx, w, h, pad) {
  const p = palette();
  ctx.strokeStyle = p.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, h - pad.b);
  ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
  return p;
}

/**
 * Line chart of score against sensitivity, with the recommended multiplier
 * marked. This is the chart that justifies the recommendation, so the peak is
 * annotated rather than left for the reader to eyeball.
 */
export function drawCurve(canvas, { samples, recommended, fit }) {
  const { ctx, w, h } = prepare(canvas, 250);
  const p = palette();
  const pad = { l: 44, r: 16, t: 16, b: 34 };
  axesFrame(ctx, w, h, pad);

  if (!samples.length) return;

  const xs = samples.map((s) => s[0]);
  const ys = samples.map((s) => s[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = 0;
  const yMax = Math.max(0.2, Math.max(...ys) * 1.15);

  const sx = (x) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * (w - pad.l - pad.r);
  const sy = (y) => h - pad.b - ((y - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);

  // y axis ticks
  ctx.fillStyle = p.muted;
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = yMin + ((yMax - yMin) * i) / 4;
    const y = sy(v);
    ctx.fillText((v * 100).toFixed(0), pad.l - 8, y + 4);
    ctx.strokeStyle = p.grid;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }

  // x axis labels
  ctx.textAlign = 'center';
  for (const x of xs) {
    ctx.fillText(`${x}×`, sx(x), h - pad.b + 16);
  }

  // fitted curve, if the fit is a usable downward parabola
  if (fit && fit.a < 0) {
    ctx.strokeStyle = SERIES.accent;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 60; i++) {
      const x = xMin + ((xMax - xMin) * i) / 60;
      const y = fit.a * x * x + fit.b * x + fit.c;
      if (y < yMin - 0.2 || y > yMax + 0.2) continue;
      const px = sx(x);
      const py = sy(y);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // sample markers + connecting line
  ctx.strokeStyle = SERIES.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  samples.forEach(([x, y], i) => {
    const px = sx(x);
    const py = sy(y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  for (const [x, y] of samples) {
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), 5, 0, Math.PI * 2);
    ctx.fillStyle = SERIES.accent;
    ctx.fill();
    ctx.strokeStyle = p.surface;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // recommended marker
  if (Number.isFinite(recommended)) {
    const px = sx(Math.min(xMax, Math.max(xMin, recommended)));
    ctx.strokeStyle = SERIES.track;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, pad.t);
    ctx.lineTo(px, h - pad.b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = SERIES.track;
    ctx.textAlign = px > w - 60 ? 'right' : 'left';
    ctx.fillText('rec', px + (px > w - 60 ? -6 : 6), pad.t + 12);
  }
}

/**
 * Radar of per-mode normalised accuracy, one polygon per sensitivity. Shows at a
 * glance whether a sensitivity helps one skill at the cost of another.
 */
export function drawRadar(canvas, { modeScores }) {
  const { ctx, w, h } = prepare(canvas, 250);
  const p = palette();
  const cx = w / 2;
  const cy = h / 2 + 6;
  const radius = Math.min(w, h) / 2 - 46;
  const modes = Object.keys(modeScores);

  if (modes.length < 1 || radius <= 20) return;

  const rings = 4;
  ctx.strokeStyle = p.grid;
  for (let r = 1; r <= rings; r++) {
    ctx.beginPath();
    for (let i = 0; i <= modes.length; i++) {
      const a = (Math.PI * 2 * i) / modes.length - Math.PI / 2;
      const rr = (radius * r) / rings;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // spokes + labels
  ctx.fillStyle = p.muted;
  ctx.textAlign = 'center';
  modes.forEach((mode, i) => {
    const a = (Math.PI * 2 * i) / modes.length - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.strokeStyle = p.grid;
    ctx.stroke();
    ctx.fillText(
      mode,
      cx + Math.cos(a) * (radius + 18),
      cy + Math.sin(a) * (radius + 18) + 4,
    );
  });

  const colors = [SERIES.muted, SERIES.accent, SERIES.track];
  modes[0] &&
    modeScores[modes[0]].forEach((_, seriesIndex) => {
      ctx.beginPath();
      modes.forEach((mode, i) => {
        const row = modeScores[mode][seriesIndex];
        const value = row ? row.score : 0;
        const a = (Math.PI * 2 * i) / modes.length - Math.PI / 2;
        const rr = radius * Math.max(0.02, Math.min(1, value));
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      const color = colors[seriesIndex % colors.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;
    });
}

/** Grouped bars: average reaction time per mode per sensitivity. */
export function drawReaction(canvas, { rounds }) {
  const { ctx, w, h } = prepare(canvas, 250);
  const p = palette();
  const pad = { l: 48, r: 16, t: 16, b: 38 };
  axesFrame(ctx, w, h, pad);

  const usable = rounds.filter((r) => Number.isFinite(r.avgReactionMs));
  if (!usable.length) {
    ctx.fillStyle = p.muted;
    ctx.textAlign = 'center';
    ctx.fillText('No reaction-time data (track mode does not record it)', w / 2, h / 2);
    return;
  }

  const mults = [...new Set(usable.map((r) => r.sensitivityMultiplier))].sort((a, b) => a - b);
  const modes = [...new Set(usable.map((r) => r.mode))];
  const maxMs = Math.max(...usable.map((r) => r.avgReactionMs)) * 1.15;
  const innerW = w - pad.l - pad.r;
  const groupW = innerW / mults.length;
  const barW = Math.min(26, (groupW - 12) / Math.max(1, modes.length));

  ctx.fillStyle = p.muted;
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = (maxMs * i) / 4;
    const y = h - pad.b - (v / maxMs) * (h - pad.t - pad.b);
    ctx.fillText(`${Math.round(v)}`, pad.l - 8, y + 4);
    ctx.strokeStyle = p.grid;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }

  mults.forEach((mult, mi) => {
    const groupX = pad.l + mi * groupW + 6;
    modes.forEach((mode, si) => {
      const bars = usable.filter((r) => r.sensitivityMultiplier === mult && r.mode === mode);
      if (!bars.length) return;
      const avg = bars.reduce((a, b) => a + b.avgReactionMs, 0) / bars.length;
      const barH = (avg / maxMs) * (h - pad.t - pad.b);
      const x = groupX + si * (barW + 3);
      const y = h - pad.b - barH;
      ctx.fillStyle = SERIES[mode] ?? SERIES.accent;
      ctx.fillRect(x, y, barW, barH);
    });
    ctx.fillStyle = p.muted;
    ctx.textAlign = 'center';
    ctx.fillText(`${mult}×`, groupX + (modes.length * (barW + 3)) / 2, h - pad.b + 16);
  });

  ctx.fillStyle = p.muted;
  ctx.fillText('ms', pad.l - 8, pad.t - 2);
}

/**
 * Diverging bars: overshoot (positive, past the target) vs undershoot
 * (negative, stopped short). Two colours make the direction obvious, which a
 * single average would hide.
 */
export function drawOvershoot(canvas, { rounds }) {
  const { ctx, w, h } = prepare(canvas, 250);
  const p = palette();
  const pad = { l: 48, r: 16, t: 24, b: 38 };
  axesFrame(ctx, w, h, pad);

  const usable = rounds.filter((r) => Number.isFinite(r.avgOvershootPx));
  if (!usable.length) {
    ctx.fillStyle = p.muted;
    ctx.textAlign = 'center';
    ctx.fillText('No overshoot data', w / 2, h / 2);
    return;
  }

  const mults = [...new Set(usable.map((r) => r.sensitivityMultiplier))].sort((a, b) => a - b);
  const modes = [...new Set(usable.map((r) => r.mode))];
  const maxPx = Math.max(1, ...usable.map((r) => r.avgOvershootPx)) * 1.15;
  const zeroY = h - pad.b - (0.5 * (h - pad.t - pad.b)); // centre line: 0 px
  const halfH = (h - pad.t - pad.b) / 2;
  const innerW = w - pad.l - pad.r;
  const groupW = innerW / mults.length;
  const barW = Math.min(26, (groupW - 12) / Math.max(1, modes.length));

  ctx.strokeStyle = p.grid;
  ctx.beginPath();
  ctx.moveTo(pad.l, zeroY);
  ctx.lineTo(w - pad.r, zeroY);
  ctx.stroke();

  ctx.fillStyle = p.muted;
  ctx.textAlign = 'right';
  ctx.fillText('0', pad.l - 8, zeroY + 4);
  ctx.fillText(`${Math.round(maxPx)}`, pad.l - 8, pad.t + 8);
  ctx.fillText(`-${Math.round(maxPx)}`, pad.l - 8, h - pad.b);

  mults.forEach((mult, mi) => {
    const groupX = pad.l + mi * groupW + 6;
    modes.forEach((mode, si) => {
      const bars = usable.filter((r) => r.sensitivityMultiplier === mult && r.mode === mode);
      if (!bars.length) return;
      const avg = bars.reduce((a, b) => a + b.avgOvershootPx, 0) / bars.length;
      const barH = (avg / maxPx) * halfH;
      const x = groupX + si * (barW + 3);
      // Positive = travelled past the target; the magenta/red side.
      ctx.fillStyle = SERIES[mode] ?? SERIES.accent;
      ctx.fillRect(x, zeroY - Math.max(0, barH), barW, Math.abs(barH));
    });
    ctx.fillStyle = p.muted;
    ctx.textAlign = 'center';
    ctx.fillText(`${mult}×`, groupX + (modes.length * (barW + 3)) / 2, h - pad.b + 16);
  });

  ctx.fillStyle = p.muted;
  ctx.textAlign = 'left';
  ctx.fillText('past target ↑', pad.l + 4, pad.t - 8);
}

/** Average on-target ratio per mode per sensitivity, as simple bars. */
export function drawOnTarget(canvas, { rounds }) {
  const { ctx, w, h } = prepare(canvas, 250);
  const p = palette();
  const pad = { l: 44, r: 16, t: 16, b: 38 };
  axesFrame(ctx, w, h, pad);

  const usable = rounds.filter((r) => Number.isFinite(r.onTargetRatio));
  if (!usable.length) {
    ctx.fillStyle = p.muted;
    ctx.textAlign = 'center';
    ctx.fillText('Only track mode reports on-target time', w / 2, h / 2);
    return;
  }

  const mults = [...new Set(usable.map((r) => r.sensitivityMultiplier))].sort((a, b) => a - b);
  const innerW = w - pad.l - pad.r;
  const groupW = innerW / mults.length;

  ctx.fillStyle = p.muted;
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = i / 4;
    const y = h - pad.b - v * (h - pad.t - pad.b);
    ctx.fillText(`${Math.round(v * 100)}%`, pad.l - 8, y + 4);
    ctx.strokeStyle = p.grid;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }

  mults.forEach((mult, mi) => {
    const bars = usable.filter((r) => r.sensitivityMultiplier === mult);
    const avg = bars.reduce((a, b) => a + b.onTargetRatio, 0) / bars.length;
    const barH = avg * (h - pad.t - pad.b);
    const bw = Math.min(48, groupW * 0.5);
    const x = pad.l + mi * groupW + (groupW - bw) / 2;
    ctx.fillStyle = SERIES.track;
    ctx.fillRect(x, h - pad.b - barH, bw, barH);
    ctx.fillStyle = p.muted;
    ctx.textAlign = 'center';
    ctx.fillText(`${mult}×`, pad.l + mi * groupW + groupW / 2, h - pad.b + 16);
  });
}
