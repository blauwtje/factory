import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { commitFiles, compactPlanFixture, compactTask, git, gitRepository } from './harness.mjs';
import { nextTaskReport } from '../skills/build/scripts/next-task.mjs';
import { landingCheckout, PLAN } from './land-task-fixture.mjs';

const RELATIVE_PLAN = 'docs/plans/fixture.md';

function report(root) {
  return nextTaskReport({ planText: PLAN, planPath: path.join(root, RELATIVE_PLAN), root });
}

test('next-task counts every task as open when none has landed', async () => {
  const { root } = await landingCheckout();
  assert.match(report(root), /^Landed: none\nTasks: 0 of 2 landed; open: 1, 4\n/);
});

test('next-task counts a landed task and lists the one still open', async () => {
  const { root } = await landingCheckout();
  git(root, 'commit', '-q', '--allow-empty', '-m', 'feat(app): greet', '-m', 'Plan-task: fixture/1');
  assert.match(report(root), /^Landed: 1\nTasks: 1 of 2 landed; open: 4\n/);
});

test('next-task prints a stub path with a non-ASCII character unquoted', async () => {
  const { root } = await landingCheckout();
  await commitFiles(root, { 'src/café.js': '// TODO: say hello\n' }, 'feat(app): greet\n\nPlan-task: fixture/1');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'feat(app): two files', '-m', 'Plan-task: fixture/4');
  assert.match(report(root), /\nStub: Task 1 src\/café\.js:1 /);
});

test('next-task prints open: none once every task has landed', async () => {
  const { root } = await landingCheckout();
  git(root, 'commit', '-q', '--allow-empty', '-m', 'feat(app): greet', '-m', 'Plan-task: fixture/1');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'feat(app): two files', '-m', 'Plan-task: fixture/4');
  assert.match(report(root), /^Landed: 1, 4\nTasks: 2 of 2 landed; open: none\nNext: none\nUntouched: Task 1 src\/app\.js\nUntouched: Task 4 src\/app\.js\nUntouched: Task 4 src\/note\.md\n$/);
});

test('next-task lists a stub marker a landed task added, but not one in a test file', async () => {
  const { root } = await landingCheckout();
  await commitFiles(root, {
    'src/app.js': 'export function greet() {\n  // TODO: say hello\n}\n',
    'tests/app.test.js': '// TODO: cover greet\n'
  }, 'feat(app): greet\n\nPlan-task: fixture/1');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'feat(app): two files', '-m', 'Plan-task: fixture/4');
  assert.match(report(root), /\nNext: none\nStub: Task 1 src\/app\.js:2 \/\/ TODO: say hello\nUntouched: Task 4 src\/app\.js\nUntouched: Task 4 src\/note\.md\n$/);
});

test('next-task counts a Files folder and every commit of a task when it lists untouched paths', async () => {
  const plan = compactPlanFixture({ tasks: [
    compactTask({ number: 1, title: 'feat(app): split', files: ['src/', 'docs/guide.md', 'docs/notes.md'] })
  ] });
  const root = await gitRepository({ 'docs/plans/fixture.md': plan });
  await commitFiles(root, { 'src/lib/split.js': 'export const split = 1;\n' }, 'feat(app): split\n\nPlan-task: fixture/1');
  await commitFiles(root, { 'docs/guide.md': '# Guide\n' }, 'feat(app): split\n\nPlan-task: fixture/1');
  const text = nextTaskReport({ planText: plan, planPath: path.join(root, RELATIVE_PLAN), root });
  assert.match(text, /\nNext: none\nUntouched: Task 1 docs\/notes\.md\n$/);
});
