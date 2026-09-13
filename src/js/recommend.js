/**
 * Recommendation engine.
 *
 * ── Why a sweep ──────────────────────────────────────────────────────────────
 * You cannot recommend a sensitivity from a single test: you have no evidence
 * about what a *different* sensitivity would have scored. So the session tests
 * three multipliers — 0.5×, 1.0× and 2.0× of the user's current setting — and
 * compares the same player against themselves. The measurement is relative, not
 * absolute, so it needs no population baseline.
 *
 * ── How a sensitivity is scored ──────────────────────────────────────────────
 * Each mode produces metrics on different scales, so each is normalised to 0..1
 * against fixed reference points and then combined:
 *
 *   flick  : 70% accuracy + 18% speed + 12% precision
 *   track  : 60% time-on-target + 40% steadiness (inverse mean deviation)
 *   micro  : 70% accuracy + 30% precision
 *
 * Overshoot enters as a penalty, not a bonus: both over- and under-shooting mean
 * the sensitivity does not match the player's motor range. The goal is
 * "arrives on target", not "stops short" or "flies past".
 *
 * ── From scores to a number ─────────────────────────────────────────────────
 * Three (multiplier, score) points are fitted by least squares to
 * y = a·x² + b·x + c. A downward parabola has a peak, and that peak is the
 * recommendation. When the fit is not downward, or the peak lies outside the
 * tested range, or all three scores are nearly identical, a clearly-labelled
 * fallback is used instead and the confidence is reported as low or none.
 */

import { quadraticFit, quadraticPeak } from './sensitivity.js';

export const SWEEP_MULTIPLIERS = [0.5, 1, 2];

/**
 * Reference scales for normalisation.
 *
 * CALIBRATION — these are not arbitrary. An earlier set (deviationGood 0.01,
 * overshootGood 0.005) capped the achievable score at 0.60 for tracking, which
 * made the top of the scale dead: a strong run and a perfect run scored the
 * same. The values below were chosen by measuring what the modes actually
 * produce, so each mode can reach at least ~0.85 and still separates a weak run
 * from a strong one.
 */
