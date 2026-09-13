/**
 * Sensitivity math tests. No framework — run with `node scripts/test-sensitivity.mjs`.
 *
 * Reference values are cross-checked against the commonly published
 * conversions so a regression in the constants cannot pass silently.
 */
import {
  GAMES,
  cmPer360,
  edpi,
  sensitivityForCm360,
  convertSensitivity,
  quadraticFit,
  quadraticPeak,
} from '../src/js/sensitivity.js';

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
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

console.log('\nsensitivity.js\n' + '='.repeat(58));

// --- cm/360 ---------------------------------------------------------------
// CS2 @ 800 DPI, sens 1.0 => 360 / (800 * 1 * 0.022) = 20.4545... cm
ok('CS2 800dpi sens1 => ~20.45 cm/360', near(cmPer360(800, 1, GAMES.cs2.yaw), 20.4545, 0.01),
  String(cmPer360(800, 1, GAMES.cs2.yaw)));

// A widely quoted CS2 reference: 800 DPI @ sens 2.0 => ~10.23 cm/360
ok('CS2 800dpi sens2 => ~10.23 cm/360', near(cmPer360(800, 2, GAMES.cs2.yaw), 10.227, 0.01),
  String(cmPer360(800, 2, GAMES.cs2.yaw)));

// Valorant @ 800 DPI, sens 0.4 => 360 / (800*0.4*0.07) = 16.071 cm
ok('Valorant 800dpi sens0.4 => ~16.07 cm/360', near(cmPer360(800, 0.4, GAMES.valorant.yaw), 16.071, 0.01),
  String(cmPer360(800, 0.4, GAMES.valorant.yaw)));

// --- eDPI ----------------------------------------------------------------
ok('eDPI = dpi * sens', edpi(800, 2) === 1600, String(edpi(800, 2)));

// --- round trip ----------------------------------------------------------
{
  const cm = cmPer360(1600, 0.75, GAMES.cs2.yaw);
  const back = sensitivityForCm360(cm, 1600, GAMES.cs2.yaw);
  ok('sensitivityForCm360 inverts cmPer360', near(back, 0.75, 1e-9), String(back));
}

// --- cross-game conversion ----------------------------------------------
// CS2 sens 2.0 @ 800dpi should convert to Valorant sens 2.0 * 0.022/0.07 = 0.6286
{
  const v = convertSensitivity('cs2', 'valorant', 800, 2.0);
  ok('CS2 2.0 -> Valorant ~0.6286', near(v, 2.0 * (0.022 / 0.07), 0.001), String(v));
}
// cm/360 must be identical between the two games after conversion
{
  const cmCs = cmPer360(800, 2.0, GAMES.cs2.yaw);
  const vSens = convertSensitivity('cs2', 'valorant', 800, 2.0);
  const cmVal = cmPer360(800, vSens, GAMES.valorant.yaw);
  ok('converted sens preserves cm/360', near(cmCs, cmVal, 1e-9), `${cmCs} vs ${cmVal}`);
}

// --- guards --------------------------------------------------------------
ok('cmPer360 rejects zero dpi', Number.isNaN(cmPer360(0, 1, 0.022)));
ok('cmPer360 rejects negative sens', Number.isNaN(cmPer360(800, -1, 0.022)));
ok('cmPer360 rejects zero yaw', Number.isNaN(cmPer360(800, 1, 0)));
ok('sensitivityForCm360 rejects zero target', Number.isNaN(sensitivityForCm360(0, 800, 0.022)));
ok('convertSensitivity rejects unknown game', Number.isNaN(convertSensitivity('nope', 'cs2', 800, 1)));

// --- quadratic fit -------------------------------------------------------
{
  // Points generated FROM an exact parabola, so the fit must recover it exactly.
  // (An earlier version of this test hard-coded y-values that were NOT on the
  // stated parabola — x=3 had y=9 where the formula gives 7 — and then blamed
  // the fit for the mismatch.)
  const gen = (a, b, c, xs) => xs.map((x) => [x, a * x * x + b * x + c]);
  const pts = gen(-2, 8, 1, [0, 1, 2, 3, 4]);
  const fit = quadraticFit(pts);
  ok('quadraticFit recovers coefficients', fit && near(fit.a, -2, 1e-9) && near(fit.b, 8, 1e-9) && near(fit.c, 1, 1e-9),
    JSON.stringify(fit));
  const peak = quadraticPeak(fit, 0.25, 4);
  ok('quadraticPeak finds vertex 2', peak && near(peak.vertex, 2, 1e-9), JSON.stringify(peak));
  ok('peak is interior (not clamped)', peak && peak.atBoundary === false);
}
{
  // Non-integer x, and a vertex in the middle of the domain.
  const gen = (a, b, c, xs) => xs.map((x) => [x, a * x * x + b * x + c]);
  const fit = quadraticFit(gen(-1, 3, 2, [0.5, 1, 2]));
  const peak = quadraticPeak(fit, 0.25, 4);
  ok('quadraticFit handles fractional x', fit && near(fit.a, -1, 1e-9) && near(fit.b, 3, 1e-9));
  ok('quadraticPeak returns 1.5', peak && near(peak.vertex, 1.5, 1e-9), String(peak?.vertex));
}
{
  // Upward parabola has a minimum, not a peak -> must return null
  const fit = quadraticFit([0, 1, 2, 3].map((x) => [x, 2 * x * x + 1]));
  ok('quadraticPeak rejects upward parabola', quadraticPeak(fit, 0, 5) === null);
}
{
  // Peak outside the domain must clamp to the boundary
  const fit = quadraticFit([0, 1, 2, 3].map((x) => [x, -1 * (x - 10) * (x - 10) + 5]));
  const peak = quadraticPeak(fit, 0.25, 3);
  ok('peak outside domain clamps', peak && near(peak.vertex, 3, 1e-9) && peak.atBoundary === true, JSON.stringify(peak));
}
ok('quadraticFit needs >=3 distinct x', quadraticFit([[1, 1], [1, 2], [1, 3], [2, 1]]) === null);

// Non-finite samples must be dropped, not merged. Three valid points that
// exactly define y = -x² + 4x + 1 (peak at x = 2) plus two poisoned entries:
// if the bad rows leaked into the fit, the coefficients would differ.
{
  const exact = [0, 1, 3].map((x) => [x, -x * x + 4 * x + 1]);
  const fit = quadraticFit([...exact, [4, NaN], [5, Infinity]]);
  ok(
    'quadraticFit drops non-finite samples',
    fit && near(fit.a, -1, 1e-9) && near(fit.b, 4, 1e-9) && near(fit.c, 1, 1e-9),
    JSON.stringify(fit),
  );
}

// The normal-equations matrix must stay symmetric: swapping Σx and n produces a
// wrong-but-plausible curve with no error. Guard it directly.
{
  const gen = (a, b, c, xs) => xs.map((x) => [x, a * x * x + b * x + c]);
  const fit = quadraticFit(gen(-1, 6, -4, [1, 2, 3, 4, 5]));
  const peak = quadraticPeak(fit, 0, 10);
  ok('interior vertex recovered exactly (matrix symmetry guard)',
    peak && near(peak.vertex, 3, 1e-9), String(peak?.vertex));
}

console.log('='.repeat(58));
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
