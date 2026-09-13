/**
 * Sensitivity mathematics.
 *
 * The universal currency here is **cm/360** — how many centimetres of mouse
 * movement produce a full 360° turn in game. It is comparable across games and
 * across DPI settings, which is why everything else is derived from it.
 *
 *   cm/360 = 360 / (DPI × in-game sensitivity × yaw)
 *
 * `yaw` is the degrees of rotation per mouse count at sensitivity 1.0. Each
 * game publishes this as a fixed constant, so the conversion is exact — no
 * empirical fitting involved.
 */

/**
 * Degrees of rotation per mouse count at in-game sensitivity 1.0.
 *
 * VALUE CONFIDENCE — read before trusting a number:
 *   cs2 / valorant / apex : well established and widely verified.
 *   overwatch             : commonly quoted as 0.0066, but this could not be
 *                           verified against a primary source here. Treat the
 *                           Overwatch conversion as approximate.
 */
export const GAMES = {
  cs2: { label: 'CS2', yaw: 0.022, verified: true },
  valorant: { label: 'Valorant', yaw: 0.07, verified: true },
  apex: { label: 'Apex Legends', yaw: 0.022, verified: true },
  overwatch: { label: 'Overwatch 2', yaw: 0.0066, verified: false },
  other: { label: 'Other / unknown', yaw: 0.022, verified: false },
};

export const DEFAULT_DPI = 800;

/** cm of mouse travel for a full 360° turn. */
export function cmPer360(dpi, sensitivity, yaw) {
  const denom = dpi * sensitivity * yaw;
  if (!Number.isFinite(denom) || denom <= 0) return NaN;
  return 360 / denom;
}

/** Effective dots per inch: DPI × in-game sensitivity. */
export function edpi(dpi, sensitivity) {
  if (!Number.isFinite(dpi) || !Number.isFinite(sensitivity)) return NaN;
  return dpi * sensitivity;
}

/** In-game sensitivity needed to reach a target cm/360 at a given DPI and game. */
export function sensitivityForCm360(targetCm, dpi, yaw) {
  if (!Number.isFinite(targetCm) || targetCm <= 0) return NaN;
  return 360 / (dpi * yaw * targetCm);
}

/** cm/360 between two games at equal DPI (converts a sens from one game to another). */
export function convertSensitivity(fromGame, toGame, dpi, sensitivity) {
  const from = GAMES[fromGame];
  const to = GAMES[toGame];
  if (!from || !to) return NaN;
  const cm = cmPer360(dpi, sensitivity, from.yaw);
  return sensitivityForCm360(cm, dpi, to.yaw);
}

/** Human-readable band, used for the "faster / slower than typical" hint. */
export function sensitivityBand(cm) {
  if (!Number.isFinite(cm)) return { key: 'unknown', label: 'unknown' };
  if (cm < 15) return { key: 'very-high', label: 'very high (low cm/360)' };
  if (cm < 25) return { key: 'high', label: 'high' };
  if (cm < 40) return { key: 'medium', label: 'medium' };
  if (cm < 60) return { key: 'low', label: 'low' };
  return { key: 'very-low', label: 'very low (high cm/360)' };
}

/**
 * Least-squares fit of y = a·x² + b·x + c over (x, y) samples.
 * Returns null when there are too few distinct x values to fit a curve.
 *
 * Verified against exact parabolas in scripts/test-sensitivity.mjs:
 *   points on y = -2x² + 8x + 1 must yield a peak of exactly x = 2.
 */
export function quadraticFit(samples) {
  const pts = samples.filter((s) => Number.isFinite(s[0]) && Number.isFinite(s[1]));
  const distinctX = new Set(pts.map((p) => p[0]));
  if (pts.length < 3 || distinctX.size < 3) return null;

  let Sx = 0;
  let Sx2 = 0;
  let Sx3 = 0;
  let Sx4 = 0;
  let Sy = 0;
  let Sxy = 0;
  let Sx2y = 0;
  for (const [x, y] of pts) {
    const x2 = x * x;
    Sx += x;
    Sx2 += x2;
    Sx3 += x2 * x;
    Sx4 += x2 * x2;
    Sy += y;
    Sxy += x * y;
    Sx2y += x2 * y;
  }
  const n = pts.length;

  /*
   * Normal equations, in the same row order as the unknowns [a, b, c]:
   *
   *   Σx⁴·a + Σx³·b + Σx²·c = Σx²y
   *   Σx³·a + Σx²·b + Σx ·c = Σxy
   *   Σx²·a + Σx ·b + n  ·c = Σy
   *
   * The matrix is symmetric, which is the easiest way to sanity-check it: [1][2]
   * and [2][1] must both be Σx, and [2][2] must be the sample count. An earlier
   * version had Σx and n transposed, producing a wrong-but-plausible curve
   * (peak 1.25 where the exact answer was 1.0) without raising any error.
   */
  const m = [
    [Sx4, Sx3, Sx2],
    [Sx3, Sx2, Sx],
    [Sx2, Sx, n],
  ];
  const rhs = [Sx2y, Sxy, Sy];

  const det3 = (a) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);

  const D = det3(m);
  if (Math.abs(D) < 1e-12) return null;

  const replaceCol = (col) => m.map((row, i) => row.map((val, j) => (j === col ? rhs[i] : val)));
  return {
    a: det3(replaceCol(0)) / D,
    b: det3(replaceCol(1)) / D,
    c: det3(replaceCol(2)) / D,
  };
}

/**
 * Peak of a fitted quadratic on a closed interval.
 * Returns null when the fit is not a downward parabola (a >= 0), because a
 * minimum or a line has no meaningful "best sensitivity" peak.
 */
export function quadraticPeak(fit, min, max) {
  if (!fit || !(fit.a < 0)) return null;
  const vertex = -fit.b / (2 * fit.a);
  const clamped = Math.min(max, Math.max(min, vertex));
  return { vertex: clamped, atBoundary: clamped !== vertex };
}
