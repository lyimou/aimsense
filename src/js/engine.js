/**
 * Aim test engine.
 *
 * Owns the canvas, the animation loop, pointer lock, and metrics collection.
 * Each test mode is a small strategy object ({ setup, update, draw }) so the
 * three modes share one loop instead of duplicating it.
 *
 * Robustness rules baked in here:
 *  - pointer lock loss pauses the round (no unfair misses while the cursor escapes)
 *  - window blur / tab hide pauses
 *  - rounds have a hard time limit so a round can never hang
 *  - every listener is torn down in destroy()
 */

import { t } from './i18n.js';

const ROUND_MS = 30000; // hard cap per round
const TARGETS_PER_ROUND = 10;
const TARGET_EXPIRY_MS = 4000; // a flick target that is never clicked expires

/**
 * Test modes.
 *
 * `labelKey` / `blurbKey` are i18n keys, not text: the engine drives a canvas
 * and has no business knowing which language the page is in. The canvas labels
 * are resolved through `t()` at draw time so they follow the toggle.
 */
export const MODES = {
  flick: {
    id: 'flick',
    labelKey: 'test.mode.flick',
    instructionsKey: 'test.mode.flick.desc',
  },
  track: {
    id: 'track',
    labelKey: 'test.mode.track',
    instructionsKey: 'test.mode.track.desc',
  },
  micro: {
    id: 'micro',
    labelKey: 'test.mode.micro',
    instructionsKey: 'test.mode.micro.desc',
  },
};

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export class TestEngine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ onRoundEnd: Function, onComplete: Function, onStateChange?: Function }} hooks
   */
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;

    // Sensitivity: how many canvas px the crosshair moves per mouse count.
    this.sensitivityMultiplier = 1;
    this.basePxPerCount = 0.35;

    this.crosshair = { x: 0, y: 0 };
    this.mouseDown = false;
    this.locked = false;
    this.paused = false;
    this.running = false;

    this.mode = null;
    this.strategy = null;
    this.roundIndex = 0;
    this.rounds = 3;

    this.targets = [];
    this.round = null;
    this.rafId = 0;
    this.lastFrame = 0;

    this._bind();
    this._resize();
  }

  /* ----------------------------- lifecycle ------------------------------- */

  _bind() {
    this.onMove = (e) => this._handleMove(e);
    this.onDown = (e) => this._handleDown(e);
    this.onUp = () => {
      this.mouseDown = false;
    };
    this.onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.running) this.pause('pointer-lock-lost');
      this._emitState();
    };
    this.onBlur = () => {
      if (this.running) this.pause('window-blur');
    };
    this.onVisibility = () => {
      if (document.hidden && this.running) this.pause('tab-hidden');
    };
    this.onContextMenu = (e) => e.preventDefault();
    this.onResize = () => this._resize();

    this.canvas.addEventListener('mousedown', this.onDown);
    window.addEventListener('mouseup', this.onUp);
    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockChange);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('resize', this.onResize);
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mouseup', this.onUp);
    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockChange);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('resize', this.onResize);
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = Math.max(320, Math.round(rect.width));
    this.height = Math.max(240, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.crosshair.x = clamp(this.crosshair.x || this.width / 2, 0, this.width);
    this.crosshair.y = clamp(this.crosshair.y || this.height / 2, 0, this.height);
    if (this.strategy?.onResize) this.strategy.onResize(this);
  }

  /* ------------------------------- input -------------------------------- */

  _handleMove(e) {
    if (!this.running || this.paused || !this.locked) return;
    const px = this.basePxPerCount * this.sensitivityMultiplier;
    // movementX/Y is raw mouse delta; scale it by the sensitivity under test.
    this.crosshair.x = clamp(this.crosshair.x + e.movementX * px, 0, this.width);
    this.crosshair.y = clamp(this.crosshair.y + e.movementY * px, 0, this.height);
  }

  _handleDown(e) {
    if (e.button !== 0) return;
    this.mouseDown = true;
    if (!this.running) return;
    if (!this.locked) {
      // Ask for pointer lock on first click; the round starts once granted.
      this.canvas.requestPointerLock?.();
      return;
    }
    if (this.paused) {
      this.resume();
      return;
    }
    this.strategy?.onClick?.(this);
  }

  /* ------------------------------- control ------------------------------ */

  /** Start a full session of `rounds` rounds in the given mode. */
  start(modeId, { rounds = 3, sensitivityMultiplier = 1 } = {}) {
    if (!MODES[modeId]) throw new Error(`unknown mode: ${modeId}`);
    this.mode = modeId;
    this.strategy = createStrategy(modeId);
    this.sensitivityMultiplier = clamp(sensitivityMultiplier, 0.05, 20);
    this.rounds = rounds;
    this.roundIndex = 0;
    this.session = {
      mode: modeId,
      rounds: [],
      sensitivityMultiplier: this.sensitivityMultiplier,
    };
    this.running = true;
    this.paused = false;
    this.crosshair.x = this.width / 2;
    this.crosshair.y = this.height / 2;

    /*
     * Returns a promise that settles when this mode's rounds finish. The
     * animation loop drives the rounds, so a caller can `await` a whole mode and
     * then start the next one — which is what makes a multi-step sweep a plain
     * for-loop instead of a callback pyramid.
     */
    const done = new Promise((resolve) => {
      this._resolveSession = resolve;
    });

    this._beginRound();
    this.lastFrame = 0;
    this._loop(performance.now());
    this._emitState();
    return done;
  }

  _beginRound() {
    this.round = {
      index: this.roundIndex,
      // Carried onto the round so summarize() can emit them: the scorer groups
      // metrics by mode and multiplier, and reads them from the metrics object.
      mode: this.mode,
      sensitivityMultiplier: this.sensitivityMultiplier,
      startedAt: performance.now(),
      elapsed: 0,
      targetsSpawned: 0,
      hits: 0,
      misses: 0,
      reactionTimes: [],
      /*
       * One entry per resolved target: the distance in px from the crosshair to
       * the target CENTRE at the moment the target was resolved (clicked, or
       * expired). Plain numbers, like `reactionTimes`.
       *
       * This replaced an "overshoot" array that stored `max(0, d - r)`. That
       * value is the distance to the target EDGE and carries no sign, so it
       * could not tell "flew past" from "stopped short" — and because it was
       * floored at zero, stopping short recorded a perfect 0 and scored full
       * marks on precision. Radial error does not need a sign to fix that: it
       * is distance from the centre in every direction, so over- and
       * under-shooting cost exactly the same.
       */
      radialErrors: [],
      // track-mode accumulators
      deviationSum: 0,
      deviationMax: 0,
      samples: 0,
      onTargetSamples: 0,
    };
    this.targets = [];
    this.accumulatedMs = 0;
    this.pausedAt = 0;
    this.strategy.setup(this);
    this.hooks.onStateChange?.(this.getState());
  }

  _endRound(reason) {
    const r = this.round;
    if (!r) return;
    r.endedAt = performance.now();
    r.reason = reason;
    r.durationMs = r.elapsed;
    const metrics = summarize(r, this.strategy, this.width, this.height);
    this.session.rounds.push(metrics);
    this.hooks.onRoundEnd?.(metrics, this.session);

    this.round = null;
    this.roundIndex++;
    if (this.roundIndex >= this.rounds) {
      this.running = false;
      cancelAnimationFrame(this.rafId);
      this._exitLock();
      this.hooks.onComplete?.(this.session);
      this._resolveSession?.(this.session);
      this._resolveSession = null;
    } else if (reason === 'completed') {
      this._beginRound();
    } else {
      // Aborted or timed out mid-session: stop rather than continuing into a
      // round the player did not start.
      this.running = false;
      cancelAnimationFrame(this.rafId);
      this._exitLock();
      this.hooks.onComplete?.(this.session);
      this._resolveSession?.(this.session);
      this._resolveSession = null;
    }
    this._emitState();
  }

  pause(reason = 'manual') {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.pauseReason = reason;
    this.pausedAt = performance.now();
    this._emitState();
  }

  resume() {
    if (!this.running || !this.paused) return;
    const delta = performance.now() - this.pausedAt;
    this.round.elapsedPaused = (this.round.elapsedPaused || 0) + delta;
    this.paused = false;
    this.pauseReason = null;
    // Re-acquire the pointer so movement resumes working.
    if (!this.locked) this.canvas.requestPointerLock?.();
    this._emitState();
  }

  /**
   * Abort the current session. Unlike stop(), this marks the round as aborted
   * and discards it, so a partially-played round can never be scored.
   */
  abort() {
    if (!this.running) return;
    const round = this.round;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this._exitLock();
    // Discard the in-flight round: no endRound, no metrics.
    void round;
    this.round = null;
    this.hooks.onAbort?.();
    this._resolveSession?.(this.session);
    this._resolveSession = null;
    this._emitState();
  }

  stop() {
    this.running = false;
    this.paused = false;
    cancelAnimationFrame(this.rafId);
    this._exitLock();
    // Settle any awaiter so a caller awaiting this mode is never left hanging.
    this._resolveSession?.(this.session);
    this._resolveSession = null;
    this._emitState();
  }

  _exitLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }

  getState() {
    return {
      running: this.running,
      paused: this.paused,
      pauseReason: this.pauseReason ?? null,
      locked: this.locked,
      mode: this.mode,
      multiplier: this.sensitivityMultiplier,
      roundIndex: this.roundIndex,
      rounds: this.rounds,
      remainingMs: this.round ? Math.max(0, ROUND_MS - (this.round.elapsed || 0)) : 0,
      targetsLeft: this.strategy?.targetsLeft?.(this) ?? 0,
      hits: this.round?.hits ?? 0,
      misses: this.round?.misses ?? 0,
    };
  }

  _emitState() {
    this.hooks.onStateChange?.(this.getState());
  }

  /* -------------------------------- loop -------------------------------- */

  _loop(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame((t) => this._loop(t));

    const dt = Math.min(64, now - (this.lastFrame || now));
    this.lastFrame = now;

    if (this.round && !this.paused) {
      this.round.elapsed = now - this.round.startedAt - (this.round.elapsedPaused || 0);
      this.strategy.update(this, dt);
      if (this.round.elapsed >= ROUND_MS) {
        this._endRound('timeout');
        return;
      }
    }

    this._draw();
    this._emitState();
  }

  /* ------------------------------- drawing ------------------------------ */

  _draw() {
    const { ctx, width: w, height: h } = this;
    ctx.clearRect(0, 0, w, h);

    // Subtle grid so movement is perceivable and the canvas reads as a play area.
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';
    ctx.lineWidth = 1;
    const step = 48;
    for (let x = step; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = step; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();

    this.strategy?.draw?.(this, ctx);

    // Crosshair on top of everything.
    const { x, y } = this.crosshair;
    ctx.save();
    ctx.strokeStyle = this.paused ? 'rgba(148,163,184,0.5)' : '#22d3ee';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 12, y);
    ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + 12, y);
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x, y + 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = this.paused ? 'rgba(148,163,184,0.5)' : '#22d3ee';
    ctx.fill();
    ctx.restore();

    if (this.paused) {
      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.fillText(pauseMessage(this.pauseReason), w / 2, h / 2 - 8);
      ctx.font = '400 14px system-ui, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(t('test.pause.resume'), w / 2, h / 2 + 20);
      ctx.restore();
    }
  }
}

