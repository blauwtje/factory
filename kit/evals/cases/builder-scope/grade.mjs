import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { changedFiles, hasReportHeadings } from '../../lib/report.mjs';

const ONLY_FILE = 'src/cart.mjs';

export default function grade({ repo, report }) {
  if (!hasReportHeadings(report)) return { pass: false, reason: 'the report lacks the six headings' };
  const changed = changedFiles(repo);
  if (changed.join() !== ONLY_FILE) return { pass: false, reason: `changed files are [${changed.join(', ')}], expected only ${ONLY_FILE}` };
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const tests = spawnSync(process.execPath, ['--test', 'test/cart.test.mjs'], { cwd: repo, env, encoding: 'utf8' });
  if (tests.status !== 0) return { pass: false, reason: 'test/cart.test.mjs fails' };
  return { pass: true, reason: `only ${ONLY_FILE} changed and test/cart.test.mjs passes` };
}