export const REF = {
  reactionGoodMs: 450,
  reactionBadMs: 1100,
  deviationGoodRatio: 0.05,
  deviationBadRatio: 0.25,
  overshootGoodRatio: 0.02,
  overshootBadRatio: 0.10,
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Normalise a metric where LARGER is BETTER: `good` scores 1, worse than `bad`
 * scores 0.
 */
function lerpScore(value, good, bad) {
  if (!Number.isFinite(value)) return 0;
  return clamp01((bad - value) / (bad - good));
}

/**
 * Normalise a metric where SMALLER is BETTER (overshoot, deviation, reaction
 * time): at or below `good` scores 1, at or above `bad` scores 0.
 *
 * Kept as its own function because the direction is easy to get wrong twice
 * over. Two earlier versions were both wrong and both failed silently:
 *   1. `1 - lerpScore(...)` — lerpScore already maps the good end to 1, so this
 *      inverted the term.
 *   2. `(value - good) / (bad - good)` — returns 1 for the WORST value, which
 *      contradicts this function's own name.
 * Both bugs were invisible in the totals, because an inverted term just
 * contributed ~0 and looked like a tolerance-calibration problem. The regression
 * test asserts direction on every metric now.
 */
function lowerIsBetter(value, good, bad) {
  if (!Number.isFinite(value)) return 0;
  return clamp01((bad - value) / (bad - good));
}

/** Per-mode score in 0..1 from a round's metrics. */
export function scoreRound(metrics) {
  switch (metrics.mode) {
    case 'flick': {
      const speed = lowerIsBetter(metrics.avgReactionMs, REF.reactionGoodMs, REF.reactionBadMs);
      const precision = lowerIsBetter(
        metrics.overshootRatio,
        REF.overshootGoodRatio,
        REF.overshootBadRatio,
      );
      return clamp01(0.7 * metrics.accuracy + 0.18 * speed + 0.12 * precision);
    }
    case 'track': {
      const steady = lowerIsBetter(
        metrics.deviationRatio,
        REF.deviationGoodRatio,
        REF.deviationBadRatio,
      );
      const onTarget = Number.isFinite(metrics.onTargetRatio) ? metrics.onTargetRatio : 0;
      return clamp01(0.6 * onTarget + 0.4 * steady);
    }
    case 'micro': {
      const precision = lowerIsBetter(
        metrics.overshootRatio,
        REF.overshootGoodRatio,
        REF.overshootBadRatio,
      );
      return clamp01(0.7 * metrics.accuracy + 0.3 * precision);
    }
    default:
      return 0;
  }
}

/** Mean score across a cell's rounds. */
export function scoreCell(rounds) {
  if (rounds.length === 0) return { score: 0, rounds: 0 };
  const total = rounds.reduce((acc, r) => acc + scoreRound(r), 0);
  return { score: total / rounds.length, rounds: rounds.length };
}

/**
 * Aggregate a completed session.
 *
 * @param {{ rounds: Array }} session rounds carry `mode` and `sensitivityMultiplier`
 */
export function recommend(session) {
  const cells = new Map();
  const modesSeen = new Set();

  for (const r of session.rounds) {
    modesSeen.add(r.mode);
    const key = `${r.mode}@${r.sensitivityMultiplier}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(r);
  }

  // A multiplier is good only if the player did well with it in every mode.
  const byMultiplier = new Map();
  const perMode = new Map();
  for (const [key, rounds] of cells) {
    const sep = key.lastIndexOf('@');
    const mode = key.slice(0, sep);
    const mult = Number(key.slice(sep + 1));
    const { score, rounds: n } = scoreCell(rounds);
    if (!byMultiplier.has(mult)) byMultiplier.set(mult, []);
    byMultiplier.get(mult).push(score);
    if (!perMode.has(mode)) perMode.set(mode, []);
    perMode.get(mode).push({ multiplier: mult, score, rounds: n });
  }

  const samples = [...byMultiplier.entries()]
    .map(([mult, scores]) => [mult, scores.reduce((a, b) => a + b, 0) / scores.length])
    .sort((a, b) => a[0] - b[0]);

  const modeScores = Object.fromEntries(
    [...perMode.entries()].map(([mode, rows]) => [
      mode,
      rows.sort((a, b) => a.multiplier - b.multiplier),
    ]),
  );

  const observedBest = samples.length
    ? samples.reduce((best, cur) => (cur[1] > best[1] ? cur : best), samples[0])
    : [1, 0];

  const spread =
    samples.length > 1
      ? Math.max(...samples.map((s) => s[1])) - Math.min(...samples.map((s) => s[1]))
      : 0;
  // If all three multipliers land within a hair of each other, the honest answer
  // is "keep what you have" — any precise number would be noise.
  const flat = samples.length >= 3 && spread < 0.06;

  const fit = quadraticFit(samples);
  const peak = quadraticPeak(
    fit,
    SWEEP_MULTIPLIERS[0],
    SWEEP_MULTIPLIERS[SWEEP_MULTIPLIERS.length - 1],
  );

  let multiplier;
  let confidence;
  let method;

  if (flat) {
    multiplier = 1;
    confidence = 'none';
    method = 'flat';
  } else if (peak && !peak.atBoundary) {
    multiplier = peak.vertex;
    confidence = samples.length >= 3 ? 'high' : 'medium';
    method = 'parabola';
  } else if (peak && peak.atBoundary) {
    multiplier = peak.vertex;
    confidence = 'low';
    method = 'edge';
  } else {
    multiplier = observedBest[0];
    confidence = 'low';
    method = 'observed-best';
  }

  multiplier = Math.min(4, Math.max(0.25, multiplier));
  const rounded = Math.round(multiplier * 100) / 100;

  return {
    method,
    confidence,
    spread,
    samples,
    modeScores,
    fit,
    observedBest: { multiplier: observedBest[0], score: observedBest[1] },
    multiplier: rounded,
    explanation: explain({ method, confidence, samples, spread, rounded }),
    modesTested: [...modesSeen],
  };
}

function explain({ method, confidence, samples, spread, rounded }) {
  const list = samples.map(([m, s]) => `${m}× → ${(s * 100).toFixed(0)}/100`).join(', ');
  const pct = `${rounded >= 1 ? '+' : ''}${Math.round((rounded - 1) * 100)}%`;

  const head = {
    flat: `All three sensitivities scored within ${(spread * 100).toFixed(1)} points of each other (${list}), so the data does not justify a change. Keep your current setting.`,
    parabola: `Your scores fitted a downward curve (${list}), and the peak of that curve sits at ${rounded}× your current sensitivity — about ${pct}.`,
    edge: `Your best score was at the edge of the tested range (${list}), with the curve still rising at ${rounded}× — beyond what was tested. Lower your in-game sensitivity and run the sweep again to explore further.`,
    'observed-best': `The curve fit was not reliable with these samples, so the recommendation is the best score actually observed (${list}) at ${rounded}×.`,
  }[method];

  const caveat = {
    high: 'Confidence: high — three distinct points with a clear peak inside the tested range.',
    medium: 'Confidence: medium — based on fewer than three distinct sensitivities.',
    none: 'Confidence: none — read this as "no change needed", not as a measurement.',
    low: 'Confidence: low — the recommendation sits at or beyond the edge of what was tested.',
  }[confidence];

  return { head, caveat, summary: `${rounded}× (${pct})` };
}

/**
 * Turn the multiplier into concrete numbers for the report.
 *
 * A *higher* multiplier means a faster crosshair, which means *fewer* cm per
 * 360° turn — hence the division.
 */
export function applyRecommendation(rec, settings, currentCm360, game) {
  const multiplier = rec.multiplier || 1;
  return {
    multiplier,
    currentCm360,
    recommendedCm360: currentCm360 / multiplier,
    currentSensitivity: settings.sensitivity,
    recommendedSensitivity: settings.sensitivity > 0 ? settings.sensitivity * multiplier : NaN,
    recommendedEdpi: settings.sensitivity > 0 ? settings.dpi * settings.sensitivity * multiplier : NaN,
    currentEdpi: settings.sensitivity > 0 ? settings.dpi * settings.sensitivity : NaN,
    gameLabel: game.label,
    gameVerified: game.verified,
  };
}
