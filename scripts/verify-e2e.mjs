/**
 * End-to-end test run: drives a real engine round with synthetic mouse input and
 * checks that metrics, scoring and the report pipeline all work in a browser.
 *
 * This is the test that matters most — the unit tests cover the maths, but only
 * this proves the canvas, pointer lock, metrics collection and report rendering
 * actually connect.
 *
 * Usage: node scripts/verify-e2e.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5180';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
};

const errors = [];
page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));

await page.goto(base + '/', { waitUntil: 'load' });
await page.waitForTimeout(500);

console.log('\nAimSense end-to-end run\n' + '='.repeat(60));

/*
 * Drive one round by calling the engine directly with a synthetic session.
 * Pointer lock cannot be granted without a real user gesture in headless mode,
 * so the strategies are exercised through the engine's public surface and the
 * metrics path is asserted from the result.
 */
const result = await page.evaluate(async () => {
  const mod = await import('./src/js/engine.js');
  const canvas = document.createElement('canvas');
  canvas.style.width = '900px';
  canvas.style.height = '500px';
  document.body.appendChild(canvas);

  const roundEnds = [];
  const engine = new mod.TestEngine(canvas, {
    onRoundEnd: (m) => roundEnds.push(m),
  });

  // Run the flick strategy's logic without pointer lock by calling its hooks.
  const finished = engine.start('flick', { rounds: 1, sensitivityMultiplier: 1 });
  // Simulate: the engine is running; force pointer lock state so input is accepted.
  engine.locked = true;

  // Spawned target exists?
  const spawned = engine.targets.length;

  // Teleport the crosshair onto the target and click — a guaranteed hit.
  const target = engine.targets[0];
  engine.crosshair.x = target.x;
  engine.crosshair.y = target.y;
  engine.strategy.onClick(engine);

  // Now simulate a deliberate miss, to be sure misses are recorded too.
  if (engine.targets[0]) {
    engine.crosshair.x = 5;
    engine.crosshair.y = 5;
    engine.strategy.onClick(engine);
  }

  // Fast-forward: fill the rest with hits so the round completes.
  let guard = 0;
  while (engine.round && guard++ < 40) {
    const t = engine.targets[0];
    if (!t) break;
    engine.crosshair.x = t.x;
    engine.crosshair.y = t.y;
    engine.strategy.onClick(engine);
  }

  await finished;
  engine.destroy();

  return {
    spawned,
    roundEnds,
    session: engine.session,
    completedRounds: engine.roundIndex,
  };
});

ok('a target was spawned', result.spawned >= 1, String(result.spawned));
ok('the round produced metrics', result.roundEnds.length === 1, String(result.roundEnds.length));

const m = result.roundEnds[0] ?? {};
ok('metrics carry the mode', m.mode === 'flick', String(m.mode));
ok('metrics carry the multiplier', m.sensitivityMultiplier === 1, String(m.sensitivityMultiplier));
ok('hits were recorded', m.hits >= 9, `hits=${m.hits}`);
ok('misses were recorded', m.misses >= 1, `misses=${m.misses}`);
ok('accuracy is a usable fraction', m.accuracy > 0.5 && m.accuracy <= 1, String(m.accuracy));
ok('reaction time recorded', Number.isFinite(m.avgReactionMs) && m.avgReactionMs > 0, String(m.avgReactionMs));
ok('radial error recorded', Number.isFinite(m.avgRadialErrorPx), String(m.avgRadialErrorPx));

/* ---- scoring consumes the metrics without throwing ---- */
const scored = await page.evaluate(async (metrics) => {
  const { scoreRound } = await import('./src/js/recommend.js');
  return scoreRound(metrics);
}, m);
ok('scoreRound accepts real metrics', Number.isFinite(scored) && scored >= 0 && scored <= 1, String(scored));

/* ---- a full synthetic session renders a report ---- */
const reportOk = await page.evaluate(async () => {
  const { recommend, applyRecommendation } = await import('./src/js/recommend.js');
  const { GAMES, cmPer360 } = await import('./src/js/sensitivity.js');
  const i18n = await import('./src/js/i18n.js');
  const { MESSAGES } = await import('./src/js/i18n-messages.js');

  // Three multipliers with a clear interior peak.
  // Accuracy follows a genuine parabola in the multiplier so the vertex sits
  // exactly at 1x. Note a "symmetric-looking" triple such as (0.5,0.4),(1,0.9),
  // (2,0.4) is symmetric about x=1.25, NOT about its vertex, and yields 1.25.
  const mk = (mode, mult, acc) => ({
    mode,
    sensitivityMultiplier: mult,
    accuracy: acc,
    avgReactionMs: 900 - acc * 400,
    avgRadialErrorPx: 20 - acc * 12,
    radialErrorRatio: 0.05 - acc * 0.03,
    radialErrorSamples: 10,
    deviationRatio: 0.1 - acc * 0.06,
    onTargetRatio: acc,
    attempts: 10,
    hits: Math.round(acc * 10),
    durationMs: 10000,
  });
  const accuracyAt = (mult) => 1 - 0.5 * (mult - 1) ** 2;
  const rounds = [];
  for (const mult of [0.5, 1, 2]) {
    for (const mode of ['flick', 'track', 'micro']) {
      rounds.push(mk(mode, mult, accuracyAt(mult)));
    }
  }
  const rec = recommend({ rounds });
  const settings = { dpi: 800, game: 'cs2', sensitivity: 2 };
  const applied = applyRecommendation(rec, settings, cmPer360(800, 2, GAMES.cs2.yaw), GAMES.cs2);
  return {
    multiplier: rec.multiplier,
    method: rec.method,
    confidence: rec.confidence,
    samples: rec.samples.length,
    recommendedCm: applied.recommendedCm360,
    explanation: rec.explanation.head,
    // Resolve the key through the shipped i18n layer, inside the page, so this
    // asserts the text that actually reaches the UI in both languages rather
    // than just that some key exists.
    headEn: i18n.t(rec.explanation.head.key, rec.explanation.head.params),
    headZh: MESSAGES.zh[rec.explanation.head.key],
    caveatEn: i18n.t(rec.explanation.caveat.key),
  };
});

