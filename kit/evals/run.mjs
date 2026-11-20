import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseFlags, UsageError, USAGE_EXIT, POSITIVE_INTEGER, environmentMs, isMain } from '#script-flags';

const KIT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_CASES = path.join(KIT_ROOT, 'evals', 'cases');
const RESULTS = path.join(KIT_ROOT, 'evals', 'results');
const DEFAULT_RUNS = 3;
const ROLE_DEFAULT = 'role default';
const TIMEOUT_MS = 15 * 60 * 1000;
const REMOVED_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
const ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'Bash(node:*)', 'Bash(npm:*)', 'Bash(git:*)'];
const FLAGS = { cases: 'string', case: 'string', runs: 'string', model: 'string', effort: 'string', compare: 'string', list: 'boolean' };
const USAGE = 'usage: node kit/evals/run.mjs [--cases <dir>] [--case <id>] [--runs <n>] [--model <m>] [--effort <e>] [--compare <file>] [--list]';

function isolatedGitEnv() {
  return { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
}

function git(repo, args) {
  const result = spawnSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args], { cwd: repo, env: isolatedGitEnv(), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${repo}: ${result.stderr}`);
}

function isFile(file) {
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

export function findClaude(env = process.env) {
  const configured = env.FACTORY_CLAUDE_BIN;
  if (configured !== undefined) {
    if (!isFile(configured)) throw new Error(`claude not found: FACTORY_CLAUDE_BIN=${configured}`);
    return configured;
  }
  const installed = path.join(env.HOME ?? env.USERPROFILE ?? os.homedir(), '.local', 'bin', 'claude');
  const onPath = (env.PATH ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, 'claude'));
  const found = [installed, ...onPath].find(isFile);
  if (found === undefined) throw new Error('claude not found in ~/.local/bin and PATH');
  return found;
}

function roleDefaults(role) {
  const config = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'config.json'), 'utf8'));
  const row = Object.values(config.models).find((entry) => entry.role === role);
  if (row === undefined) throw new Error(`no row for role '${role}' in kit/config.json`);
  return row;
}

export function listCases(casesDir) {
  return fs.readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isFile(path.join(casesDir, entry.name, 'case.json')))
    .map((entry) => entry.name)
    .sort();
}

function claudeArgs({ prompt, role, model, effort }) {
  return ['-p', prompt, '--plugin-dir', KIT_ROOT.replace(/[\\/]$/, ''), '--agent', `factory:${role}`, '--settings', '{"outputStyle":"Concise"}', '--model', model, '--effort', effort, '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED_TOOLS];
}

function claudeEnv() {
  const env = { ...process.env };
  for (const name of REMOVED_VARS) delete env[name];
  return env;
}

function failure(result, timeoutMs) {
  if (result.error?.code === 'ETIMEDOUT') return `timeout after ${timeoutMs} ms`;
  if (result.error) return `claude did not start: ${result.error.message}`;
  if (result.status !== 0) return `claude exit ${result.status}: ${result.stderr.trim().slice(-300)}`;
  return null;
}

async function runOnce({ caseDir, spec, grade, claude, model, effort }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-eval-'));
  try {
    fs.cpSync(path.join(caseDir, 'fixture'), repo, { recursive: true });
    git(repo, ['init', '--quiet']);
    git(repo, ['add', '--all']);
    git(repo, ['commit', '--quiet', '--message', 'fixture']);
    const change = path.join(caseDir, 'change.patch');
    if (isFile(change)) {
      git(repo, ['apply', change]);
      git(repo, ['add', '--all']);
      git(repo, ['commit', '--quiet', '--message', 'change']);
    }
    const timeoutMs = environmentMs('FACTORY_EVAL_TIMEOUT_MS', TIMEOUT_MS);
    const result = spawnSync(claude, claudeArgs({ ...spec, model, effort }), { cwd: repo, env: claudeEnv(), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
    const reason = failure(result, timeoutMs);
    if (reason !== null) return { pass: false, reason };
    let report;
    try {
      report = JSON.parse(result.stdout).result;
    } catch {
      return { pass: false, reason: `claude output is not JSON: ${result.stdout.slice(0, 200)}` };
    }
    try {
      return await grade({ repo, report });
    } catch (error) {
      return { pass: false, reason: `grader threw: ${error.message}` };
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

export async function runCase({ casesDir, id, runs, model, effort, claude }) {
  const caseDir = path.join(casesDir, id);
  const spec = JSON.parse(fs.readFileSync(path.join(caseDir, 'case.json'), 'utf8'));
  const { default: grade } = await import(pathToFileURL(path.join(caseDir, 'grade.mjs')).href);
  const defaults = model === undefined || effort === undefined ? roleDefaults(spec.role) : null;
  const outcomes = [];
  for (let run = 0; run < runs; run += 1) {
    outcomes.push(await runOnce({ caseDir, spec, grade, claude, model: model ?? defaults.model, effort: effort ?? defaults.effort }));
  }
  return { passes: outcomes.filter((outcome) => outcome.pass).length, runs, reasons: outcomes.map((outcome) => outcome.reason) };
}

function selectCases(casesDir, only) {
  const ids = listCases(casesDir);
  if (only === undefined) return ids;
  if (!ids.includes(only)) throw new UsageError(`no case '${only}' in ${casesDir}; known: ${ids.join(', ')}`);
  return [only];
}

function reportLines(cases, previous) {
  const count = ({ passes, runs }) => `${passes}/${runs}`;
  const withOld = (line, old) => (old === undefined ? line : `${line} (was ${count(old)})`);
  const lines = [];
  for (const [id, outcome] of Object.entries(cases)) {
    lines.push(withOld(`${id} ${count(outcome)}`, previous?.[id]));
    if (outcome.passes < outcome.runs) outcome.reasons.forEach((reason, index) => lines.push(`  run ${index + 1}: ${reason}`));
  }
  return lines;
}

function total(cases) {
  return Object.values(cases).reduce((sum, { passes, runs }) => ({ passes: sum.passes + passes, runs: sum.runs + runs }), { passes: 0, runs: 0 });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function main(argv) {
  const flags = parseFlags(argv, FLAGS, { usage: USAGE });
  const casesDir = path.resolve(flags.cases ?? DEFAULT_CASES);
  const ids = selectCases(casesDir, flags.case);
  if (flags.list === true) {
    process.stdout.write(ids.map((id) => `${id}\n`).join(''));
    return;
  }
  if (flags.runs !== undefined && !POSITIVE_INTEGER.test(flags.runs)) throw new UsageError("flag '--runs' needs a positive whole number");
  const previous = flags.compare === undefined ? undefined : JSON.parse(fs.readFileSync(flags.compare, 'utf8')).cases;
  const claude = findClaude();
  const runs = Number(flags.runs ?? DEFAULT_RUNS);
  const cases = {};
  for (const id of ids) cases[id] = await runCase({ casesDir, id, runs, model: flags.model, effort: flags.effort, claude });
  const sum = total(cases);
  const lines = reportLines(cases, previous);
  const totalLine = `total ${sum.passes}/${sum.runs}`;
  const oldTotal = previous === undefined ? undefined : total(previous);
  process.stdout.write(`${[...lines, oldTotal === undefined ? totalLine : `${totalLine} (was ${oldTotal.passes}/${oldTotal.runs})`].join('\n')}\n`);
  fs.mkdirSync(RESULTS, { recursive: true });
  const header = { model: flags.model ?? ROLE_DEFAULT, effort: flags.effort ?? ROLE_DEFAULT, cases };
  fs.writeFileSync(path.join(RESULTS, `${stamp()}.json`), `${JSON.stringify(header, null, 2)}\n`);
}

if (isMain(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`eval: ${error.message}\n`);
    process.exitCode = USAGE_EXIT;
  }
}
