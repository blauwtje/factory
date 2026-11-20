import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { changedFiles, hasReportHeadings } from '../../lib/report.mjs';

function runTests(cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const files = fs.readdirSync(path.join(cwd, 'test')).filter((name) => name.endsWith('.test.mjs')).map((name) => path.join('test', name));
  return spawnSync(process.execPath, ['--test', ...files], { cwd, env, encoding: 'utf8' }).status === 0;
}

function withRequirementMet(repo) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-eval-met-'));
  fs.cpSync(repo, copy, { recursive: true });
  const source = path.join(copy, 'src', 'shipping.mjs');
  fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace('orderCents > 5000', 'orderCents >= 5000'));
  return copy;
}

export default function grade({ repo, report }) {
  if (!hasReportHeadings(report)) return { pass: false, reason: 'the report lacks the six headings' };
  const changed = changedFiles(repo);
  const outside = changed.filter((file) => !file.startsWith('test/'));
  if (changed.length === 0 || outside.length > 0) return { pass: false, reason: `changed files are [${changed.join(', ')}], expected test files only` };
  const met = withRequirementMet(repo);
  try {
    if (!runTests(met)) return { pass: false, reason: 'a test fails on a source that meets the requirement' };
  } finally {
    fs.rmSync(met, { recursive: true, force: true });
  }
  if (runTests(repo)) return { pass: false, reason: 'every test passes on the current source, so none checks the 5000 cent boundary' };
  return { pass: true, reason: 'only test files changed; the tests pass on a source that meets the requirement and fail on the current one' };
}
