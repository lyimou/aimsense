/**
 * Application controller.
 *
 * Reads the setup form, runs the sweep, renders the report. All state lives in
 * `state` here; the modules it calls are pure (sensitivity math, scoring,
 * charts), which is what makes them testable without a browser.
 */
import { GAMES, DEFAULT_DPI, cmPer360, edpi, sensitivityBand, convertSensitivity } from './sensitivity.js';
import { recommend, applyRecommendation, scoreRound, SWEEP_MULTIPLIERS } from './recommend.js';
import { fullPlan, quickPlan, runPlan, totalRounds } from './session.js';
import { loadHistory, saveEntry, clearHistory, makeId } from './history.js';
import { drawCurve, drawRadar, drawReaction, drawRadialError, drawOnTarget } from './charts.js';
import { t, apply as applyI18n, toggleLocale, onLocaleChange, locale } from './i18n.js';

const $ = (id) => document.getElementById(id);

/** Translate a { key, params } descriptor produced by the scorer. */
const tr = (descriptor) => (descriptor ? t(descriptor.key, descriptor.params) : '');

/**
 * Locale-aware metric labels.
 *
 * `GAMES` in sensitivity.js carries the yaw constants and a canonical English
 * label; the translation layer owns the display name. Game names are brands and
 * are identical in both languages, but going through `t()` keeps one code path
 * instead of a special case.
 */
const gameLabel = (key) => t(`game.${key}`);
const modeLabel = (mode) => t(`test.mode.${mode}`);
const planLabel = (kind) => t(kind === 'quick' ? 'test.plan.quick' : 'test.plan.full');

const state = {
  settings: { dpi: DEFAULT_DPI, game: 'cs2', sensitivity: 0 },
  session: null,
  rec: null,
  running: false,
};

/** Handle to the running session so Abort can reach the engine. */
let activeController = null;

/* ------------------------------- helpers -------------------------------- */

const fmt = (v, digits = 2) =>
  Number.isFinite(v) ? v.toFixed(digits) : '—';
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—');

function readSettings() {
  const dpi = Number($('dpi').value);
  const game = $('game').value;
  const sensRaw = $('sens').value.trim();
  const sensitivity = sensRaw === '' ? 0 : Number(sensRaw);
  return { dpi, game, sensitivity };
}

function validate(settings) {
  const errors = {};
  if (!Number.isFinite(settings.dpi) || settings.dpi < 50 || settings.dpi > 32000) {
    errors.dpi = t('err.dpi');
  }
  if (settings.sensitivity !== 0 && (!Number.isFinite(settings.sensitivity) || settings.sensitivity <= 0)) {
    errors.sens = t('err.sens');
  }
  return errors;
}

function showErrors(errors) {
  document.querySelectorAll('[data-error-for]').forEach((el) => {
    el.textContent = errors[el.dataset.errorFor] ?? '';
  });
  return Object.keys(errors).length === 0;
}

/* ------------------------------ setup form ------------------------------ */

function updateReadout() {
  const settings = readSettings();
  state.settings = settings;
  const game = GAMES[settings.game] ?? GAMES.other;
  const hint = $('game-hint');

  if (Number.isFinite(settings.dpi) && settings.sensitivity > 0) {
    const cm = cmPer360(settings.dpi, settings.sensitivity, game.yaw);
    $('out-cm').textContent = `${fmt(cm, 2)} cm`;
    $('out-edpi').textContent = fmt(edpi(settings.dpi, settings.sensitivity), 0);
    $('out-band').textContent = t(`band.${sensitivityBand(cm).key}`);
    $('out-conversion').textContent = t('setup.conversion', {
      yaw: game.yaw,
      game: gameLabel(settings.game),
    });
  } else {
    $('out-cm').textContent = '—';
    $('out-edpi').textContent = '—';
    $('out-band').textContent = '—';
    $('out-conversion').textContent = settings.sensitivity ? '' : t('setup.addSens');
  }

  hint.textContent = game.verified ? t('setup.verifiedHint') : t('setup.unverifiedHint');
  hint.style.color = game.verified ? '' : 'var(--warn)';
}

/* ------------------------------- test flow ------------------------------ */

function setNavReportVisible(visible) {
  const link = document.querySelector('[data-nav-report]');
  if (link) link.hidden = !visible;
}

