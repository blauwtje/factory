import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from './harness.mjs';

const KIT = fileURLToPath(new URL('../', import.meta.url));
const RUNNER = path.join(KIT, 'evals', 'run.mjs');
const FAKE = path.join(KIT, 'tests', 'fake-claude.mjs');
const CASES = path.join(KIT, 'tests', 'fixtures', 'eval-smoke');
const RESULTS = path.join(KIT, 'evals', 'results');

function evalRun(args, extraEnv = {}) {
  const home = tempDir();
  const env = { ...process.env, HOME: home, USERPROFILE: home, FACTORY_CLAUDE_BIN: FAKE, FAKE_CLAUDE_CASE: path.join(CASES, 'smoke'), ...extraEnv };
  return spawnSync(process.execPath, [RUNNER, '--cases', CASES, ...args], { env, encoding: 'utf8' });
}

function newResults(before) {
  return fs.readdirSync(RESULTS).filter((name) => !before.includes(name));
}

function withResults(body) {
  const before = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS) : [];
  try {
    return body(before);
  } finally {
    if (fs.existsSync(RESULTS)) for (const name of newResults(before)) fs.rmSync(path.join(RESULTS, name));
  }
}

test('lists the case ids', () => {
  const { stdout, status } = evalRun(['--list']);
  assert.equal(status, 0);
  assert.equal(stdout, 'smoke\n');
});

test('counts every run that the grader passes', () => withResults((before) => {
  const { stdout, status } = evalRun(['--runs', '2'], { FAKE_CLAUDE_MODE: 'pass' });
  assert.equal(status, 0);
  assert.equal(stdout, 'smoke 2/2\ntotal 2/2\n');
  const [file] = newResults(before);
  const saved = JSON.parse(fs.readFileSync(path.join(RESULTS, file), 'utf8'));
  assert.deepEqual(saved.cases.smoke, { passes: 2, runs: 2, reasons: ['a.txt says two', 'a.txt says two'] });
}));

test('counts a run that the grader fails with its reason', () => withResults(() => {
  const { stdout } = evalRun(['--runs', '2'], { FAKE_CLAUDE_MODE: 'fail' });
  assert.equal(stdout, 'smoke 0/2\n  run 1: a.txt says "three\\n"\n  run 2: a.txt says "three\\n"\ntotal 0/2\n');
}));

test('counts a non-zero claude exit as a fail with its reason', () => withResults(() => {
  const { stdout } = evalRun(['--runs', '1'], { FAKE_CLAUDE_MODE: 'exit1' });
  assert.match(stdout, /^smoke 0\/1\n {2}run 1: claude exit 1: fake claude failed\n/);
}));

test('counts a run whose result is not a string as a fail and goes on', () => withResults(() => {
  const { stdout, status } = evalRun(['--runs', '2'], { FAKE_CLAUDE_MODE: 'noresult' });
  assert.equal(status, 0);
  assert.match(stdout, /^smoke 0\/2\n {2}run 1: .+\n {2}run 2: .+\ntotal 0\/2\n$/);
}));

test('counts a run that passes the timeout as a fail', () => withResults(() => {
  const { stdout } = evalRun(['--runs', '1'], { FAKE_CLAUDE_MODE: 'hang', FACTORY_EVAL_TIMEOUT_MS: '300' });
  assert.match(stdout, /^smoke 0\/1\n {2}run 1: timeout after 300 ms\n/);
}));

test('starts claude in a fresh one-commit repository with the role defaults and no key', () => withResults(() => {
  const log = path.join(tempDir(), 'claude.log');
  evalRun(['--runs', '2'], { FAKE_CLAUDE_MODE: 'pass', FAKE_CLAUDE_LOG: log, ANTHROPIC_API_KEY: 'secret' });
  const [first, second] = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.notEqual(first.cwd, second.cwd);
  assert.equal(first.commits, 1);
  assert.equal(first.apiKey, null);
  const args = first.args;
  assert.equal(args[args.indexOf('--model') + 1], 'claude-sonnet-5-5');
  assert.equal(args[args.indexOf('--effort') + 1], 'medium');
  assert.equal(args[args.indexOf('--agent') + 1], 'factory:builder');
  assert.equal(args[args.indexOf('--settings') + 1], '{"outputStyle":"Concise"}');
  assert.equal(args[args.indexOf('--plugin-dir') + 1], KIT.replace(/\/$/, ''));
  assert.equal(args[args.indexOf('-p') + 1], 'Change a.txt to say two.');
}));

test('--model and --effort override the role defaults', () => withResults(() => {
  const log = path.join(tempDir(), 'claude.log');
  evalRun(['--runs', '1', '--model', 'm1', '--effort', 'low'], { FAKE_CLAUDE_MODE: 'pass', FAKE_CLAUDE_LOG: log });
  const { args } = JSON.parse(fs.readFileSync(log, 'utf8'));
  assert.equal(args[args.indexOf('--model') + 1], 'm1');
  assert.equal(args[args.indexOf('--effort') + 1], 'low');
}));

test('--compare shows the old count', () => withResults((before) => {
  evalRun(['--runs', '2'], { FAKE_CLAUDE_MODE: 'fail' });
  const [file] = newResults(before);
  const { stdout } = evalRun(['--runs', '2', '--compare', path.join(RESULTS, file)], { FAKE_CLAUDE_MODE: 'pass' });
  assert.equal(stdout, 'smoke 2/2 (was 0/2)\ntotal 2/2 (was 0/2)\n');
}));

test('a missing FACTORY_CLAUDE_BIN is a hard error', () => withResults(() => {
  const { status, stderr } = evalRun(['--runs', '1'], { FAKE_CLAUDE_MODE: 'pass', FACTORY_CLAUDE_BIN: '/nonexistent/claude' });
  assert.notEqual(status, 0);
  assert.match(stderr, /FACTORY_CLAUDE_BIN=\/nonexistent\/claude/);
}));

test('an unknown case is a usage error', () => {
  const { status, stderr } = evalRun(['--case', 'nope']);
  assert.equal(status, 2);
  assert.match(stderr, /no case 'nope'/);
});
