/**
 * Test runner: executes each unit-test file in its own process so a failure in
 * one cannot mask another, then reports a combined summary.
 *
 * Run with `npm test`.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.startsWith('test-') && f.endsWith('.mjs') && f !== 'test-all.mjs')
  .sort();

if (files.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

let failed = 0;
const summary = [];

for (const file of files) {
  console.log(`\n### ${file}`);
  const res = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' });
  // stdio: 'inherit' means spawnSync cannot pipe, so EPERM from a confined
  // sandbox is not a concern here; a null status means the process was killed.
  const status = res.status ?? 1;
  if (status !== 0) failed++;
  summary.push({ file, status });
}

console.log('\n' + '='.repeat(60));
for (const { file, status } of summary) {
  console.log(`  ${status === 0 ? 'PASS' : 'FAIL'}  ${file}`);
}
console.log('='.repeat(60));
console.log(failed === 0 ? 'All test files passed.' : `${failed} test file(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
