#!/usr/bin/env node
/**
 * i18n integrity tests.
 *
 * Translation bugs are quiet: a missing key renders as the raw key, and a
 * placeholder that exists in one language but not the other silently drops
 * data from the sentence. Neither throws, and neither is visible unless you
 * happen to read both languages. So they are asserted here instead.
 *
 * Checks:
 *   1. EN and ZH expose exactly the same key set
 *   2. placeholders ({name}) match per key across locales
 *   3. every key referenced from index.html exists
 *   4. every key referenced from src/ exists
 *   5. no orphans are left behind after a string is deleted
 *   6. t() falls back and interpolates correctly
 *
 * Run: node scripts/test-i18n.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGES, LOCALES, DEFAULT_LOCALE } from '../src/js/i18n-messages.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

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

const en = Object.keys(MESSAGES.en).sort();
const zh = Object.keys(MESSAGES.zh).sort();

console.log('\ni18n integrity\n' + '='.repeat(60));

/* ── 1. same key set ------------------------------------------------------- */
{
  const missingZh = en.filter((k) => !(k in MESSAGES.zh));
  const extraZh = zh.filter((k) => !(k in MESSAGES.en));
  ok('both locales expose the same keys',
    missingZh.length === 0 && extraZh.length === 0,
    `missing in zh: [${missingZh.join(', ')}] extra: [${extraZh.join(', ')}]`);
  ok('a meaningful number of keys is defined', en.length > 120, String(en.length));
  ok('LOCALES lists both bundles', LOCALES.length === 2 && LOCALES.every((l) => MESSAGES[l]));
  ok('DEFAULT_LOCALE has a bundle', Boolean(MESSAGES[DEFAULT_LOCALE]));
}