function pauseMessage(reason) {
  switch (reason) {
    case 'pointer-lock-lost':
      return t('test.pause.pointerLock');
    case 'window-blur':
      return t('test.pause.blur');
    case 'tab-hidden':
      return t('test.pause.hidden');
    default:
      return t('test.pause.generic');
  }
}

/* ------------------------------ strategies ------------------------------ */

/** Distance from point p to segment ab, plus the projection parameter t. */
export function distToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return { dist: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = clamp(t, 0, 1);
  const cx = a.x + t * vx;
  const cy = a.y + t * vy;
  return { dist: Math.hypot(p.x - cx, p.y - cy), t };
}

function spawnTarget(engine, radius, margin = 48) {
  const w = engine.width;
  const h = engine.height;
  return {
    x: margin + Math.random() * Math.max(1, w - margin * 2),
    y: margin + Math.random() * Math.max(1, h - margin * 2),
    r: radius,
    spawnedAt: performance.now(),
    // closest the crosshair came to the target centre during this target's life
    closest: Infinity,
  };
}

function createStrategy(modeId) {
  if (modeId === 'flick') return flickStrategy();
  if (modeId === 'track') return trackStrategy();
  return microStrategy();
}

/** Flick: targets appear one at a time; click to shoot. */
function flickStrategy() {
  return {
    setup(engine) {
      engine.targets = [spawnTarget(engine, 26)];
      engine.round.targetsSpawned = 1;
    },
    targetsLeft(engine) {
      return Math.max(0, TARGETS_PER_ROUND - engine.round.hits - engine.round.misses);
    },
    update(engine, dt) {
      const t = engine.targets[0];
      if (!t) return;
      t.age = (t.age ?? 0) + dt;
      const d = Math.hypot(engine.crosshair.x - t.x, engine.crosshair.y - t.y);
      t.closest = Math.min(t.closest, d);
      if (t.age > TARGET_EXPIRY_MS) {
        // Target expired without a click: count as a miss, measured at the
        // closest the crosshair ever got.
        engine.round.misses++;
        resolveTarget(engine, t, t.closest, TARGET_EXPIRY_MS);
        nextTarget(engine);
      }
    },
    onClick(engine) {
      const t = engine.targets[0];
      if (!t) return;
      const d = Math.hypot(engine.crosshair.x - t.x, engine.crosshair.y - t.y);
      const reaction = performance.now() - t.spawnedAt;
      if (d <= t.r) {
        engine.round.hits++;
      } else {
        engine.round.misses++;
      }
      resolveTarget(engine, t, d, reaction);
      nextTarget(engine);
    },
    draw(engine, ctx) {
      for (const t of engine.targets) drawTarget(ctx, t, '#f43f5e');
    },
  };
}

