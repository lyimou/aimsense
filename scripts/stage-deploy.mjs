#!/usr/bin/env node
/**
 * Stage exactly the files that belong on the deployed website.
 *
 * Why this exists
 * ---------------
 * The deploy workflow used to upload `path: .` — the whole repository. That
 * publishes things no visitor should download and that leak repository
 * internals:
 *
 *   .github/workflows/ci.yml    internal CI definition
 *   scripts/*.mjs               test + verification harness
 *   screenshots/*.png           ~1 MB of dev screenshots
 *   package-lock.json           ~200 KB lockfile
 *   README.md, LICENSE          repo furniture, not site content
 *
 * Worse, the browser-verification scripts write local artifacts
 * (verify-report.json, test-results/, playwright-report/). None of those are
 * tracked by git, so a plain `git clean` check would not catch them — a stray
 * local run would have shipped them to the public site.
 *
 * So this stages an explicit ALLOWLIST: the site is what the browser actually
 * requests, and nothing else. Adding a new asset means adding it here, which
 * is the point — the deploy surface stays deliberately small and auditable.
 *
 * Usage:
 *   node scripts/stage-deploy.mjs           # stage into _site/
 *   node scripts/stage-deploy.mjs --check   # stage and validate, then exit
 */

import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '_site');

/**
 * The complete set of paths published to the web.
 *
 * index.html  -> the app
 * favicon.svg -> browser tab icon
 * src/css     -> stylesheets
 * src/js      -> the ES modules the page imports
 * 404.html    -> optional; served for unknown paths under the /aimsense/ subpath
 */
const ALLOWLIST = [
  'index.html',
  'favicon.svg',
  'src/css',
  'src/js',
];

/** Files that must never appear in the deployed output, whatever else changes. */
const DENYLIST_PATTERNS = [
  /^\./,                    // dotfiles: .github, .gitignore, ...
  /^scripts\//,
  /^screenshots\//,
  /^node_modules\//,
  /^test-results\//,
  /^playwright-report\//,
  /\.mjs$/,
  /^package(-lock)?\.json$/,
  /^README\.md$/i,
  /^LICENSE$/i,
];

async function walk(dir, base = dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, base, acc);
    } else {
      acc.push(relative(base, full).split(sep).join(posix.sep));
    }
  }
  return acc;
}

function fail(message) {
  console.error(`\n  FAIL  ${message}\n`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------- stage

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const missing = [];
for (const rel of ALLOWLIST) {
  const from = join(ROOT, rel);
  if (!existsSync(from)) {
    missing.push(rel);
    continue;
  }
  const to = join(OUT, rel);
  await mkdir(join(to, '..'), { recursive: true });
  await cp(from, to, { recursive: true });
}

if (missing.length) {
  fail(`allowlisted path(s) not found: ${missing.join(', ')}`);
}

// ---------------------------------------------------------------- validate

const staged = (await walk(OUT)).sort();
const bytes = {};
let total = 0;
for (const rel of staged) {
  const s = await stat(join(OUT, rel));
  bytes[rel] = s.size;
  total += s.size;
}

console.log(`\n  staged ${staged.length} files, ${(total / 1024).toFixed(1)} KB total\n`);
for (const rel of staged) {
  console.log(`    ${String((bytes[rel] / 1024).toFixed(1)).padStart(8)} KB  ${rel}`);
}

for (const rel of staged) {
  const hit = DENYLIST_PATTERNS.find((re) => re.test(rel));
  if (hit) fail(`denylisted file reached the deploy output: ${rel}`);
}

if (!staged.includes('index.html')) fail('index.html is missing from the deploy output');

// The entry module is the one file whose absence would leave a page that loads
// and then does nothing. Assert it by name rather than inferring it from the
// reference walk below, which would pass on an empty allowlist.
if (!staged.includes('src/js/main.js')) fail('src/js/main.js is missing from the deploy output');

// A deployed page that references a file we did not stage is a 404 in
// production and a blank screen. Assert the reverse mapping too.
const html = await (await import('node:fs/promises')).readFile(join(OUT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|#|mailto:|\/\/)/.test(u));

for (const ref of refs) {
  const clean = ref.replace(/^\.\//, '').split('?')[0].split('#')[0];
  if (!clean) continue;
  if (!existsSync(join(OUT, clean))) {
    fail(`index.html references "${ref}" which is not in the deploy output`);
  }
}

if (!process.exitCode) {
  console.log(`\n  deploy output is clean (${refs.length} local references all resolve)\n`);
}
