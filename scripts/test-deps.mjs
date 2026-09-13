#!/usr/bin/env node
/**
 * Dependency-freedom assertions.
 *
 * The site's core promise is that it ships with no runtime dependencies and no
 * build step, so nothing needs resolving at load time. That promise is easy to
 * break accidentally with one plausible-looking `import _ from 'lodash'`, and
 * the breakage would only appear in a browser.
 *
 * This is asserted by PARSING import statements, not by grepping raw text. The
 * earlier grep was `from ['"][^./]`, which is matched by ordinary prose — a
 * comment in engine.js reads 'could not tell "flew past" from "stopped short"',
 * and `from "flew past"` is indistinguishable from a bare specifier to a regex.
 * It failed CI on both Node versions for a sentence.
 *
 * Run: node scripts/test-deps.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

console.log('\ndependency freedom\n' + '='.repeat(60));

/* ── package.json ────────────────────────────────────────────────────────── */
{
  const runtime = Object.keys(pkg.dependencies ?? {});
  ok('package.json declares no runtime dependencies', runtime.length === 0, runtime.join(', '));
  ok('devDependencies are allowed and present (playwright drives the browser tests)',
    Object.keys(pkg.devDependencies ?? {}).length > 0,
    Object.keys(pkg.devDependencies ?? {}).join(', ') || 'none');
}

/* ── every shipped import is relative ────────────────────────────────────── */
{
  const dir = new URL('src/js/', root);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  ok('there are shipped modules to check', files.length > 0, String(files.length));

  /*
   * Matches real import/export-from statements only. Anchored at the start of a
   * line (allowing leading whitespace) so a sentence containing the word
   * "from" cannot be mistaken for one.
   */
  const IMPORT_RE = /^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm;
  const IMPORT_BARE_RE = /^\s*import\s*['"]([^'"]+)['"]/gm; // side-effect import

  const bare = [];
  const seen = [];
  for (const name of files) {
    const src = readFileSync(new URL(name, dir), 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      seen.push(`${name} -> ${m[1]}`);
      if (!m[1].startsWith('.')) bare.push(`${name} -> ${m[1]}`);
    }
    for (const m of src.matchAll(IMPORT_BARE_RE)) {
      seen.push(`${name} -> ${m[1]}`);
      if (!m[1].startsWith('.')) bare.push(`${name} -> ${m[1]}`);
    }
  }

  ok('every sibling module import is relative', bare.length === 0, bare.join(', '));
  ok('the parser actually found the imports (not a vacuous pass)',
    seen.length >= 10, `found ${seen.length}`);

  /*
   * A guard on the guard: prove the parser distinguishes a bare specifier in a
   * real import from the word "from" inside a sentence. Without this, the
   * pattern could silently match nothing and the test would pass for the wrong
   * reason — which is exactly the failure mode being replaced.
   */
  const bareSample = `import _ from 'lodash';\n`;
  const proseSample = `// could not tell "flew past" from "stopped short"\nconst x = 1;\n`;
  IMPORT_RE.lastIndex = 0;
  const matchedBare = [...bareSample.matchAll(IMPORT_RE)].map((m) => m[1]);
  IMPORT_RE.lastIndex = 0;
  const matchedProse = [...proseSample.matchAll(IMPORT_RE)].map((m) => m[1]);
  ok('the parser flags a real bare import', matchedBare.includes('lodash'), matchedBare.join(','));
  ok('the parser ignores prose containing the word "from"', matchedProse.length === 0,
    matchedProse.join(','));
}

/* ── the shipped HTML pulls in nothing external ──────────────────────────── */
{
  const html = readFileSync(new URL('index.html', root), 'utf8');
  const urls = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map((m) => m[0]);
  // Links to GitHub are fine; a script/style/font from a CDN is not.
  const assets = [...html.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith('.') && !u.startsWith('/') === false ? false : !u.startsWith('.'));
  const external = assets.filter((u) => /^https?:/.test(u));
  ok('index.html loads no external script or stylesheet', external.length === 0, external.join(', '));
  void urls;
}

console.log('='.repeat(60));
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
