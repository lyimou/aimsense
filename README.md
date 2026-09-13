# AimSense — mouse sensitivity testing & recommendation

**Find your FPS sensitivity by measurement instead of guesswork.** AimSense runs three aim tests at three different sensitivities, scores them against each other, and fits a curve to recommend a sensitivity — with a visual report and the reasoning shown.

Live: **https://lyimou.github.io/aimsense/**

---

## Why it recommends a *multiplier*, not a number

There is no public benchmark for "good" aim sensitivity. A tool that prints `800 DPI @ 1.9` is really just printing someone else's preference.

AimSense compares you against **yourself**. It runs every test at **0.5×, 1.0× and 2.0×** of your current setting, then fits a quadratic to the three scores with least squares. The peak of that curve is the recommendation, expressed as a multiplier of what you already use. If the three scores are within a few points of each other, it says so and recommends **no change** — a confident number from flat data would be a lie.

## Features

| | |
| --- | --- |
| **Three test modes** | Flick (hit rate, reaction time, radial error), Track (time-on-target, deviation), Micro-adjust (accuracy, precision) |
| **Sensitivity sweep** | 0.5× / 1.0× / 2.0×, scored and curve-fitted |
| **Game-aware conversion** | cm/360 and eDPI for CS2, Valorant, Apex, Overwatch — plus cross-game equivalence |
| **Visual report** | Score-vs-sensitivity curve, per-mode radar, reaction time, radial error, time-on-target |
| **Explained recommendation** | States the method, the numbers behind it, and the confidence level |
| **Bilingual** | English and Traditional Chinese, switchable in the header; follows the browser on first visit, remembers an explicit choice |
| **Local history** | Last 20 tests in `localStorage`; nothing is uploaded |
| **Sharing** | Copy a text summary, or download the raw JSON |
| **Robust runs** | Pointer-lock loss, window blur and tab-hide all pause instead of scoring you unfairly |

### How a round is scored

Each mode normalises its metrics to 0–1 and combines them:

| Mode | Weighting |
| --- | --- |
| Flick | 70% hit rate + 18% speed + 12% precision |
| Track | 60% time-on-target + 40% steadiness |
| Micro-adjust | 70% accuracy + 30% precision |

**Precision is the mean radial error** — how far from the target centre the
crosshair was when the shot was taken (or how close it got before the target
expired). It is a distance, not a direction, so stopping short and flying past
cost exactly the same. This replaced an earlier "overshoot" metric that measured
`max(0, distance − radius)`, which was unsigned and floored at zero: a player who
undershot *every* target recorded a perfect zero and collected full marks on the
12%/30% precision term, while the documentation claimed both error directions
were penalised. See `scripts/test-metrics.mjs`.

### Languages

All user-visible text lives in `src/js/i18n-messages.js` — including the text
canvas charts draw for themselves. Nothing is compiled, so adding a string means
adding a key to both locales.

Resolution order for the initial language: a saved choice, then `?lang=` in the
URL, then the browser's language list. The URL is read but never written, so
switching does not add history entries. `scripts/test-i18n.mjs` asserts that both
locales carry the same key set, that `{placeholder}` sets match per key, and that
no key is referenced without being defined (or defined without being used).


## Running it

There is **no build step**. It is plain ES modules, so any static server works:

```bash
# from the project root
python -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly via `file://` also works, because there are no
`fetch()` calls and no bundler — but a local server is recommended so the modules
load with correct MIME types.

### Deploying to GitHub Pages

The included workflow publishes on every push to `main`:

1. Push this repository to GitHub.
2. **Settings → Pages → Source: GitHub Actions.**
3. The site appears at `https://<user>.github.io/<repo>/`.

No `base` path configuration is needed — all asset references are relative.

#### What actually gets published

The deploy does **not** upload the repository. `scripts/stage-deploy.mjs` stages a
deliberate allowlist into `_site/` and the workflow uploads only that:

```
index.html   favicon.svg   src/css/   src/js/
```

Everything else — the CI workflow, the test harness, `screenshots/`,
`package.json` — stays out of the published site, and the script fails the build
if a denylisted path reaches the output or if `index.html` references a file that
was not staged (which would otherwise be a 404 and a blank page in production).

