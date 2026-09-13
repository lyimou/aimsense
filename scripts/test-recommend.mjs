/**
 * Recommendation engine tests. Run with `node scripts/test-recommend.mjs`.
 *
 * Sessions are synthetic so every branch of the decision tree can be exercised
 * deterministically — a real session cannot be replayed.
 *
 * The DIRECTION block below is the important one. Two earlier versions of
 * scoreRound had inverted terms (`1 - lerpScore(...)`, then a `lowerIsBetter`
 * whose body contradicted its name). Both were invisible in the totals, because
 * an inverted term contributes ~0 and looks like a mis-calibrated tolerance.
 * Asserting the direction of every single metric is what makes that class of bug
 * impossible to reintroduce.
 */
import {
  recommend,
  applyRecommendation,
  scoreRound,
  SWEEP_MULTIPLIERS,
} from '../src/js/recommend.js';
import { REF } from '../src/js/recommend.js';
import { GAMES, cmPer360 } from '../src/js/sensitivity.js';
import { MESSAGES } from '../src/js/i18n-messages.js';

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

const flick = (accuracy, avgReactionMs, radialErrorRatio) =>
  scoreRound({ mode: 'flick', accuracy, avgReactionMs, radialErrorRatio });
const track = (onTargetRatio, deviationRatio) =>
  scoreRound({ mode: 'track', onTargetRatio, deviationRatio });
const micro = (accuracy, radialErrorRatio) =>
  scoreRound({ mode: 'micro', accuracy, radialErrorRatio });

/** Build a round whose score is approximately `target` for the given mode. */
function makeRound(mode, multiplier, target) {
  const build = (q) => {
    const common = { mode, sensitivityMultiplier: multiplier, reason: 'completed' };
    const mid = (good, bad) => q * good + (1 - q) * bad;
    if (mode === 'flick') {
      return {
        ...common,
        accuracy: q,
        avgReactionMs: mid(REF.reactionGoodMs, REF.reactionBadMs),
        radialErrorRatio: mid(REF.radialErrorGoodRatio, REF.radialErrorBadRatio),
      };
    }
    if (mode === 'track') {
      return {
        ...common,
        onTargetRatio: q,
        deviationRatio: mid(REF.deviationGoodRatio, REF.deviationBadRatio),
      };
    }
    return {
      ...common,
      accuracy: q,
      radialErrorRatio: mid(REF.radialErrorGoodRatio, REF.radialErrorBadRatio),
    };
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (scoreRound(build(mid)) < target) lo = mid;
    else hi = mid;
  }
  return build((lo + hi) / 2);
}

function sessionFrom(scoreByMultiplier) {
  const rounds = [];
  for (const [mult, score] of Object.entries(scoreByMultiplier)) {
    for (const mode of ['flick', 'track', 'micro']) {
      rounds.push(makeRound(mode, Number(mult), score));
    }
  }
  return { rounds };
}

console.log('\nrecommend.js\n' + '='.repeat(60));

/* --- DIRECTION: every metric must move the score the right way ----------- */
{
  const checks = [
    ['flick: higher accuracy helps', flick(0.5, 700, 0.06) < flick(0.9, 700, 0.06)],
    ['flick: lower reaction time helps', flick(0.8, 1000, 0.06) < flick(0.8, 500, 0.06)],
    ['flick: smaller radial error helps', flick(0.8, 700, 0.09) < flick(0.8, 700, 0.03)],
    ['track: more time on target helps', track(0.3, 0.15) < track(0.9, 0.15)],
    ['track: less deviation helps', track(0.7, 0.2) < track(0.7, 0.06)],
    ['micro: higher accuracy helps', micro(0.5, 0.06) < micro(0.9, 0.06)],
    ['micro: smaller radial error helps', micro(0.8, 0.09) < micro(0.8, 0.03)],
  ];
  for (const [name, cond] of checks) ok(name, cond);
}

/* --- full dynamic range -------------------------------------------------- */
{
  const perfect = [
    flick(1, REF.reactionGoodMs, REF.radialErrorGoodRatio),
    track(1, REF.deviationGoodRatio),
    micro(1, REF.radialErrorGoodRatio),
  ];
  const terrible = [
    flick(0, REF.reactionBadMs, REF.radialErrorBadRatio),
    track(0, REF.deviationBadRatio),
    micro(0, REF.radialErrorBadRatio),
  ];
  ok('perfect run scores ~1.0 in every mode', perfect.every((s) => s > 0.99), perfect.map((s) => s.toFixed(3)).join(', '));
  ok('terrible run scores ~0.0 in every mode', terrible.every((s) => s < 0.01), terrible.map((s) => s.toFixed(3)).join(', '));
  ok('every mode leaves headroom above mid-scale', perfect.every((s) => s - 0.5 > 0.2));
}