/**
 * Record one resolved target.
 *
 * Both arrays get an entry for EVERY resolved target — hit or miss — because
 * `summarize` averages them and an average that silently drops the failures
 * misreports the round. An earlier version pushed reaction times only in the
 * hit branch, so a player who missed slowly was scored on their fast hits and
 * the speed term rewarded missing.
 *
 * @param {number} errorPx distance in px from the crosshair to the target centre
 * @param {number} reactionMs time from spawn to resolution
 */
function resolveTarget(engine, target, errorPx, reactionMs) {
  if (Number.isFinite(errorPx)) engine.round.radialErrors.push(errorPx);
  if (Number.isFinite(reactionMs)) engine.round.reactionTimes.push(reactionMs);
}

function nextTarget(engine) {
  const done = engine.round.hits + engine.round.misses >= TARGETS_PER_ROUND;
  if (done) {
    engine._endRound('completed');
    return;
  }
  engine.targets = [spawnTarget(engine, 26)];
  engine.round.targetsSpawned++;
}

/** Track: a target follows a smooth wander path; hold the button to follow it. */
function trackStrategy() {
  return {
    setup(engine) {
      const t = spawnTarget(engine, 30, 90);
      t.vx = (Math.random() * 2 - 1) * 0.18;
      t.vy = (Math.random() * 2 - 1) * 0.18;
      t.phase = Math.random() * Math.PI * 2;
      engine.targets = [t];
      engine.round.targetsSpawned = 1;
    },
    targetsLeft(engine) {
      return Math.max(0, TARGETS_PER_ROUND - engine.round.hits);
    },
    update(engine, dt) {
      const t = engine.targets[0];
      if (!t) return;
      // Smooth wandering: drift plus a slow perpendicular wobble.
      t.phase += dt * 0.0011;
      const speed = 0.22 * (dt / 16.67);
      t.x += t.vx * dt * 0.06 + Math.cos(t.phase) * speed;
      t.y += t.vy * dt * 0.06 + Math.sin(t.phase * 1.3) * speed;
      const m = t.r;
      if (t.x < m || t.x > engine.width - m) {
        t.vx *= -1;
        t.x = clamp(t.x, m, engine.width - m);
      }
      if (t.y < m || t.y > engine.height - m) {
        t.vy *= -1;
        t.y = clamp(t.y, m, engine.height - m);
      }

      // Sample deviation from the centre, normalised by the radius.
      const d = Math.hypot(engine.crosshair.x - t.x, engine.crosshair.y - t.y);
      engine.round.samples++;
      engine.round.deviationSum += d;
      engine.round.deviationMax = Math.max(engine.round.deviationMax, d);
      if (d <= t.r) engine.round.onTargetSamples++;

      // A "hit" accrues while the crosshair stays inside; 10 such ticks ends the round.
      if (d <= t.r) {
        engine.round.trackHold = (engine.round.trackHold ?? 0) + dt;
        if (engine.round.trackHold >= 800) {
          engine.round.trackHold = 0;
          engine.round.hits++;
          if (engine.round.hits >= TARGETS_PER_ROUND) {
            engine._endRound('completed');
            return;
          }
        }
      } else {
        engine.round.trackHold = 0;
      }
    },
    draw(engine, ctx) {
      for (const t of engine.targets) drawTarget(ctx, t, '#34d399', true);
      // Live deviation readout, normalised so it reads as a percentage of radius.
      const t = engine.targets[0];
      if (t && engine.round?.samples > 0) {
        const avg = engine.round.deviationSum / engine.round.samples;
        ctx.save();
        ctx.font = '500 13px system-ui, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'left';
        ctx.fillText(t('test.avgDeviation', { pct: (avg / t.r * 100).toFixed(0) }), 16, 24);
        ctx.restore();
      }
    },
  };
}

