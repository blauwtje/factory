import { spawnSync } from 'node:child_process';
import process from 'node:process';

const kitRoot = new URL('../', import.meta.url);
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const { status } = spawnSync(
  process.execPath,
  ['--import', './tests/clean-run-env.mjs', '--test', '--test-concurrency=2', 'tests/*.test.mjs'],
  { cwd: kitRoot, env, stdio: 'inherit' }
);
process.exit(status ?? 1);