/* --- monotonic in quality ------------------------------------------------ */
{
  for (const mode of ['flick', 'track', 'micro']) {
    const vals = [0, 0.25, 0.5, 0.75, 1].map((q) => scoreRound(makeRound(mode, 1, q)));
    const mono = vals.every((v, i) => i === 0 || v >= vals[i - 1] - 1e-9);
    ok(`${mode}: score is monotonic in quality`, mono, vals.map((v) => v.toFixed(3)).join(' -> '));
  }
}

/* --- bounded ------------------------------------------------------------- */
ok('scoreRound stays within 0..1',
  [0, 0.5, 1].every((q) =>
    ['flick', 'track', 'micro'].every((m) => {
      const s = scoreRound(makeRound(m, 1, q));
      return s >= 0 && s <= 1;
    }),
  ));

/* --- makeRound accuracy -------------------------------------------------- */
{
  const r = makeRound('flick', 1, 0.75);
  ok('makeRound hits its target score', Math.abs(scoreRound(r) - 0.75) < 0.01, String(scoreRound(r)));
}

/* --- flat: everything equal -> no change -------------------------------- */
{
  const rec = recommend(sessionFrom({ 0.5: 0.7, 1: 0.7, 2: 0.7 }));
  ok('identical scores -> method "flat"', rec.method === 'flat', rec.method);
  ok('identical scores -> multiplier 1', rec.multiplier === 1, String(rec.multiplier));
  ok('identical scores -> confidence "none"', rec.confidence === 'none', rec.confidence);
  ok('flat explanation selects the "keep current" message',
    rec.explanation.head.key === 'rec.flat', rec.explanation.head.key);
  ok('flat explanation text says keep current',
    /keep your current/i.test(MESSAGES.en[rec.explanation.head.key]), MESSAGES.en[rec.explanation.head.key]);
  ok('flat explanation has a Chinese translation too',
    Boolean(MESSAGES.zh[rec.explanation.head.key]), rec.explanation.head.key);
}

/* --- interior peak at exactly 1x ---------------------------------------- */
{
  /*
   * Samples must come from a parabola whose VERTEX is at 1, not merely from a
   * symmetric-looking triple. Note (0.5, a), (1, b), (2, a) is symmetric about
   * x = 1.25, not about the vertex — the vertex depends on curvature, and that
   * exact triple yields 1.25. Generating from y = -(x-1)² + 0.9 puts the vertex
   * at 1 by construction.
   */
  const y = (x) => -((x - 1) ** 2) + 0.9;
  const rec = recommend(sessionFrom({ 0.5: y(0.5), 1: y(1), 2: y(2) }));
  ok('interior peak -> method "parabola"', rec.method === 'parabola', rec.method);
  ok('interior peak -> high confidence', rec.confidence === 'high', rec.confidence);
  ok('interior peak -> multiplier ~1', Math.abs(rec.multiplier - 1) < 0.05, String(rec.multiplier));
  ok('parabola explanation selects the curve message',
    rec.explanation.head.key === 'rec.parabola', rec.explanation.head.key);
  ok('parabola explanation text mentions a curve',
    /curve/i.test(MESSAGES.en[rec.explanation.head.key]), MESSAGES.en[rec.explanation.head.key]);
  ok('parabola explanation carries the multiplier as a param',
    rec.explanation.head.params.mult === rec.multiplier,
    `${rec.explanation.head.params.mult} vs ${rec.multiplier}`);
  ok('generated samples are not flat',
    Math.abs(rec.samples[1][1] - rec.samples[0][1]) > 0.06,
    rec.samples.map((s) => s[1].toFixed(3)).join(', '));
}

/* --- monotonic samples --------------------------------------------------- */
{
  const rising = recommend(sessionFrom({ 0.5: 0.3, 1: 0.5, 2: 0.75 }));
  ok('rising samples -> recommendation above 1x', rising.multiplier > 1, String(rising.multiplier));
  const falling = recommend(sessionFrom({ 0.5: 0.75, 1: 0.5, 2: 0.3 }));
  ok('falling samples -> recommendation below 1x', falling.multiplier < 1, String(falling.multiplier));
}

