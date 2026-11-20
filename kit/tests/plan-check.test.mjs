import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { planCheckReport } from '../skills/spec/scripts/plan-check.mjs';

const example = fs.readFileSync('skills/spec/references/example-plan.md', 'utf8');

test('the example plan passes the plan check', () => {
  const report = planCheckReport(example);
  assert.equal(report.ok, true, report.lines.join('\n'));
});

test('a task without Proof and an open point are named', () => {
  const broken = example.replace(' | Proof: npm test -- task.test', '').replace('## Tasks', '## Open points\n- which locale?\n\n## Tasks');
  const report = planCheckReport(broken);
  assert.equal(report.ok, false);
  assert.match(report.lines.join('\n'), /Task 1 lacks 'Proof:'/);
  assert.match(report.lines.join('\n'), /Open points/);
});

function problemsOf(planText) {
  const report = planCheckReport(planText);
  assert.equal(report.ok, false, report.lines.join('\n'));
  return report.lines.join('\n');
}

test('a task needs Data, and a bare none needs its reason', () => {
  assert.match(problemsOf(example.replace(' | Data: `task.dueDate: string` (ISO-8601), read by Task 3', '')), /Task 1 lacks 'Data:'/);
  assert.match(problemsOf(example.replace('Data: `task.dueDate: string` (ISO-8601), read by Task 3', 'Data: none')), /Task 1 lacks 'Data:'/);
  const deleted = example.replace('Data: `task.dueDate: string` (ISO-8601), read by Task 3', 'Data: none (deletes dead code)');
  assert.equal(planCheckReport(deleted).ok, true);
});

test('two tasks listing one file need a Depends on path', () => {
  const shared = example.replace('`src/tasks/due-tone.js`,', '`src/tasks/due-tone.js`, `src/tasks/task.js`,');
  assert.match(problemsOf(shared), /Task 1 and Task 2 both list 'src\/tasks\/task.js'/);
});

test('a folder in one task and a file inside it in another need a Depends on path', () => {
  const folder = example.replace('`src/tasks/due-tone.js`,', '`src/tasks/`,');
  assert.match(problemsOf(folder), /Task 1 and Task 2 both list 'src\/tasks\/' with no 'Depends on:' path/);
  const reversed = example.replace('`src/tasks/task.js`,', '`src/tasks/`,').replace('`src/tasks/due-tone.js`,', '`src/tasks/task.js`,');
  assert.match(problemsOf(reversed), /Task 1 and Task 2 both list 'src\/tasks\/' with no 'Depends on:' path/);
});

test('an Acceptance item that cites nothing is named', () => {
  const vague = example.replace('- Task 3 renders one badge per task row.', '- Badges look right.');
  assert.match(problemsOf(vague), /Acceptance item 'Badges look right.'/);
  const cited = example.replace('- Task 3 renders one badge per task row.', '- `task.dueDate` holds an ISO-8601 string.');
  assert.equal(planCheckReport(cited).ok, true);
});

test('a Files path in a folder that does not exist warns once', () => {
  const report = planCheckReport(example.replace('Repository: /repo', `Repository: ${process.cwd()}`));
  assert.equal(report.ok, true, report.lines.join('\n'));
  assert.equal(report.lines.filter((line) => /folder of 'src\/tasks\/task.js' does not exist/.test(line)).length, 1);
  assert.equal(report.lines.filter((line) => /does not exist/.test(line)).length, 1);
});

test('a Data reader that does not depend on the task is named', () => {
  const unlinked = example.replace('Depends on: 1, 2 |', 'Depends on: 2 |');
  assert.match(problemsOf(unlinked), /Task 1 says 'read by Task 3' but Task 3 does not depend on Task 1/);
});

test('a Files path that git ignores is a problem', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-check-ignored-'));
  execFileSync('git', ['-C', repo, 'init', '-q']);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'src/tasks/\n');
  const report = planCheckReport(example.replace('Repository: /repo', `Repository: ${repo}`));
  assert.equal(report.ok, false);
  assert.match(report.lines.join('\n'), /Task 1: 'src\/tasks\/task.js' is ignored by git, so the task cannot land/);
});

test('a task listing more than five files warns with its count and still passes', () => {
  const six = example.replace('`src/tasks/task-row.test.jsx`', '`src/tasks/a.js`, `src/tasks/b.js`, `src/tasks/c.js`, `src/tasks/task-row.test.jsx`');
  const report = planCheckReport(six);
  assert.equal(report.ok, true, report.lines.join('\n'));
  assert.ok(report.lines.includes('[WARN] Task 3 lists 6 files, more than 5; split it'));
  assert.equal(report.lines.filter((line) => /lists \d+ files/.test(line)).length, 1);
  assert.equal(planCheckReport(example).lines.some((line) => /lists \d+ files/.test(line)), false);
});

function repoWith(packageJson) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-check-product-'));
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify(packageJson));
  return repo;
}

test('a repo with scripts.start needs a Success criterion that runs the app or says Product run: none', () => {
  const repo = repoWith({ scripts: { start: 'node app.js' } });
  const plan = example.replace('Repository: /repo', `Repository: ${repo}`);
  assert.match(problemsOf(plan), /the repository has 'bin' or 'scripts.start' but the Success criterion neither runs the app nor says 'Product run: none \(<reason>\)'/);
  assert.equal(planCheckReport(plan.replace('`npm test` passes.', '`npm test && npm start` passes.')).ok, true);
  assert.equal(planCheckReport(plan.replace('`npm test` passes.', '`npm test` passes.\nProduct run: none (a library)')).ok, true);
});

test('a bin name or bin path in the Success criterion counts as running the app', () => {
  const objectBin = example.replace('Repository: /repo', `Repository: ${repoWith({ bin: { tool: 'bin/tool.js' } })}`);
  assert.match(problemsOf(objectBin), /neither runs the app/);
  assert.equal(planCheckReport(objectBin.replace('`npm test` passes.', '`npx tool --help` passes.')).ok, true);
  const stringBin = example.replace('Repository: /repo', `Repository: ${repoWith({ name: 'cli', bin: 'bin/cli.js' })}`);
  assert.equal(planCheckReport(stringBin.replace('`npm test` passes.', '`node bin/cli.js` passes.')).ok, true);
  assert.equal(planCheckReport(stringBin.replace('`npm test` passes.', '`cli run` passes.')).ok, true);
});

test('a bin name inside a file path or prose does not count as running the app', () => {
  const plan = example.replace('Repository: /repo', `Repository: ${repoWith({ name: 'tasker', bin: 'bin/tasker.js' })}`);
  assert.match(problemsOf(plan.replace('`npm test` passes.', '`npm test -- tests/tasker-format.test.js` passes.')), /neither runs the app/);
  assert.match(problemsOf(plan.replace('`npm test` passes.', '`npm test` passes.\nRed: none (npm start is not needed)')), /neither runs the app/);
});

test('a repo with neither bin nor scripts.start is not checked', () => {
  const plan = example.replace('Repository: /repo', `Repository: ${repoWith({ scripts: { test: 'node --test' } })}`);
  assert.equal(planCheckReport(plan).ok, true);
});
