#!/usr/bin/env node
/**
 * Regression tests for the metric pipeline.
 *
 * These exist because `test-recommend.mjs` only ever passes `overshootRatio`
 * straight into `scoreRound`. That tests the scoring FORMULA in isolation and
 * cannot see what the engine actually feeds it — which is how a metric that
 * could never go negative survived a suite that asserted its direction.
 *
 * So these tests drive `summarize()` with realistic round objects, exactly as
 * the engine builds them, and assert the properties the UI and docs promise:
 *
 *   1. under-shooting is penalised, not rewarded
 *   2. reaction time reflects every attempt, not only the successful ones
 *   3. track mode records no reaction time
 *   4. the precision metric is bounded and finite in every mode
 *
 * Run: node scripts/test-metrics.mjs
 */

import { summarize, MODES, TARGETS_PER_ROUND } from '../src/js/engine.js';
import { scoreRound, REF } from '../src/js/recommend.js';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const W = 900;
const H = 600;
const DIAG = Math.hypot(W, H);

/** A round object shaped exactly like engine.js's internal `round`. */
function round(over = {}) {
  return {
    index: 0,
    mode: 'flick',
    sensitivityMultiplier: 1,
    startedAt: 0,
    elapsed: 5000,
    durationMs: 5000,
    reason: 'completed',
    targetsSpawned: TARGETS_PER_ROUND,
    hits: 0,
    misses: 0,
    reactionTimes: [],
    radialErrors: [],
    deviationSum: 0,
    deviationMax: 0,
    samples: 0,
    onTargetSamples: 0,
    ...over,
  };
}

/**
 * `radialErrors` holds plain px distances, exactly as `resolveTarget` pushes
 * them, so a fixture is just an array of numbers. `errorsOf(n, px)` builds one.
 */
const errorsOf = (count, px) => Array(count).fill(px);

/** A round whose every target resolved at a fixed distance from the centre. */
const atError = (errorPx, over = {}) =>
  summarize(
    round({
      hits: 10,
      reactionTimes: Array(10).fill(500),
      radialErrors: errorsOf(10, errorPx),
      ...over,
    }),
    null, W, H,
  );

console.log('\nmetric pipeline\n' + '='.repeat(60));

/* ── 1. precision must penalise BOTH directions ---------------------------- */
{
  const dead = atError(0);
  const edge = atError(26);
  const under = summarize(
    round({ hits: 0, misses: 10, reactionTimes: Array(10).fill(500), radialErrors: errorsOf(10, 52) }),
    null, W, H,
  );
  const over = summarize(
    round({ hits: 0, misses: 10, reactionTimes: Array(10).fill(500), radialErrors: errorsOf(10, W) }),
    null, W, H,
  );

  const sDead = scoreRound(dead);
  const sEdge = scoreRound(edge);
  const sUnder = scoreRound(under);
  const sOver = scoreRound(over);

  ok('dead-centre scores better than edge', sDead > sEdge, `${sDead.toFixed(4)} vs ${sEdge.toFixed(4)}`);
  ok('stopping short is penalised vs a dead-centre hit', sUnder < sDead, `${sUnder.toFixed(4)} vs ${sDead.toFixed(4)}`);
  ok('flying past is penalised vs a dead-centre hit', sOver < sDead, `${sOver.toFixed(4)} vs ${sDead.toFixed(4)}`);
  ok('both error directions are penalised (the documented contract)', sUnder < sDead && sOver < sDead);
  ok('an undershoot by a full radius is penalised, not free', under.radialErrorRatio > 0 && sUnder < sEdge,
    `ratio=${under.radialErrorRatio.toFixed(4)} score=${sUnder.toFixed(4)} vs edge ${sEdge.toFixed(4)}`);

  // Precision must degrade monotonically with error, across the whole window.
  const ladder = [0, 13, 26, 52, 108, 300].map((px) =>
    scoreRound(summarize(round({ hits: 10, radialErrors: errorsOf(10, px) }), null, W, H)),
  );
  ok('precision degrades monotonically as error grows',
    ladder.every((v, i) => i === 0 || v <= ladder[i - 1] + 1e-9),
    ladder.map((v) => v.toFixed(3)).join(' >= '));
  ok('the precision term actually spans a useful range',
    ladder[0] - ladder[ladder.length - 1] > 0.05,
    `${ladder[0].toFixed(3)} .. ${ladder[ladder.length - 1].toFixed(3)}`);

  // The specific regression this file exists for: undershooting used to be
  // scored as perfect precision while overshooting was punished, because the
  // metric was `max(0, d - r)` — floored at zero, so stopping short recorded a
  // perfect 0. Guard that directly.
  ok('regression: a stopped-short miss no longer records a perfect zero',
    under.radialErrorRatio > 0,
    `ratio=${under.radialErrorRatio.toFixed(4)}`);
  ok('regression: undershoot no longer outscores a dead-centre hit',
    sUnder <= sDead, `under=${sUnder.toFixed(4)} dead=${sDead.toFixed(4)}`);
}

