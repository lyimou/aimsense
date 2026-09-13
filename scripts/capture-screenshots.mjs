import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5180';
mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch();

// --- light and dark of the setup page ---
for (const scheme of ['dark', 'light']) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
    colorScheme: scheme,
  });
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.fill('#sens', '2');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `screenshots/setup-1280-${scheme}.png`, fullPage: true });
  await page.close();
}

// --- a rendered report, produced by injecting a synthetic session ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.fill('#dpi', '800');
  await page.fill('#sens', '2');
  await page.selectOption('#game', 'cs2');
  await page.waitForTimeout(200);

  // Populate the report through the app's own render path.
  await page.evaluate(async () => {
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
          accuracy: a,
          avgReactionMs: 880 - a * 380,
          avgOvershootPx: 22 - a * 14,
          overshootRatio: 0.055 - a * 0.035,
          avgDeviationPx: 14 - a * 8,
          deviationRatio: 0.09 - a * 0.05,
          onTargetRatio: a,
          maxDeviationPx: 20,
        });
      }
    }
    window.__aimsense.setSession(rounds, { dpi: 800, game: 'cs2', sensitivity: 2 }, 'Full sweep');
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/report-1280-dark.png', fullPage: true });
  await page.close();
}

// --- responsive ---
for (const [label, width] of [['768', 768], ['375', 375]]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: 'dark' });
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.fill('#sens', '2');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/setup-${label}-dark.png`, fullPage: true });
  await page.close();
}

await browser.close();
console.log('screenshots written');