/** Micro-adjust: the target barely moves; precision over speed. */
function microStrategy() {
  return {
    setup(engine) {
      engine.targets = [spawnTarget(engine, 16)];
      engine.round.targetsSpawned = 1;
    },
    targetsLeft(engine) {
      return Math.max(0, TARGETS_PER_ROUND - engine.round.hits - engine.round.misses);
    },
    update(engine) {
      const t = engine.targets[0];
      if (!t) return;
      const d = Math.hypot(engine.crosshair.x - t.x, engine.crosshair.y - t.y);
      t.closest = Math.min(t.closest, d);
    },
    onClick(engine) {
      const t = engine.targets[0];
      if (!t) return;
      const d = Math.hypot(engine.crosshair.x - t.x, engine.crosshair.y - t.y);
      if (d <= t.r) {
        engine.round.hits++;
      } else {
        engine.round.misses++;
      }
      resolveTarget(engine, t, d, performance.now() - t.spawnedAt);

      const done = engine.round.hits + engine.round.misses >= TARGETS_PER_ROUND;
      if (done) {
        engine._endRound('completed');
        return;
      }
      // A small, bounded nudge — the point is that the correction is tiny.
      const nt = spawnTarget(engine, 16);
      nt.x = clamp(t.x + (Math.random() * 2 - 1) * 24, 40, engine.width - 40);
      nt.y = clamp(t.y + (Math.random() * 2 - 1) * 24, 40, engine.height - 40);
      engine.targets = [nt];
      engine.round.targetsSpawned++;
    },
    draw(engine, ctx) {
      for (const t of engine.targets) drawTarget(ctx, t, '#a78bfa');
    },
  };
}