**If you add a new asset file** (a new stylesheet, module or image), add its path
to `ALLOWLIST` in `scripts/stage-deploy.mjs`. The CI job runs the same check on
every push and pull request, so a forgotten entry fails fast rather than
silently breaking the live site.

## Tests

```bash
npm test              # unit tests (sensitivity maths + recommendation engine)
npm run test:all      # the above, plus syntax checks
```

The unit tests are plain Node — no framework, no install. They cover:

- **`scripts/test-sensitivity.mjs`** — cm/360 against known reference values,
  cross-game conversion round-trips, guard clauses, and the quadratic fit against
  exactly-generated parabolas.
- **`scripts/test-recommend.mjs`** — per-mode scoring **direction** for every
  metric, full dynamic range, monotonicity, and every branch of the decision tree
  (flat / parabola / edge / fallback).

### What the tests caught

They are worth writing about because two of the bugs they found were *silent* —
the code produced plausible output and nothing errored:

1. **An inverted scoring term.** One metric was normalised with
   `1 - lerpScore(...)` while `lerpScore` already mapped the good end to 1. The
   term contributed ~0 instead of its weight, which looked like a mis-calibrated
   tolerance rather than a sign error. Fixed, and now every metric's direction is
   asserted individually.
2. **A malformed normal-equations matrix.** Σx and the sample count were
   transposed, producing a curve whose peak was 1.25 where the exact answer was
   going to be 1.0. Caught by comparing the fit against a hand-computed parabola.

## Project structure

```
aimsense/
├── index.html              # all markup; no templating
├── favicon.svg
├── src/
│   ├── css/styles.css      # design tokens, dark-first with a light fallback
│   └── js/
│       ├── sensitivity.js  # cm/360, eDPI, cross-game conversion, curve fitting
│       ├── recommend.js    # scoring, sweep aggregation, recommendation + reasoning
│       ├── engine.js       # canvas engine, pointer lock, metrics collection
│       ├── session.js      # runs a plan (the sweep) step by step
│       ├── charts.js       # dependency-free canvas charts
│       ├── history.js      # localStorage persistence
│       └── main.js         # controller: form, run loop, report rendering
└── scripts/
    ├── test-sensitivity.mjs
    ├── test-recommend.mjs
    └── test-all.mjs
```

### Design notes

- **No dependencies at all** — not even a charting library. The five charts are
  ~300 lines of canvas, which keeps the tool working offline and means there is
  no third-party request on load.
- **The maths is separate from the DOM.** `sensitivity.js` and `recommend.js`
  import nothing from the browser, which is why they can be unit-tested in plain
  Node.
- **The engine is a canvas driver only.** Sequencing lives in `session.js`, so
  the test plan is a data structure that can change without touching the engine.

## Accuracy of the game constants

cm/360 is exact given a game's yaw constant, but one constant here could not be
verified against a primary source:

| Game | Yaw (deg/count at sens 1.0) | Status |
| --- | --- | --- |
| CS2 | 0.022 | verified |
| Valorant | 0.07 | verified |
| Apex Legends | 0.022 | verified |
| Overwatch 2 | 0.0066 | **approximate — unverified** |

The UI flags the unverified case, and the number is editable in one place
(`GAMES` in `src/js/sensitivity.js`).

## Limitations

- **Needs a mouse.** Touch input cannot express the movement this measures.
- **Small sample.** Three rounds per mode per sensitivity is enough to rank three
  points, not enough to detect a 2% difference. Warm-up, fatigue and sleep move
  the numbers more than a sensitivity change sometimes does.
- **In-test sensitivity is a multiplier**, not your real in-game setting. That is
  deliberate: it means no re-configuring between rounds, and the recommendation
  converts back to a real value at the end.

## Roadmap

- Online leaderboard (needs a backend — currently the tool is 100% static)
- Shareable result image
- Multi-language UI
- More games and editable yaw constants in the UI

## License

[MIT](LICENSE) — see the file for details.

## Author

Built by [Huang For Wa (lyimou)](https://github.com/lyimou), Computer Science
student at HKUST. Source: [github.com/lyimou/aimsense](https://github.com/lyimou/aimsense).
