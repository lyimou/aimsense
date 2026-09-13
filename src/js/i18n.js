/**
 * Locale runtime: detection, persistence, DOM application.
 *
 * Design constraints, all of which follow from the rest of the project:
 *   - no build step, so translations are plain JS objects, not compiled JSON
 *   - no dependencies, so `t()` is a lookup and a string replace
 *   - works under a subpath (/aimsense/), so no absolute URLs anywhere
 *
 * Resolution order for the initial locale:
 *   1. an explicit choice saved in localStorage (the user already decided)
 *   2. `?lang=` in the URL (so a shared link opens in the intended language)
 *   3. the browser's own language list (zh* -> zh, everything else -> en)
 *
 * The URL is read but never written, so switching does not push history
 * entries or break the back button.
 */

import { MESSAGES, LOCALES, DEFAULT_LOCALE } from './i18n-messages.js';

const STORAGE_KEY = 'aimsense.locale';

/** localStorage throws in private mode; a language choice is never critical. */
function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return LOCALES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* not fatal: the choice just will not persist */
  }
}

function fromUrl() {
  // `location` does not exist outside a browser and did not exist in Node
  // until v21 either, so this cannot assume it.
  if (typeof location === 'undefined') return null;
  try {
    const v = new URLSearchParams(location.search).get('lang');
    if (!v) return null;
    const lower = v.toLowerCase();
    // Accept zh, zh-Hant, zh-TW, zh-CN ... all map to the one Chinese bundle.
    if (LOCALES.includes(lower)) return lower;
    if (lower.startsWith('zh')) return 'zh';
    if (lower.startsWith('en')) return 'en';
    return null;
  } catch {
    return null;
  }
}

function fromBrowser() {
  /*
   * `navigator` is NOT guaranteed here. Node 20 has no global navigator at all
   * (it was added in v21), so reading it unguarded threw a ReferenceError at
   * module load — which took down every module that imports this one, including
   * the engine. CI ran Node 20 and the engine's tests died on import.
   */
  if (typeof navigator === 'undefined') return null;
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of list) {
    if (!tag) continue;
    const lower = String(tag).toLowerCase();
    if (lower.startsWith('zh')) return 'zh';
    if (lower.startsWith('en')) return 'en';
  }
  return null;
}

let current = readStored() ?? fromUrl() ?? fromBrowser() ?? DEFAULT_LOCALE;

if (!LOCALES.includes(current)) current = DEFAULT_LOCALE;

const listeners = new Set();

/** Current locale code. */
export function locale() {
  return current;
}

/** True when the user has made an explicit choice (vs. detection). */
export function hasExplicitChoice() {
  return readStored() !== null;
}

/**
 * Translate a key, substituting `{name}` placeholders.
 *
 * A missing key returns the key itself rather than an empty string, so a gap
 * is visible in the UI and in tests instead of rendering as nothing.
 */
export function t(key, params) {
  const table = MESSAGES[current] ?? MESSAGES[DEFAULT_LOCALE];
  let out = table[key];
  if (out === undefined) out = MESSAGES[DEFAULT_LOCALE][key];
  if (out === undefined) return key;
  if (!params) return out;
  return out.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/** The other locale, for a two-state toggle. */
export function otherLocale() {
  return current === 'en' ? 'zh' : 'en';
}

/**
 * Apply translations to the document.
 *
 * Recognised hooks:
 *   data-i18n           -> textContent
 *   data-i18n-attr      -> "attr:key,attr:key" for attributes
 *   data-i18n-aria      -> sets aria-label
 *   data-i18n-title     -> sets title
 *   data-lang-toggle    -> label becomes the language you would switch TO
 *   data-i18n-rich      -> innerHTML, for strings containing inline markup
 */
export function apply(root) {
  // Guarded so `setLocale` is callable outside a browser (the unit tests load
  // this module in plain Node). A default parameter of `document` would throw
  // a ReferenceError there.
  const scope = root ?? (typeof document !== 'undefined' ? document : null);
  if (!scope) return;

  for (const el of scope.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  }

  for (const el of scope.querySelectorAll('[data-i18n-rich]')) {
    const key = el.dataset.i18nRich;
    if (key) el.innerHTML = t(key);
  }

  for (const el of scope.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }

  for (const el of scope.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }

  for (const el of scope.querySelectorAll('[data-i18n-title]')) {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  }

  for (const el of scope.querySelectorAll('[data-lang-toggle]')) {
    // The control shows the language it will switch TO, which is the only
    // labelling that needs no explanation in either language.
    const label = t('lang.switchTo');
    el.textContent = label;
    el.setAttribute('aria-label', `${t('a11y.langToggle')}: ${label}`);
    el.setAttribute('lang', otherLocale() === 'zh' ? 'zh-Hant' : 'en');
  }

  if (typeof document !== 'undefined') {
    document.documentElement.lang = t('meta.htmlLang');
    document.title = t('meta.title');
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', t('meta.description'));
  }
}

/** Change locale, persist it, retranslate, and notify subscribers. */
export function setLocale(next) {
  if (!LOCALES.includes(next) || next === current) return current;
  current = next;
  writeStored(next);
  apply();
  for (const fn of listeners) fn(current);
  return current;
}

export function toggleLocale() {
  return setLocale(otherLocale());
}

/** Subscribe to locale changes. Returns an unsubscribe function. */
export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export { LOCALES, DEFAULT_LOCALE };