function renderHud(engineState, progress) {
  const { completedRounds = 0, planTotal = 1 } = progress ?? {};
  const mode = engineState.mode ?? '—';
  // The multiplier comes from the engine's own state, which the session runner
  // sets before each mode starts.
  const multiplier = engineState.multiplier ?? state.pendingMultiplier ?? '—';
  $('hud-stage').textContent = mode === '—' ? '—' : modeLabel(mode);
  $('hud-mult').textContent = typeof multiplier === 'number' ? `${multiplier}×` : '—';
  $('hud-round').textContent = `${Math.min(engineState.roundIndex + 1, engineState.rounds)} / ${engineState.rounds}`;
  const done = Math.min(planTotal, completedRounds + engineState.roundIndex);
  $('hud-progress').textContent = `${done} / ${planTotal}`;
  $('round-bar').style.width = `${planTotal > 0 ? (done / planTotal) * 100 : 0}%`;
  $('stage-status').textContent = engineState.paused
    ? t('test.status.paused')
    : t('test.status.click');
  $('canvas-hint').hidden = Boolean(engineState.locked) && !engineState.paused;
}

async function startTest(plan, kind) {
  if (state.running) return;
  const settings = readSettings();
  if (!showErrors(validate(settings))) return;

  state.running = true;
  state.settings = settings;
  state.planKind = kind;
  state.session = null;
  state.rec = null;
  activeController = null;

  const label = planLabel(kind);

  $('report').hidden = true;
  $('test-intro').hidden = true;
  $('test-stage').hidden = false;
  $('canvas-hint').hidden = false;
  $('stage-status').textContent = t('test.status.lock', { label });

  try {
    const result = await runPlan($('stage'), plan, {
      onState: (engineState, progress) => renderHud(engineState, progress),
      onController: (c) => {
        activeController = c;
      },
      onStep: ({ step, completedRounds, planTotal }) => {
        $('stage-status').textContent = t('test.status.running', {
          mode: modeLabel(step.mode),
          mult: step.multiplier,
          done: completedRounds,
          total: planTotal,
        });
      },
    });

    state.session = { rounds: result.rounds, aborted: result.aborted, kind };
    if (result.rounds.length > 0) {
      setNavReportVisible(true);
      renderReport();
      persist();
    } else {
      $('test-intro').hidden = false;
      $('test-stage').hidden = true;
      $('stage-status').textContent = t('test.status.noRounds');
    }
  } catch (err) {
    // A thrown error here would otherwise leave the UI stuck in "testing".
    console.error('AimSense: test failed', err);
    $('test-intro').hidden = false;
    $('test-stage').hidden = true;
    $('stage-status').textContent = t('test.status.failed');
  } finally {
    state.running = false;
    activeController = null;
    $('test-stage').hidden = true;
    $('test-intro').hidden = false;
  }
}

/* -------------------------------- report -------------------------------- */

let lastRendered = null;

