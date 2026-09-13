/**
 * Browser smoke test for AimSense.
 *
 * Loads the page in Chromium and asserts the app boots: no console errors, the
 * form is wired, the readout computes, and the viewport has no horizontal
 * overflow at three widths.
 *
 * Usage: node scripts/verify-browser.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5180';
const browser = await chromium.launch();
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

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('requestfailed', (r) => {
  // Ignore the favicon on some servers; everything else matters.
  if (!r.url().includes('favicon')) errors.push(`REQFAIL ${r.url()}`);
});

await page.goto(base + '/', { waitUntil: 'load' });
await page.waitForTimeout(600);

console.log('\nAimSense browser smoke test\n' + '='.repeat(58));

ok('no console / page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

// --- structure ------------------------------------------------------------
const struct = await page.evaluate(() => ({
  title: document.title,
  h1: document.querySelector('h1')?.textContent?.trim(),
  hasStart: Boolean(document.getElementById('start-btn')),
  hasQuick: Boolean(document.getElementById('quick-btn')),
  hasCanvas: Boolean(document.getElementById('stage')),
  charts: ['chart-curve', 'chart-radar', 'chart-reaction', 'chart-overshoot', 'chart-on-target']
    .filter((id) => document.getElementById(id)).length,
  reportHidden: document.getElementById('report')?.hidden,
  githubLinks: [...document.querySelectorAll('a[href*="github.com/lyimou"]')].length,
}));
ok('page title set', struct.title.includes('AimSense'), struct.title);
ok('single h1 present', Boolean(struct.h1), String(struct.h1));
ok('start button exists', struct.hasStart);
ok('quick test button exists', struct.hasQuick);
ok('test canvas exists', struct.hasCanvas);
ok('all five chart canvases exist', struct.charts === 5, String(struct.charts));
ok('report hidden on first load', struct.reportHidden === true);
ok('author GitHub links present', struct.githubLinks >= 2, String(struct.githubLinks));

// --- readout computes ----------------------------------------------------
{
  await page.fill('#dpi', '800');
  await page.fill('#sens', '2');
  await page.selectOption('#game', 'cs2');
  await page.waitForTimeout(150);
  const cm = await page.textContent('#out-cm');
  const edpi = await page.textContent('#out-edpi');
  const band = await page.textContent('#out-band');
  // 800 DPI * sens 2 * yaw 0.022 => 360 / 35.2 = 10.23 cm
  ok('cm/360 computes', /10\.2/.test(cm ?? ''), String(cm));
  ok('eDPI computes', /1600/.test(edpi ?? ''), String(edpi));
  ok('band label set', Boolean(band) && band !== '—', String(band));
}

// --- validation ----------------------------------------------------------
{
  await page.fill('#dpi', '10');
  await page.dispatchEvent('#dpi', 'input');
  await page.waitForTimeout(120);
  const startDisabled = await page.evaluate(() => {
    document.getElementById('start-btn').click();
    return document.getElementById('test-stage').hidden;
  });
  await page.waitForTimeout(200);
  const errText = await page.textContent('[data-error-for="dpi"]');
  ok('invalid DPI blocks the test', startDisabled === true);
  ok('invalid DPI shows an error', Boolean(errText && errText.length > 3), String(errText));

  // restore
  await page.fill('#dpi', '800');
  await page.dispatchEvent('#dpi', 'input');
}

// --- responsive ----------------------------------------------------------
for (const [label, width] of [['1440', 1440], ['768', 768], ['375', 375]]) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const smallTargets = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a[href], button, input, select')];
    return els.filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (el.closest('p, li')) return false;
      return r.height < 43.5;
    }).length;
  });
  ok(`${label}px: no horizontal overflow`, overflow <= 1, `over by ${overflow}px`);
  ok(`${label}px: touch targets >= 44px`, smallTargets === 0, `${smallTargets} too small`);
}

// --- debug surface -------------------------------------------------------
{
  await page.setViewportSize({ width: 1280, height: 900 });
  const dbg = await page.evaluate(() => ({
    hasDebug: Boolean(window.__aimsense),
    sweep: window.__aimsense?.SWEEP_MULTIPLIERS,
    fullRounds: window.__aimsense ? window.__aimsense.totalRounds : null,
  }));
  ok('debug surface exposed for tests', dbg.hasDebug);
  ok('sweep multipliers are 0.5/1/2',
    JSON.stringify(dbg.sweep) === JSON.stringify([0.5, 1, 2]), JSON.stringify(dbg.sweep));
}

await browser.close();

console.log('='.repeat(58));
console.log(`${pass} passed, ${fail} failed`);
if (errors.length) {
  console.log('\nerrors captured:');
  for (const e of errors.slice(0, 8)) console.log('  - ' + e);
}
process.exit(fail === 0 ? 0 : 1);
