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
import { drawCurve, drawRadar, drawReaction, drawOvershoot, drawOnTarget } from './charts.js';

const $ = (id) => document.getElementById(id);

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
    errors.dpi = 'Enter a DPI between 50 and 32000.';
  }
  if (settings.sensitivity !== 0 && (!Number.isFinite(settings.sensitivity) || settings.sensitivity <= 0)) {
    errors.sens = 'Sensitivity must be a positive number, or left blank.';
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
    $('out-band').textContent = sensitivityBand(cm).label;
    $('out-conversion').textContent = `Yaw constant ${game.yaw}°/count for ${game.label}.`;
  } else {
    $('out-cm').textContent = '—';
    $('out-edpi').textContent = '—';
    $('out-band').textContent = '—';
    $('out-conversion').textContent = settings.sensitivity
      ? ''
      : 'Add your in-game sensitivity to see exact figures.';
  }

  hint.textContent = game.verified
    ? 'Conversion constant verified for this game.'
    : 'Conversion constant for this game is approximate — treat cm/360 as an estimate.';
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
  $('hud-stage').textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  $('hud-mult').textContent = typeof multiplier === 'number' ? `${multiplier}×` : '—';
  $('hud-round').textContent = `${Math.min(engineState.roundIndex + 1, engineState.rounds)} / ${engineState.rounds}`;
  const done = Math.min(planTotal, completedRounds + engineState.roundIndex);
  $('hud-progress').textContent = `${done} / ${planTotal}`;
  $('round-bar').style.width = `${planTotal > 0 ? (done / planTotal) * 100 : 0}%`;
  $('stage-status').textContent = engineState.paused
    ? 'Paused — click the test area to resume.'
    : 'Click the test area to lock the mouse. Press Esc to release.';
  $('canvas-hint').hidden = Boolean(engineState.locked) && !engineState.paused;
}

