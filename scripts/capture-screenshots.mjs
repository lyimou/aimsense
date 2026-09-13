import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5180';
mkdirSync('screenshots', { recursive: true });

/*
 * Pin the locale rather than inheriting it.
 *
 * The app resolves its language from the saved choice, then `?lang=`, then the
 * browser's language list — so on a machine set to Chinese the captured
 * screenshots came out in Chinese with no indication that anything had varied.
 * Screenshots in a repository have to be reproducible, so the language is set
 * explicitly here: English is the default the README documents, and one Chinese
 * report is captured as well so the translation is visible.
 */
const LOCALES = [
  { id: 'en', lang: 'en' },
  { id: 'zh', lang: 'zh' },
];

const browser = await chromium.launch();

/** Force a locale before the app's module runs, and confirm it took effect. */
async function pinLocale(page, lang) {
  await page.addInitScript((l) => {
    try {
      localStorage.setItem('aimsense.locale', l);
    } catch {
      /* storage unavailable: ?lang= below still applies */
    }
  }, lang);
  await page.goto(`${base}/?lang=${lang}`, { waitUntil: 'load' });
  const actual = await page.evaluate(() => document.documentElement.lang);
  const expected = lang === 'zh' ? 'zh-Hant' : 'en';
  if (actual !== expected) {
    throw new Error(`locale not applied: wanted ${expected}, got ${actual}`);
  }
}

/** Build the report through the app's own render path. */
async function renderReport(page) {
  await page.fill('#dpi', '800');
  await page.fill('#sens', '2');
  await page.selectOption('#game', 'cs2');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const acc = (m) => 1 - 0.5 * (m - 1) ** 2;
    const rounds = [];
    for (const mult of [0.5, 1, 2]) {
      for (const mode of ['flick', 'track', 'micro']) {
        const a = acc(mult);
        rounds.push({
          index: rounds.length,
          mode,
          sensitivityMultiplier: mult,
          reason: 'completed',
          durationMs: 12000,
          attempts: 10,
          hits: Math.round(a * 10),
          misses: 10 - Math.round(a * 10),
          accuracy: mode === 'track' ? NaN : a,
          avgReactionMs: mode === 'track' ? NaN : 880 - a * 380,
          avgRadialErrorPx: 22 - a * 14,
          radialErrorRatio: 0.055 - a * 0.035,
          radialErrorSamples: 10,
          avgDeviationPx: 14 - a * 8,
          deviationRatio: 0.09 - a * 0.05,
          onTargetRatio: a,
          maxDeviationPx: 20,
        });
      }
    }
    window.__aimsense.setSession(rounds, { dpi: 800, game: 'cs2', sensitivity: 2 }, 'full');
  });
  await page.waitForTimeout(800);
}

// --- setup page, light and dark, in the default language -------------------
for (const scheme of ['dark', 'light']) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
    colorScheme: scheme,
  });
  await pinLocale(page, 'en');
  await page.fill('#sens', '2');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `screenshots/setup-1280-${scheme}.png`, fullPage: true });
  await page.close();
}

// --- a rendered report in each language -----------------------------------
for (const { id, lang } of LOCALES) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
  });
  await pinLocale(page, lang);
  await renderReport(page);
  await page.screenshot({ path: `screenshots/report-1280-dark-${id}.png`, fullPage: true });
  await page.close();
}

// --- responsive, in the default language ----------------------------------
for (const [label, width] of [['768', 768], ['375', 375]]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: 'dark' });
  await pinLocale(page, 'en');
  await page.fill('#sens', '2');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/setup-${label}-dark.png`, fullPage: true });
  await page.close();
}

await browser.close();
console.log('screenshots written');
