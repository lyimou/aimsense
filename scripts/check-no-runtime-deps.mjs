#!/usr/bin/env node
/**
 * Assert the shipped site has no runtime dependencies.
 *
 * This lives in a file rather than inline in the workflow on purpose. The
 * previous version was embedded JavaScript inside a YAML `run:` block, so it
 * went through YAML, then bash, then node — three layers of quoting — and the
 * `require('./package.json')` inside double quotes did not survive them. It
 * failed identically on both Node versions, which is what a quoting problem
 * looks like rather than a logic problem.
 *
 * The check itself is: `dependencies` must be empty. `devDependencies` is fine
 * and expected (playwright drives the browser tests), which is exactly the
 * distinction the original `grep '"dependencies"'` got wrong — that pattern
 * matches `"devDependencies"` too, so it reported a failure on a package that
 * correctly has zero runtime dependencies.
 *
 * Exit code: 0 when clean, 1 when a runtime dependency is declared.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const runtime = Object.keys(pkg.dependencies ?? {});
const dev = Object.keys(pkg.devDependencies ?? {});

if (runtime.length > 0) {
  console.error(`::error::package.json declares runtime dependencies: ${runtime.join(', ')}`);
  process.exit(1);
}

console.log(`no runtime dependencies declared (devDependencies: ${dev.join(', ') || 'none'})`);

/*
 * The shipped modules must also import nothing but relative paths. A bare
 * specifier such as `import x from 'lodash'` would fail at runtime in the
 * browser with no build step to resolve it, and there is no bundler here.
 */
const srcDir = fileURLToPath(new URL('../src/js/', import.meta.url));
const bare = [];
for (const name of (await import('node:fs')).readdirSync(srcDir)) {
  if (!name.endsWith('.js')) continue;
  const src = readFileSync(`${srcDir}${name}`, 'utf8');
  for (const m of src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
    if (!m[1].startsWith('.')) bare.push(`${name}: ${m[1]}`);
  }
}

if (bare.length > 0) {
  console.error(`::error::src/js imports bare module specifiers: ${bare.join(', ')}`);
  process.exit(1);
}
console.log('all src/js imports are relative');
