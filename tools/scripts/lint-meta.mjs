import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * Raw-SQL ban meta-gate (spec Cap 3 "Raw-SQL ban enforced in CI", task 1.5).
 *
 * Runs ESLint with eslint.meta.config.mjs over two fixtures:
 *   - clean.fixture.ts     must PASS  (rule does not over-fire)
 *   - violation.fixture.ts must FAIL (rule catches `$queryRaw`)
 * Exits non-zero unless both expectations hold.
 */

const CASES = [
  { file: 'apps/api/test/lint-ban/clean.fixture.ts', mustFail: false },
  { file: 'apps/api/test/lint-ban/violation.fixture.ts', mustFail: true },
];

let allGood = true;

for (const { file, mustFail } of CASES) {
  const res = spawnSync(`pnpm exec eslint "${file}" --config eslint.meta.config.mjs`, {
    shell: true,
    encoding: 'utf8',
  });
  const failed = res.status !== 0;
  const expected = failed === mustFail;
  const verdict = expected ? 'OK' : 'UNEXPECTED';
  console.log(`[lint:meta] ${verdict} ${file} -> exit=${res.status} (mustFail=${mustFail})`);
  if (!expected) {
    allGood = false;
    if (res.stdout) console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);
  }
}

if (allGood) {
  console.log('[lint:meta] raw-SQL ban proven: clean passes, violation fails.');
  process.exit(0);
}

console.error('[lint:meta] FAILED — the raw-SQL ban is not behaving as specified.');
process.exit(1);