/* --- structural fact: middle-lowest can never be an interior peak ------- */
{
  const rec = recommend(sessionFrom({ 0.5: 0.9, 1: 0.4, 2: 0.9 }));
  ok('middle-lowest samples never yield "parabola"', rec.method !== 'parabola', rec.method);
  ok('middle-lowest samples still return a tested value',
    SWEEP_MULTIPLIERS.includes(rec.multiplier), String(rec.multiplier));
}

/* --- structure ----------------------------------------------------------- */
{
  const rec = recommend(sessionFrom({ 0.5: 0.4, 1: 0.9, 2: 0.4 }));
  ok('samples has one entry per multiplier', rec.samples.length === 3, String(rec.samples.length));
  ok('samples sorted ascending',
    rec.samples[0][0] < rec.samples[1][0] && rec.samples[1][0] < rec.samples[2][0]);
  ok('modeScores covers all three modes', ['flick', 'track', 'micro'].every((m) => rec.modeScores[m]));
  ok('each mode has 3 points', ['flick', 'track', 'micro'].every((m) => rec.modeScores[m].length === 3));
  ok('explanation carries head/caveat/summary',
    Boolean(rec.explanation.head && rec.explanation.caveat && rec.explanation.summary));
  ok('recommendation stays within 0.25x..4x',
    rec.multiplier >= 0.25 && rec.multiplier <= 4, String(rec.multiplier));
}

/* --- insufficient / degenerate input ------------------------------------- */
{
  const rec = recommend(sessionFrom({ 1: 0.8 }));
  ok('one multiplier -> no parabola fit', rec.method !== 'parabola', rec.method);
  ok('one multiplier -> not high confidence', rec.confidence !== 'high', rec.confidence);

  let threw = null;
  let empty = null;
  try {
    empty = recommend({ rounds: [] });
  } catch (e) {
    threw = e;
  }
  ok('empty session does not throw', threw === null, String(threw));
  ok('empty session returns a finite multiplier', empty && Number.isFinite(empty.multiplier));
}

/* --- applyRecommendation direction -------------------------------------- */
{
  const settings = { dpi: 800, game: 'cs2', sensitivity: 2 };
  const currentCm = cmPer360(800, 2, GAMES.cs2.yaw); // ~10.23 cm

  const faster = applyRecommendation({ multiplier: 2 }, settings, currentCm, GAMES.cs2);
  ok('2x multiplier halves cm/360', Math.abs(faster.recommendedCm360 - currentCm / 2) < 1e-9);
  ok('2x multiplier doubles in-game sensitivity',
    Math.abs(faster.recommendedSensitivity - 4) < 1e-9, String(faster.recommendedSensitivity));
  ok('2x multiplier doubles eDPI',
    Math.abs(faster.recommendedEdpi - 3200) < 1e-9, String(faster.recommendedEdpi));

  const slower = applyRecommendation({ multiplier: 0.5 }, settings, currentCm, GAMES.cs2);
  ok('0.5x multiplier doubles cm/360', Math.abs(slower.recommendedCm360 - currentCm * 2) < 1e-9);
  ok('0.5x multiplier halves in-game sensitivity',
    Math.abs(slower.recommendedSensitivity - 1) < 1e-9);

  const noSens = applyRecommendation({ multiplier: 1.5 }, { dpi: 800, game: 'cs2', sensitivity: 0 }, currentCm, GAMES.cs2);
  ok('missing sensitivity -> NaN, not a wrong number', Number.isNaN(noSens.recommendedSensitivity));

  const unverified = applyRecommendation({ multiplier: 1 }, { dpi: 800, game: 'overwatch', sensitivity: 5 }, 30, GAMES.overwatch);
  ok('unverified game conversion is flagged', unverified.gameVerified === false);
}

/* --- sweep constants ----------------------------------------------------- */
ok('sweep has three multipliers', SWEEP_MULTIPLIERS.length === 3, String(SWEEP_MULTIPLIERS.length));
ok('sweep includes 1x as baseline', SWEEP_MULTIPLIERS.includes(1));
ok('sweep is symmetric around 1x', SWEEP_MULTIPLIERS[0] * SWEEP_MULTIPLIERS[2] === 1);

console.log('='.repeat(60));
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