async function startTest(plan, label) {
  if (state.running) return;
  const settings = readSettings();
  if (!showErrors(validate(settings))) return;

  state.running = true;
  state.settings = settings;
  state.session = null;
  state.rec = null;
  activeController = null;

  $('report').hidden = true;
  $('test-intro').hidden = true;
  $('test-stage').hidden = false;
  $('canvas-hint').hidden = false;
  $('stage-status').textContent = `${label}: click the test area to lock the mouse.`;

  try {
    const result = await runPlan($('stage'), plan, {
      onState: (engineState, progress) => renderHud(engineState, progress),
      onController: (c) => {
        activeController = c;
      },
      onStep: ({ step, completedRounds, planTotal }) => {
        $('stage-status').textContent = `${step.mode} at ${step.multiplier}× — ${completedRounds}/${planTotal} rounds done.`;
      },
    });

    state.session = { rounds: result.rounds, aborted: result.aborted, label };
    if (result.rounds.length > 0) {
      setNavReportVisible(true);
      renderReport();
      persist();
    } else {
      $('test-intro').hidden = false;
      $('test-stage').hidden = true;
      $('stage-status').textContent = 'No rounds completed.';
    }
  } catch (err) {
    // A thrown error here would otherwise leave the UI stuck in "testing".
    console.error('AimSense: test failed', err);
    $('test-intro').hidden = false;
    $('test-stage').hidden = true;
    $('stage-status').textContent = 'Something went wrong running the test. Reload and try again.';
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
      ? `Set your in-game sensitivity to ${fmt(applied.recommendedSensitivity, 3)} · ${fmt(applied.recommendedCm360, 2)} cm/360`
      : Number.isFinite(currentCm)
        ? `${fmt(applied.recommendedCm360, 2)} cm/360`
        : 'Add your in-game sensitivity in setup for exact figures.';

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
  $('why-head').textContent = rec.explanation.head;
  $('why-caveat').textContent =
    rec.explanation.caveat + (game.verified ? '' : ' (Game conversion is approximate.)');

  // charts
  drawCurve($('chart-curve'), { samples: rec.samples, recommended: rec.multiplier, fit: rec.fit });
  drawRadar($('chart-radar'), { modeScores: rec.modeScores });
  drawReaction($('chart-reaction'), { rounds: metrics });
  drawOvershoot($('chart-overshoot'), { rounds: metrics });
  drawOnTarget($('chart-on-target'), { rounds: metrics });

  // table
  const tbody = $('round-table').querySelector('tbody');
  tbody.innerHTML = '';
  metrics.forEach((m) => {
    const tr = document.createElement('tr');
    const cells = [
      m.mode,
      `${m.sensitivityMultiplier}×`,
      m.attempts > 0 ? `${pct(m.accuracy)} (${m.hits}/${m.attempts})` : '—',
      Number.isFinite(m.avgReactionMs) ? `${Math.round(m.avgReactionMs)} ms` : '—',
      Number.isFinite(m.avgOvershootPx) ? `${m.avgOvershootPx.toFixed(1)} px` : '—',
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
    label: state.session.label,
    rounds: state.session.rounds,
  };
  const res = saveEntry(entry);
  if (!res.ok) {
    // Never block the report on storage: just say so.
    $('history-count').textContent = '0';
    const box = $('history-box');
    if (box) box.open = true;
    $('history-list').textContent =
      res.reason === 'quota'
        ? 'Could not save: browser storage is full.'
        : 'Could not save: browser storage is unavailable (private mode?).';
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
    p.textContent = 'No saved tests yet.';
    list.appendChild(p);
    return;
  }
  history.slice(0, 8).forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'history-item';
    const left = document.createElement('span');
    const when = new Date(entry.at);
    left.textContent = `${entry.label ?? 'test'} · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const meta = document.createElement('span');
    meta.className = 'history-item__meta';
    const n = entry.rounds.length;
    meta.textContent = `${n} rounds · ${entry.settings?.dpi ?? '?'} DPI`;
    row.append(left, meta);
    list.appendChild(row);
  });
}

/* --------------------------------- export ------------------------------- */

function buildShareText() {
  if (!lastRendered) return '';
  const { settings, game, rec, applied, currentCm, metrics } = lastRendered;
  const lines = [
    'AimSense — sensitivity test result',
    '──────────────────────────────────',
    `Game:        ${game.label}`,
    `DPI:         ${settings.dpi}`,
    `In-game sens:${settings.sensitivity > 0 ? ' ' + fmt(settings.sensitivity, 3) : ' not provided'}`,
    `Current:     ${Number.isFinite(currentCm) ? fmt(currentCm, 2) + ' cm/360' : '—'}`,
    '',
    `RECOMMENDED: ${rec.multiplier}× your current sensitivity`,
    Number.isFinite(applied.recommendedSensitivity)
      ? `  → set in-game sens to ${fmt(applied.recommendedSensitivity, 3)}`
      : '  → (in-game sens not provided, apply the multiplier manually)',
    `  → ${fmt(applied.recommendedCm360, 2)} cm/360`,
    `Confidence:  ${rec.confidence}`,
    '',
    'Scores by sensitivity (0–100):',
    ...rec.samples.map(([m, s]) => `  ${m}×  ${(s * 100).toFixed(1)}`),
    '',
    `Rounds played: ${metrics.length}`,
    '',
    rec.explanation.head,
    rec.explanation.caveat,
    '',
    'Tested with AimSense — https://lyimou.github.io/aimsense/',
  ];
  return lines.join('\n');
}

async function copyResults() {
  const text = buildShareText();
  if (!text) return;
  const btn = $('copy-btn');
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
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
    btn.textContent = ok ? 'Copied' : 'Copy failed';
  }
  setTimeout(() => {
    btn.textContent = 'Copy results';
  }, 1800);
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
  $('year').textContent = String(new Date().getFullYear());

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
        .map((k) => `${GAMES[k].label} ${fmt(convertSensitivity(s.game, k, s.dpi, s.sensitivity), 3)}`);
      $('game-hint').textContent = `Equivalent: ${values.join(' · ')}`;
    }
  });

  // Touch detection: the test is meaningless without a mouse.
  if (window.matchMedia?.('(hover: none)').matches) {
    $('pointer-notice').hidden = false;
  }

  // Test controls
  $('start-btn').addEventListener('click', () => startTest(fullPlan(), 'Full sweep'));
  $('quick-btn').addEventListener('click', () => startTest(quickPlan(), 'Quick test'));
  $('abort-btn').addEventListener('click', () => {
    if (!activeController) return;
    if (window.confirm('Abort the test? This round will not be scored.')) {
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
    if (window.confirm('Delete all saved tests on this device?')) {
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
    setSession(rounds, settings, label = 'Full sweep') {
      state.session = { rounds, aborted: false, label };
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