/* ── 2. reaction time covers every attempt --------------------------------- */
{
  // 8 quick hits, 2 slow misses. The misses took 4 s each.
  const m = summarize(
    round({
      hits: 8,
      misses: 2,
      reactionTimes: [300, 300, 300, 300, 300, 300, 300, 300, 4000, 4000],
      radialErrors: [...errorsOf(8, 0), ...errorsOf(2, 600)],
    }),
    null, W, H,
  );
  const expected = (300 * 8 + 4000 * 2) / 10;
  ok('avgReactionMs includes misses', Math.abs(m.avgReactionMs - expected) < 1e-6,
    `got ${m.avgReactionMs}, expected ${expected}`);

  const slowMiss = summarize(
    round({ hits: 10, reactionTimes: Array(10).fill(4000), radialErrors: errorsOf(10, 0) }),
    null, W, H,
  );
  const fastHit = summarize(
    round({ hits: 10, reactionTimes: Array(10).fill(300), radialErrors: errorsOf(10, 0) }),
    null, W, H,
  );
  ok('a slow round scores below a fast round with equal accuracy',
    scoreRound(slowMiss) < scoreRound(fastHit),
    `${scoreRound(slowMiss).toFixed(4)} vs ${scoreRound(fastHit).toFixed(4)}`);
}

/* ── 3. track mode must record no reaction time ---------------------------- */
{
  const m = summarize(
    round({
      mode: 'track',
      hits: 10,
      misses: 0,
      reactionTimes: [], // track must not push any
      radialErrors: errorsOf(10, 5),
      samples: 1800,
      onTargetSamples: 1200,
    }),
    null, W, H,
  );
  ok('track: avgReactionMs is NaN (no fabricated multi-second value)',
    Number.isNaN(m.avgReactionMs), String(m.avgReactionMs));
  ok('track: accuracy is NaN (track has no notion of accuracy)',
    Number.isNaN(m.accuracy), String(m.accuracy));
  ok('track: angular metrics still present', Number.isFinite(m.onTargetRatio) && Number.isFinite(m.deviationRatio));
}

/* ── 4. bounded and finite everywhere -------------------------------------- */
{
  const noData = summarize(round({}), null, W, H);
  ok('a round with no targets still yields a finite radial error ratio',
    Number.isFinite(noData.radialErrorRatio), String(noData.radialErrorRatio));

  for (const mode of ['flick', 'track', 'micro']) {
    const s = scoreRound({ mode, accuracy: 0, avgReactionMs: NaN, radialErrorRatio: NaN, onTargetRatio: NaN, deviationRatio: NaN });
    ok(`${mode}: all-NaN metrics clamp to a finite score`, Number.isFinite(s) && s >= 0 && s <= 1, String(s));
  }
  ok('MODES covers the three scored modes', ['flick', 'track', 'micro'].every((m) => MODES[m]));
}

/* ── 5. the reference window is coherent ----------------------------------- */
{
  ok('REF exposes a radial-error window', Number.isFinite(REF.radialErrorGoodRatio) && Number.isFinite(REF.radialErrorBadRatio));
  ok('radial-error window is ordered good < bad', REF.radialErrorGoodRatio < REF.radialErrorBadRatio);
}

console.log('='.repeat(60));
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
