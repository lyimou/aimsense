/**
 * Local history storage.
 *
 * Results never leave the browser, so this is the only persistence layer. Every
 * call is wrapped: localStorage throws in private mode and when the quota is
 * full, and losing history must never break the test the user just finished.
 */

const KEY = 'aimsense.history.v1';
const MAX_ENTRIES = 20;

/** @returns {Array} newest first; empty on any failure. */
export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop anything that does not look like one of our records.
    return parsed.filter((e) => e && typeof e.id === 'string' && Array.isArray(e.rounds));
  } catch {
    return [];
  }
}

/** @returns {{ ok: boolean, reason?: string }} */
export function saveEntry(entry) {
  try {
    const history = loadHistory();
    history.unshift(entry);
    // Keep the newest MAX_ENTRIES only, so the quota cannot creep up forever.
    const trimmed = history.slice(0, MAX_ENTRIES);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    return { ok: true };
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return { ok: false, reason: quota ? 'quota' : 'unavailable' };
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

export function makeId() {
  // crypto.randomUUID is unavailable on some older browsers and on http origins.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
