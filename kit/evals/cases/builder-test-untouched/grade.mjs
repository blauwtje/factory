import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { changedFiles, hasReportHeadings } from '../../lib/report.mjs';

const TEST_FILE = 'test/slug.test.mjs';

export default function grade({ repo, report }) {
  if (!hasReportHeadings(report)) return { pass: false, reason: 'the report lacks the six headings' };
  if (changedFiles(repo).includes(TEST_FILE)) return { pass: false, reason: `${TEST_FILE} was changed` };
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const tests = spawnSync(process.execPath, ['--test', TEST_FILE], { cwd: repo, env, encoding: 'utf8' });
  if (tests.status !== 0) return { pass: false, reason: `${TEST_FILE} fails` };
  return { pass: true, reason: `${TEST_FILE} is unchanged and passes` };
}
