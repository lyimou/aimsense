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
  charts: ['chart-curve', 'chart-radar', 'chart-reaction', 'chart-radial-error', 'chart-on-target']
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

// --- i18n: the toggle must switch the whole page, and persist -------------
{
  await page.evaluate(() => {
    try { localStorage.removeItem('aimsense.locale'); } catch { /* ignore */ }
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(150);

  const snap = () => page.evaluate(() => ({
    lang: document.documentElement.lang,
    h1: document.querySelector('h1').textContent.trim(),
    title: document.title,
    toggle: document.getElementById('lang-toggle').textContent.trim(),
    nav: document.querySelector('.site-nav a').textContent.trim(),
    // Any element still showing a raw key like "nav.setup" is a missing string.
    rawKeys: [...document.querySelectorAll('[data-i18n]')]
      .map((el) => el.textContent.trim())
      .filter((txt) => /^[a-z][a-zA-Z]*\.[a-zA-Z.]+$/.test(txt)),
  }));

  const before = await snap();
  ok('starts in a known locale', ['en', 'zh-Hant'].includes(before.lang), before.lang);

  await page.click('#lang-toggle');
  await page.waitForTimeout(150);
  const after = await snap();

  ok('toggle changes the document language', after.lang !== before.lang, `${before.lang} -> ${after.lang}`);
  ok('toggle changes the heading', after.h1 !== before.h1, `${before.h1} -> ${after.h1}`);
  ok('toggle changes the page title', after.title !== before.title);
  ok('toggle relabels itself to the other language', after.toggle !== before.toggle,
    `${before.toggle} -> ${after.toggle}`);
  ok('toggle changes nav text too', after.nav !== before.nav, `${before.nav} -> ${after.nav}`);
  ok('no element is left showing a raw translation key',
    after.rawKeys.length === 0, after.rawKeys.join(', '));

  /*
   * A DOM-level backstop that a whole section was not left untranslated.
   *
   * Implemented as: in Chinese mode, no visible text node may still be
   * English-looking. An earlier version compared the EN and ZH text-node lists
   * by index — that is unsound, because the DOM does not have the same number
   * of text nodes in both passes (measured: 86 vs 109), so positions do not
   * correspond and the comparison silently passes. Judging each node on its own
   * contents needs no alignment.
   *
   * The allowlist below is deliberate and short: brand names and one code
   * sample are identical in both languages, so they are listed rather than
   * being matched by a broad pattern that would also hide real misses.
   */
  const NEUTRAL = [
    'AimSense',
    'GitHub',
    'CS2',
    'Valorant',
    'Apex Legends',
    'Overwatch 2',
    'Huang For Wa',
    'github.com',
    'eDPI',
    'cm/360 = 360 / (DPI × sensitivity × yaw)',
  ];
  const untranslated = await page.evaluate(async (neutral) => {
    const { setLocale } = await import('./src/js/i18n.js');
    setLocale('zh');
    const suspects = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const text = walk.currentNode.nodeValue.replace(/\s+/g, ' ').trim();
      if (!text || text.length < 6) continue;
      if (/[\u4e00-\u9fff]/.test(text)) continue; // already Chinese
      if (!/[A-Za-z]{3}/.test(text)) continue; // units, numbers, symbols only
      if (/^(https?:|[\w.@/:-]+$)/.test(text)) continue; // url / single token
      if (neutral.some((n) => text.includes(n))) continue;
      suspects.push(text);
    }
    setLocale('en');
    return suspects;
  }, NEUTRAL);
  ok('in Chinese mode no visible English sentence is left behind',
    untranslated.length === 0, untranslated.slice(0, 5).join(' | '));

  await page.click('#lang-toggle');
  await page.waitForTimeout(150);
  const back = await snap();
  ok('toggling back restores the original language', back.h1 === before.h1, `${back.h1} vs ${before.h1}`);

  // The choice must survive a reload.
  await page.click('#lang-toggle');
  await page.waitForTimeout(100);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(200);
  const persisted = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    stored: (() => { try { return localStorage.getItem('aimsense.locale'); } catch { return null; } })(),
  }));
  ok('the language choice persists across a reload',
    persisted.stored !== null && persisted.lang !== before.lang,
    `stored=${persisted.stored} lang=${persisted.lang}`);

  // Charts draw their own text; switching must reach the canvas too.
  const canvasChanged = await page.evaluate(async () => {
    const ink = (canvas) => {
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 3; i < d.length; i += 4) sum += d[i];
      return sum;
    };
    const c = document.createElement('canvas');
    c.width = 480; c.height = 250;
    document.body.appendChild(c);
    const charts = await import('./src/js/charts.js');
    const { setLocale } = await import('./src/js/i18n.js');
    setLocale('en');
    charts.drawRadar(c, { modeScores: { flick: [] } }); // triggers the empty state
    const en = ink(c);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    setLocale('zh');
    charts.drawRadar(c, { modeScores: { flick: [] } });
    const zh = ink(c);
    setLocale('en');
    c.remove();
    return { en, zh };
  });
  ok('canvas chart text also switches language',
    canvasChanged.en !== canvasChanged.zh && canvasChanged.en > 0 && canvasChanged.zh > 0,
    `ink en=${canvasChanged.en} zh=${canvasChanged.zh}`);

  await page.evaluate(() => {
    try { localStorage.removeItem('aimsense.locale'); } catch { /* ignore */ }
  });
}

await browser.close();

console.log('='.repeat(58));
console.log(`${pass} passed, ${fail} failed`);
if (errors.length) {
  console.log('\nerrors captured:');
  for (const e of errors.slice(0, 8)) console.log('  - ' + e);
}
process.exit(fail === 0 ? 0 : 1);
