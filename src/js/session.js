/**
 * Session runner — turns a plan into a sequence of engine runs.
 *
 * The engine can only run one mode at a time, so the sweep is a plain sequential
 * loop that awaits each step. Keeping the orchestration here (rather than inside
 * the engine) means the engine stays a dumb canvas driver and the test plan is a
 * data structure that can be changed without touching it.
 */
import { TestEngine } from './engine.js';
import { SWEEP_MULTIPLIERS } from './recommend.js';

/** Rounds per mode per sensitivity. */
export const ROUNDS_PER_STEP = 3;

/** Full sweep: every mode at every multiplier. */
export function fullPlan() {
  const steps = [];
  for (const multiplier of SWEEP_MULTIPLIERS) {
    for (const mode of ['flick', 'track', 'micro']) {
      steps.push({ mode, multiplier, rounds: ROUNDS_PER_STEP });
    }
  }
  return steps;
}

/** Quick test: flick only, but still swept, so a recommendation is possible. */
export function quickPlan() {
  return SWEEP_MULTIPLIERS.map((multiplier) => ({
    mode: 'flick',
    multiplier,
    rounds: 2,
  }));
}

export function totalRounds(plan) {
  return plan.reduce((sum, step) => sum + step.rounds, 0);
}

/**
 * Run a plan end to end.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array} plan
 * @param {{ onStep?: Function, onState?: Function, onRound?: Function }} hooks
 * @returns {Promise<{ rounds: Array, aborted: boolean }>}
 */
export async function runPlan(canvas, plan, hooks = {}) {
  const { onController } = hooks;
  const planTotal = totalRounds(plan);
  let completedRounds = 0;
  let aborted = false;
  const rounds = [];

  // One engine for the whole session: reusing it keeps the listeners and the
  // canvas sized, and crosshair position carries over between modes.
  const engine = new TestEngine(canvas, {
    onRoundEnd: (metrics) => {
      completedRounds++;
      rounds.push(metrics);
      hooks.onRound?.(metrics, { completedRounds, planTotal });
    },
    onStateChange: (engineState) => hooks.onState?.(engineState, { completedRounds, planTotal }),
    onAbort: () => {
      aborted = true;
    },
  });

  // Lets the caller abort from outside without reaching into the engine.
  const controller = { abort: () => engine.abort(), engine };
  onController?.(controller);

  try {
    for (let i = 0; i < plan.length; i++) {
      if (aborted) break;
      const step = plan[i];
      hooks.onStep?.({ step, index: i, count: plan.length, completedRounds, planTotal });
      // eslint-disable-next-line no-await-in-loop -- rounds are inherently sequential
      await engine.start(step.mode, {
        rounds: step.rounds,
        sensitivityMultiplier: step.multiplier,
      });
      // A stopped engine means abort or a fatal lock loss: do not continue.
      if (aborted || !engine.running) {
        aborted = aborted || engine.roundIndex < step.rounds;
        break;
      }
    }
  } finally {
    engine.destroy();
  }

  return { rounds, aborted: aborted || rounds.length < planTotal };
}