/* ── 2. placeholder parity ------------------------------------------------- */
{
  const placeholders = (s) =>
    [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = en
    .filter((k) => k in MESSAGES.zh)
    .filter((k) => placeholders(MESSAGES.en[k]) !== placeholders(MESSAGES.zh[k]))
    .map((k) => `${k} en[${placeholders(MESSAGES.en[k])}] zh[${placeholders(MESSAGES.zh[k])}]`);
  ok('placeholders match across locales for every key', bad.length === 0, bad.join(' | '));
}

/* ── 3+4. every referenced key exists ------------------------------------- */
{
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const htmlKeys = new Set();
  for (const m of html.matchAll(/data-i18n(?:-rich|-attr|-aria|-title)?="([^"]+)"/g)) {
    // -attr holds "attr:key,attr:key"
    for (const part of m[1].split(',')) {
      const key = part.includes(':') ? part.split(':')[1].trim() : part.trim();
      if (key) htmlKeys.add(key);
    }
  }
  const missingHtml = [...htmlKeys].filter((k) => !(k in MESSAGES.en));
  ok('every key used in index.html is defined', missingHtml.length === 0, missingHtml.join(', '));
  ok('index.html uses a substantial number of keys', htmlKeys.size > 50, String(htmlKeys.size));

  // Keys referenced from JS sources via t('...')
  const jsKeys = new Set();
  const hardcodedLocale = new Set();
  for (const file of readdirSync(join(root, 'src/js'))) {
    if (!file.endsWith('.js') || file === 'i18n-messages.js') continue;
    const src = readFileSync(join(root, 'src/js', file), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) jsKeys.add(m[1]);
    for (const m of src.matchAll(/\bt\(\s*`([^`]+)`/g)) {
      // Template literals: `band.${key}` / `game.${key}` / `test.mode.${mode}`.
      // Expand against the families the code actually uses.
      if (m[1].includes('band.')) for (const b of ['very-high', 'high', 'medium', 'low', 'very-low', 'unknown']) jsKeys.add(`band.${b}`);
      if (m[1].includes('game.')) for (const g of ['cs2', 'valorant', 'apex', 'overwatch']) jsKeys.add(`game.${g}`);
      if (m[1].includes('test.mode.')) for (const md of ['flick', 'track', 'micro']) jsKeys.add(`test.mode.${md}`);
      if (m[1].includes('test.plan.')) for (const p of ['quick', 'full']) jsKeys.add(`test.plan.${p}`);
    }
    if (/hardcodedLocale/.test(src)) hardcodedLocale.add(file);
  }
  const missingJs = [...jsKeys].filter((k) => !(k in MESSAGES.en));
  ok('every key referenced from src/js is defined', missingJs.length === 0, missingJs.join(', '));
}

/* ── 5. no orphans --------------------------------------------------------- */
{
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const referenced = new Set();
  for (const m of html.matchAll(/data-i18n(?:-rich|-attr|-aria|-title)?="([^"]+)"/g)) {
    for (const part of m[1].split(',')) {
      const key = part.includes(':') ? part.split(':')[1].trim() : part.trim();
      if (key) referenced.add(key);
    }
  }
  for (const file of readdirSync(join(root, 'src/js'))) {
    if (!file.endsWith('.js') || file === 'i18n-messages.js') continue;
    const src = readFileSync(join(root, 'src/js', file), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) referenced.add(m[1]);
    for (const m of src.matchAll(/'(rec\.[a-zA-Z.]+|band\.[a-z-]+)'/g)) referenced.add(m[1]);
  }
  // Keys assembled at runtime from a family prefix.
  const families = ['band.', 'game.', 'test.mode.', 'test.plan.'];
  const orphan = en.filter((k) => !referenced.has(k) && !families.some((f) => k.startsWith(f)));
  ok('no unreferenced keys are left behind', orphan.length === 0, orphan.join(', '));
}

/* ── 6. t() behaviour ------------------------------------------------------ */
{
  // Import the runtime in a minimal DOM-less way. i18n.js reads localStorage,
  // navigator and location at module load, so provide just enough. In Node 24
  // `navigator` is a read-only getter on globalThis, so it must be redefined
  // rather than assigned.
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'en-US', languages: ['en-US'] },
    configurable: true,
    writable: true,
  });
  globalThis.location = { search: '' };
  const { t, locale, setLocale, otherLocale } = await import('../src/js/i18n.js');

  ok('defaults to the browser language (en)', locale() === 'en', locale());
  ok('translates a known key', t('nav.setup') === 'Setup', t('nav.setup'));
  ok('interpolates placeholders',
    t('setup.equivalent', { list: 'A 1 · B 2' }) === 'Equivalent: A 1 · B 2',
    t('setup.equivalent', { list: 'A 1 · B 2' }));
  ok('a missing param leaves the placeholder visible rather than printing undefined',
    t('setup.equivalent', {}).includes('{list}'),
    t('setup.equivalent', {}));
  ok('an unknown key returns the key itself (visible, not blank)',
    t('nope.not.a.key') === 'nope.not.a.key', t('nope.not.a.key'));

  const other = otherLocale();
  setLocale(other);
  ok('switching locale changes output', locale() === other && t('nav.setup') !== 'Setup',
    `${locale()} / ${t('nav.setup')}`);
  ok('the other locale has no unresolved keys for a sample',
    ['nav.setup', 'hero.title', 'test.start'].every((k) => t(k) && t(k) !== k),
    ['nav.setup', 'hero.title', 'test.start'].map((k) => `${k}=${t(k)}`).join(' '));
  setLocale('en');
}

/* ── 7. works with no browser globals at all ------------------------------- */
{
  /*
   * `i18n.js` is imported by engine.js, which is imported by the metric tests,
   * so a ReferenceError at its module load takes down far more than the UI.
   * Node 20 has no global `navigator` (added in v21) and no `location`, and CI
   * runs Node 20 — so this guard exists because that combination already broke
   * the build once, invisible on a newer local Node.
   */
  const before = { nav: globalThis.navigator, loc: globalThis.location };
  try {
    delete globalThis.navigator;
    delete globalThis.location;
    const fresh = await import(`../src/js/i18n.js?noglobals=${Date.now()}`);
    ok('module loads with no navigator/location (Node 20 compatibility)',
      typeof fresh.t === 'function');
    ok('falls back to the default locale', fresh.locale() === 'en', fresh.locale());
    ok('still translates', fresh.t('nav.setup') === 'Setup', fresh.t('nav.setup'));
    ok('setLocale is safe without a DOM', (() => {
      try { fresh.setLocale('zh'); return true; } catch { return false; }
    })());
  } finally {
    if (before.nav) Object.defineProperty(globalThis, 'navigator', { value: before.nav, configurable: true, writable: true });
    if (before.loc) globalThis.location = before.loc;
  }
}

console.log('='.repeat(60));
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);