function renderReport() {
  const { rounds } = state.session;
  const settings = state.settings;
  const game = GAMES[settings.game] ?? GAMES.other;
  const currentCm = settings.sensitivity > 0
    ? cmPer360(settings.dpi, settings.sensitivity, game.yaw)
    : NaN;

  // Carry mode + multiplier through to scoring.
  const metrics = rounds.map((r) => ({ ...r }));

  const rec = recommend({ rounds: metrics });
  const applied = applyRecommendation(rec, settings, Number.isFinite(currentCm) ? currentCm : 30, game);
  state.rec = { ...rec, applied };
  lastRendered = { settings, game, metrics, rec, applied, currentCm };

  $('report').hidden = false;

  // verdict
  $('verdict-mult').textContent = `${rec.multiplier}×`;
  $('verdict-sub').textContent =
    Number.isFinite(applied.recommendedSensitivity) && settings.sensitivity > 0
      ? t('report.verdictWithSens', {
          sens: fmt(applied.recommendedSensitivity, 3),
          cm: fmt(applied.recommendedCm360, 2),
        })
      : Number.isFinite(currentCm)
        ? t('report.verdictCmOnly', { cm: fmt(applied.recommendedCm360, 2) })
        : t('report.verdictNoSens');

  // comparison
  $('cur-cm').textContent = Number.isFinite(currentCm) ? `${fmt(currentCm, 2)} cm` : '—';
  $('cur-sens').textContent = settings.sensitivity > 0 ? fmt(settings.sensitivity, 3) : '—';
  $('cur-edpi').textContent = settings.sensitivity > 0 ? fmt(edpi(settings.dpi, settings.sensitivity), 0) : '—';
  $('rec-cm').textContent = Number.isFinite(applied.recommendedCm360) ? `${fmt(applied.recommendedCm360, 2)} cm` : '—';
  $('rec-sens').textContent = Number.isFinite(applied.recommendedSensitivity)
    ? fmt(applied.recommendedSensitivity, 3)
    : '×' + fmt(rec.multiplier, 2);
  $('rec-edpi').textContent = Number.isFinite(applied.recommendedEdpi) ? fmt(applied.recommendedEdpi, 0) : '—';

  // explanation
  $('why-head').textContent = tr(rec.explanation.head);
  $('why-caveat').textContent =
    tr(rec.explanation.caveat) + (game.verified ? '' : ' ' + t('share.approxNote'));

  // charts
  drawCurve($('chart-curve'), { samples: rec.samples, recommended: rec.multiplier, fit: rec.fit });
  drawRadar($('chart-radar'), { modeScores: rec.modeScores });
  drawReaction($('chart-reaction'), { rounds: metrics });
  drawRadialError($('chart-radial-error'), { rounds: metrics });
  drawOnTarget($('chart-on-target'), { rounds: metrics });

  // table — one row per round, with per-mode columns.
  //
  // A single shared column set cannot work: track mode has no notion of
  // accuracy (it accumulates hold time and never increments `misses`, so
  // hits/hits always read a meaningless 100%), and it records no reaction
  // time. `summarize` reports NaN for both, and the table renders that as an
  // em dash rather than inventing a number.
  const tbody = $('round-table').querySelector('tbody');
  tbody.innerHTML = '';
  metrics.forEach((m) => {
    const tr = document.createElement('tr');
    const cells = [
      modeLabel(m.mode),
      `${m.sensitivityMultiplier}×`,
      Number.isFinite(m.accuracy) && m.attempts > 0
        ? `${pct(m.accuracy)} (${m.hits}/${m.attempts})`
        : '—',
      Number.isFinite(m.avgReactionMs) ? `${Math.round(m.avgReactionMs)} ms` : '—',
      m.radialErrorSamples > 0 ? `${m.avgRadialErrorPx.toFixed(1)} px` : '—',
      Number.isFinite(m.onTargetRatio) ? pct(m.onTargetRatio) : '—',
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i > 0) td.className = 'num';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  renderHistory();
}

/* -------------------------------- history ------------------------------- */

function persist() {
  const entry = {
    id: makeId(),
    at: new Date().toISOString(),
    settings: { ...state.settings },
    planKind: state.planKind ?? 'full',
    rounds: state.session.rounds,
  };
  const res = saveEntry(entry);
  if (!res.ok) {
    // Never block the report on storage: just say so.
    $('history-count').textContent = '0';
    const box = $('history-box');
    if (box) box.open = true;
    $('history-list').textContent =
      res.reason === 'quota' ? t('report.history.quota') : t('report.history.unavailable');
  }
}

function renderHistory() {
  const history = loadHistory();
  $('history-count').textContent = String(history.length);
  const list = $('history-list');
  list.innerHTML = '';
  if (history.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = t('report.history.empty');
    list.appendChild(p);
    return;
  }
  history.slice(0, 8).forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const left = document.createElement('span');
    const when = new Date(entry.at);
    // The stored entry keeps a `planKind`, not a rendered label, so switching
    // language re-renders old history rows in the new language too.
    const label = planLabel(entry.planKind ?? 'full');
    left.textContent = `${label} · ${when.toLocaleDateString()} ${when.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`;
    const meta = document.createElement('span');
    meta.className = 'history-item__meta';
    const n = entry.rounds.length;
    meta.textContent = t('report.history.rounds', { n, dpi: entry.settings?.dpi ?? '?' });
    row.append(left, meta);
    list.appendChild(row);
  });
}

/* --------------------------------- export ------------------------------- */

function buildShareText() {
  if (!lastRendered) return '';
  const { settings, game, rec, applied, currentCm, metrics } = lastRendered;
  const pad = (label) => label.padEnd(13);
  const lines = [
    t('share.title'),
    '──────────────────────────────────',
    `${pad(t('share.game'))}${gameLabel(settings.game)}`,
    `${pad(t('share.dpi'))}${settings.dpi}`,
    `${pad(t('share.sens'))}${settings.sensitivity > 0 ? ' ' + fmt(settings.sensitivity, 3) : ' ' + t('share.notProvided')}`,
    `${pad(t('share.current'))}${Number.isFinite(currentCm) ? fmt(currentCm, 2) + ' cm/360' : '—'}`,
    '',
    t('share.recommended', { mult: rec.multiplier }),
    Number.isFinite(applied.recommendedSensitivity)
      ? t('share.setSens', { sens: fmt(applied.recommendedSensitivity, 3) })
      : t('share.applyManually'),
    `  → ${fmt(applied.recommendedCm360, 2)} cm/360`,
    `${pad(t('share.confidence'))}${rec.confidence}`,
    '',
    t('share.scores'),
    ...rec.samples.map(([m, s]) => `  ${m}×  ${(s * 100).toFixed(1)}`),
    '',
    `${t('share.rounds')} ${metrics.length}`,
    '',
    tr(rec.explanation.head),
    tr(rec.explanation.caveat),
    '',
    t('share.footer'),
  ];
  return lines.join('\n');
}

