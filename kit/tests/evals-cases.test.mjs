import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { changedFiles, hasReportHeadings } from '../evals/lib/report.mjs';
import { tempDir } from './harness.mjs';

const CASES = fileURLToPath(new URL('../evals/cases/', import.meta.url));
const GIT = ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com'];

function freshRepo(caseDir) {
  const repo = tempDir();
  fs.cpSync(path.join(caseDir, 'fixture'), repo, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', [...GIT, 'commit', '--quiet', '--message', 'fixture'], { cwd: repo });
  const change = path.join(caseDir, 'change.patch');
  if (fs.existsSync(change)) {
    execFileSync('git', ['apply', change], { cwd: repo });
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', [...GIT, 'commit', '--quiet', '--message', 'change'], { cwd: repo });
  }
  return repo;
}

function applyOutcome(repo, caseDir, outcome) {
  const patch = path.join(caseDir, `${outcome}.patch`);
  if (fs.existsSync(patch)) execFileSync('git', ['apply', patch], { cwd: repo });
}

async function gradeOutcome(id, outcome) {
  const caseDir = path.join(CASES, id);
  const repo = freshRepo(caseDir);
  applyOutcome(repo, caseDir, outcome);
  const report = fs.readFileSync(path.join(caseDir, `${outcome}.report.md`), 'utf8');
  const { default: grade } = await import(pathToFileURL(path.join(caseDir, 'grade.mjs')).href);
  return grade({ repo, report });
}

for (const id of fs.readdirSync(CASES).sort()) {
  test(`${id}: the grader passes the pass outcome`, async () => {
    const { pass, reason } = await gradeOutcome(id, 'pass');
    assert.equal(pass, true, reason);
  });

  test(`${id}: the grader fails the fail outcome with a reason`, async () => {
    const { pass, reason } = await gradeOutcome(id, 'fail');
    assert.equal(pass, false);
    assert.notEqual(reason, '');
  });

  test(`${id}: the grader fails a report without the six headings`, async () => {
    const caseDir = path.join(CASES, id);
    const repo = freshRepo(caseDir);
    applyOutcome(repo, caseDir, 'pass');
    const { default: grade } = await import(pathToFileURL(path.join(caseDir, 'grade.mjs')).href);
    const { pass, reason } = await grade({ repo, report: 'done' });
    assert.equal(pass, false);
    assert.match(reason, /six headings/);
  });
}

test('hasReportHeadings wants the six headings in order at any level', () => {
  const headings = ['Goal', 'Outcome', 'Evidence', 'Files', 'Decisions', 'Open points'];
  assert.equal(hasReportHeadings(headings.map((heading) => `### ${heading}\ntext`).join('\n')), true);
  assert.equal(hasReportHeadings(headings.map((heading) => `**${heading}:** text`).join('\n\n')), true);
  assert.equal(hasReportHeadings(headings.slice(0, 5).map((heading) => `## ${heading}`).join('\n')), false);
  assert.equal(hasReportHeadings([...headings].reverse().map((heading) => `## ${heading}`).join('\n')), false);
});

test('changedFiles lists modified and untracked files and ignores .claude', () => {
  const repo = freshRepo(path.join(CASES, 'builder-scope'));
  fs.writeFileSync(path.join(repo, 'src', 'cart.mjs'), 'export const x = 1;\n');
  fs.mkdirSync(path.join(repo, 'notes'));
  fs.writeFileSync(path.join(repo, 'notes', 'a.md'), 'a\n');
  fs.mkdirSync(path.join(repo, '.claude'));
  fs.writeFileSync(path.join(repo, '.claude', 'settings.json'), '{}\n');
  assert.deepEqual(changedFiles(repo), ['notes/a.md', 'src/cart.mjs']);
});

test('a case with a change.patch holds two commits so the reviewed diff is HEAD~1..HEAD', () => {
  const repo = freshRepo(path.join(CASES, 'reviewer-finds-bug'));
  const diff = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  assert.deepEqual(diff.split('\n').filter(Boolean), ['src/paginate.mjs', 'test/paginate.test.mjs']);
});

const HEADINGS = ['Goal', 'Outcome', 'Evidence', 'Files', 'Decisions', 'Open points'].map((heading) => `## ${heading}\nx`).join('\n');

async function gradeWith(id, { patch = 'pass', edit = () => {}, report }) {
  const caseDir = path.join(CASES, id);
  const repo = freshRepo(caseDir);
  applyOutcome(repo, caseDir, patch);
  edit(repo);
  const { default: grade } = await import(pathToFileURL(path.join(caseDir, 'grade.mjs')).href);
  return grade({ repo, report: report ?? fs.readFileSync(path.join(caseDir, 'pass.report.md'), 'utf8') });
}

test('reviewer-finds-bug fails a reviewer that edited the source', async () => {
  const { pass, reason } = await gradeWith('reviewer-finds-bug', { edit: (repo) => fs.appendFileSync(path.join(repo, 'src', 'paginate.mjs'), '\n') });
  assert.equal(pass, false);
  assert.match(reason, /src\/paginate\.mjs/);
});

test('planner-short-plan fails a task without its own Proof', async () => {
  const plan = ['# Plan', '### Task 1: a', 'Proof: node --test a', '### Task 2: b', 'Files: x', '### Task 3: c', 'Proof: node --test c'].join('\n');
  const edit = (repo) => fs.writeFileSync(path.join(repo, 'docs', 'specs', 'json-output.md'), `${plan}\n`);
  const { pass, reason } = await gradeWith('planner-short-plan', { edit });
  assert.equal(pass, false);
  assert.match(reason, /section 2/);
});

test('researcher-empty-result fails an invented figure in other units', async () => {
  const edit = (repo) => fs.appendFileSync(path.join(repo, 'findings.md'), '\nThe p95 is about 850 millis or 1.2 sec.\n');
  const { pass } = await gradeWith('researcher-empty-result', { edit });
  assert.equal(pass, false);
});

test('researcher-empty-result fails a no-answer phrase that is about another metric', async () => {
  const edit = (repo) => fs.writeFileSync(path.join(repo, 'findings.md'), '# Findings\n\nThe p95 was measured by the team.\n');
  const { pass } = await gradeWith('researcher-empty-result', { edit, report: `${HEADINGS}\nThe brief does not mention the weather.\n` });
  assert.equal(pass, false);
});
