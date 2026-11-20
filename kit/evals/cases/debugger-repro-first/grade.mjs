import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { hasReportHeadings } from '../../lib/report.mjs';

function runTests(cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const files = fs.readdirSync(path.join(cwd, 'test')).filter((name) => name.endsWith('.test.mjs')).map((name) => path.join('test', name));
  return spawnSync(process.execPath, ['--test', ...files], { cwd, env, encoding: 'utf8' }).status === 0;
}

function chunkOutput(repo) {
  const module = pathToFileURL(path.join(repo, 'src', 'chunk.mjs')).href;
  const script = `import { chunk } from '${module}'; process.stdout.write(JSON.stringify(chunk([1, 2, 3, 4, 5], 2)));`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' }).stdout;
}

function withOriginalSource(repo) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-eval-original-'));
  fs.cpSync(repo, copy, { recursive: true });
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
  spawnSync('git', ['checkout', 'HEAD', '--', 'src'], { cwd: copy, env });
  return copy;
}

export default function grade({ repo, report }) {
  if (!hasReportHeadings(report)) return { pass: false, reason: 'the report lacks the six headings' };
  const output = chunkOutput(repo);
  if (output !== '[[1,2],[3,4],[5]]') return { pass: false, reason: `chunk([1, 2, 3, 4, 5], 2) returns ${output || 'nothing'}, expected [[1,2],[3,4],[5]]` };
  if (!runTests(repo)) return { pass: false, reason: 'the suite fails after the fix' };
  const original = withOriginalSource(repo);
  try {
    if (runTests(original)) return { pass: false, reason: 'the suite passes on the original source, so no test reproduces the symptom' };
  } finally {
    fs.rmSync(original, { recursive: true, force: true });
  }
  return { pass: true, reason: 'the fix works and a kept test fails on the original source' };
}