async function copyResults() {
  const text = buildShareText();
  if (!text) return;
  const btn = $('copy-btn');
  const reset = () => {
    btn.textContent = t('report.copy');
  };
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = t('report.copied');
  } catch {
    // Clipboard API needs a secure context; fall back to a selectable textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy');
    document.body.removeChild(ta);
    btn.textContent = ok ? t('report.copied') : t('report.copyFailed');
  }
  setTimeout(reset, 1800);
}

function downloadJson() {
  const payload = {
    tool: 'AimSense',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    recommendation: state.rec
      ? {
          multiplier: state.rec.multiplier,
          method: state.rec.method,
          confidence: state.rec.confidence,
          samples: state.rec.samples,
          explanation: state.rec.explanation,
        }
      : null,
    rounds: state.session?.rounds ?? [],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aimsense-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* --------------------------------- init --------------------------------- */

function init() {
  applyI18n();
  $('year').textContent = String(new Date().getFullYear());

  // Language toggle: one button, labelled with the language it switches TO.
  $('lang-toggle').addEventListener('click', () => {
    toggleLocale();
  });

  // Re-render everything that carries text the i18n pass cannot reach: canvas
  // charts, the metrics table, the readout, and any stored history rows.
  onLocaleChange(() => {
    updateReadout();
    if (lastRendered) renderReport();
    renderHistory();
  });

  // Setup form wiring
  ['dpi', 'game', 'sens'].forEach((id) => {
    $(id).addEventListener('input', updateReadout);
    $(id).addEventListener('change', updateReadout);
  });
  updateReadout();

  $('game').addEventListener('change', () => {
    // Show what the current sensitivity would be in other games — the single
    // most useful cross-game fact, and free to compute.
    const s = readSettings();
    if (s.sensitivity > 0) {
      const values = Object.keys(GAMES)
        .filter((k) => k !== s.game && k !== 'other')
        .map((k) => `${gameLabel(k)} ${fmt(convertSensitivity(s.game, k, s.dpi, s.sensitivity), 3)}`);
      $('game-hint').textContent = t('setup.equivalent', { list: values.join(' · ') });
    }
  });

  // Touch detection: the test is meaningless without a mouse.
  if (window.matchMedia?.('(hover: none)').matches) {
    $('pointer-notice').hidden = false;
  }

  // Test controls
  $('start-btn').addEventListener('click', () => startTest(fullPlan(), 'full'));
  $('quick-btn').addEventListener('click', () => startTest(quickPlan(), 'quick'));
  $('abort-btn').addEventListener('click', () => {
    if (!activeController) return;
    if (window.confirm(t('test.abortConfirm'))) {
      activeController.abort();
    }
  });

  // Report controls
  $('copy-btn').addEventListener('click', copyResults);
  $('download-btn').addEventListener('click', downloadJson);
  $('retest-btn').addEventListener('click', () => {
    $('report').hidden = true;
    setNavReportVisible(false);
    $('test-intro').hidden = false;
    $('setup').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('clear-history').addEventListener('click', () => {
    if (window.confirm(t('report.history.clearConfirm'))) {
      clearHistory();
      renderHistory();
    }
  });

  renderHistory();

  // Redraw charts on theme change or resize so they are not left at the wrong
  // scale or in the wrong palette.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (lastRendered) renderReport();
    }, 180);
  });
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (lastRendered) renderReport();
  });

  // Expose a small debug surface so the test suite and screenshot tooling can
  // drive state without a bundler or a synthetic playthrough. Intentionally
  // limited to reading state and forcing a re-render.
  window.__aimsense = {
    state,
    scoreRound,
    SWEEP_MULTIPLIERS,
    totalRounds,
    renderReport,
    /** Inject a finished session (used by tests and screenshot capture). */
    setSession(rounds, settings, kind = 'full') {
      state.session = { rounds, aborted: false, kind };
      state.planKind = kind;
      if (settings) state.settings = settings;
      renderReport();
    },
  };
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