function drawTarget(ctx, t, color, ring = false) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
  ctx.fillStyle = color + '33';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(t.x, t.y, Math.max(2, t.r * 0.18), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (ring) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = color + '55';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------- summary -------------------------------- */

/** Turn a raw round into the metrics the report and recommendation use. */
export function summarize(round, strategy, width, height) {
  const attempts = round.hits + round.misses;
  /*
   * Accuracy is only defined where a round is a series of discrete attempts.
   * Track mode has no misses — it accumulates hold time — so hits/hits would
   * always read 100%. Reporting NaN is what lets the report render an em dash
   * instead of a meaningless perfect score.
   */
  const accuracy = round.mode === 'track' ? NaN : attempts > 0 ? round.hits / attempts : 0;

  const errors = round.radialErrors ?? [];
  const diag = Math.hypot(width, height);
  const validErrors = errors.filter((e) => Number.isFinite(e));
  const avgRadialError =
    validErrors.length > 0 ? validErrors.reduce((a, b) => a + b, 0) / validErrors.length : 0;

  const reactions = round.reactionTimes ?? [];
  const validReactions = reactions.filter((r) => Number.isFinite(r));
  const avgReaction =
    validReactions.length > 0
      ? validReactions.reduce((a, b) => a + b, 0) / validReactions.length
      : NaN;

  const samples = round.samples ?? 0;
  const avgDeviation = samples > 0 ? round.deviationSum / samples : NaN;
  const onTargetRatio = samples > 0 ? round.onTargetSamples / samples : NaN;

  return {
    index: round.index,
    mode: round.mode,
    sensitivityMultiplier: round.sensitivityMultiplier,
    reason: round.reason,
    durationMs: round.durationMs,
    attempts,
    hits: round.hits,
    misses: round.misses,
    accuracy,
    avgReactionMs: avgReaction,
    // Mean distance from the target centre, in px and as a fraction of the
    // canvas diagonal so the score is resolution independent.
    avgRadialErrorPx: avgRadialError,
    radialErrorRatio: diag > 0 ? avgRadialError / diag : 0,
    radialErrorSamples: validErrors.length,
    avgDeviationPx: avgDeviation,
    deviationRatio: Number.isFinite(avgDeviation) && diag > 0 ? avgDeviation / diag : NaN,
    onTargetRatio,
    maxDeviationPx: round.deviationMax,
  };
}

export { ROUND_MS, TARGETS_PER_ROUND };