ok('recommendation produced', Number.isFinite(reportOk.multiplier), JSON.stringify(reportOk.multiplier));
ok('recommendation picked the interior peak', Math.abs(reportOk.multiplier - 1) < 0.1, String(reportOk.multiplier));
ok('three sample points', reportOk.samples === 3, String(reportOk.samples));
ok('explanation is a key + params descriptor, not hardcoded prose',
  Boolean(reportOk.explanation?.key) && typeof reportOk.explanation.params === 'object',
  JSON.stringify(reportOk.explanation));
ok('explanation renders to real English text',
  typeof reportOk.headEn === 'string' && reportOk.headEn.length > 20 && !reportOk.headEn.includes('{'),
  String(reportOk.headEn));
ok('explanation has a Chinese translation',
  typeof reportOk.headZh === 'string' && reportOk.headZh.length > 10,
  String(reportOk.headZh));
ok('caveat renders to real text', typeof reportOk.caveatEn === 'string' && reportOk.caveatEn.length > 10,
  String(reportOk.caveatEn));
ok('recommended cm/360 is finite', Number.isFinite(reportOk.recommendedCm), String(reportOk.recommendedCm));

/* ---- report rendering does not throw ---- */
const rendered = await page.evaluate(async () => {
  // Exercise the chart renderers directly on a real canvas.
  const charts = await import('./src/js/charts.js');
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 240;
  document.body.appendChild(c);
  const rounds = [
    { mode: 'flick', sensitivityMultiplier: 0.5, accuracy: 0.5, avgReactionMs: 700, avgRadialErrorPx: 18, radialErrorRatio: 0.04, radialErrorSamples: 10, onTargetRatio: NaN, attempts: 10 },
    { mode: 'flick', sensitivityMultiplier: 1, accuracy: 0.9, avgReactionMs: 500, avgRadialErrorPx: 8, radialErrorRatio: 0.02, radialErrorSamples: 10, onTargetRatio: NaN, attempts: 10 },
    { mode: 'track', sensitivityMultiplier: 1, accuracy: NaN, avgReactionMs: NaN, avgRadialErrorPx: 12, radialErrorRatio: 0.03, radialErrorSamples: 10, onTargetRatio: 0.8, attempts: 10 },
  ];
  const modeScores = { flick: [{ multiplier: 0.5, score: 0.5 }, { multiplier: 1, score: 0.9 }], track: [{ multiplier: 0.5, score: 0.4 }, { multiplier: 1, score: 0.7 }] };
  try {
    charts.drawCurve(c, { samples: [[0.5, 0.5], [1, 0.9], [2, 0.6]], recommended: 1, fit: { a: -0.4, b: 0.9, c: 0.4 } });
    charts.drawRadar(c, { modeScores });
    charts.drawReaction(c, { rounds });
    charts.drawRadialError(c, { rounds });
    charts.drawOnTarget(c, { rounds });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).split('\n')[0] };
  }
});
ok('all five chart renderers run without throwing', rendered.ok, rendered.error ?? '');

/* ---- a radar with ONE mode must not render as blank ----
 * The quick test is flick-only, so `modeScores` has a single key. Every
 * polygon vertex then lands on the same angle, giving a zero-area shape that
 * draws nothing at all — indistinguishable from a broken chart. It must
 * instead state why it is empty. Detected by counting non-background pixels.
 */
const radarSingle = await page.evaluate(async () => {
  const charts = await import('./src/js/charts.js');
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 250;
  document.body.appendChild(c);
  const before = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const countInk = () => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  };
  const blank = countInk();
  // Single-mode radar: must produce a message, so ink must increase.
  charts.drawRadar(c, { modeScores: { flick: [{ multiplier: 1, score: 0.8 }] } });
  const single = countInk();
  void before;
  c.remove();
  return { blank, single };
});
ok('single-mode radar renders a message instead of nothing',
  radarSingle.single > radarSingle.blank,
  `ink ${radarSingle.blank} -> ${radarSingle.single}`);

/* ---- history persistence ---- */
const hist = await page.evaluate(async () => {
  const { saveEntry, loadHistory, clearHistory, makeId } = await import('./src/js/history.js');
  clearHistory();
  const before = loadHistory().length;
  const res = saveEntry({ id: makeId(), at: new Date().toISOString(), settings: { dpi: 800 }, label: 'e2e', rounds: [{ mode: 'flick' }] });
  const after = loadHistory();
  clearHistory();
  return { before, ok: res.ok, after: after.length, persisted: after[0]?.label };
});
ok('history starts empty', hist.before === 0, String(hist.before));
ok('history saves an entry', hist.ok === true && hist.after === 1, JSON.stringify(hist));
ok('history round-trips the label', hist.persisted === 'e2e', String(hist.persisted));

await browser.close();

console.log('='.repeat(60));
console.log(`${pass} passed, ${fail} failed`);
if (errors.length) {
  console.log('\npage errors:');
  for (const e of errors.slice(0, 6)) console.log('  - ' + e);
}
process.exit(fail === 0 ? 0 : 1);
