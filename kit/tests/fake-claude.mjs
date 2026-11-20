#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const mode = process.env.FAKE_CLAUDE_MODE;
const caseDir = process.env.FAKE_CLAUDE_CASE;

if (process.env.FAKE_CLAUDE_LOG) {
  const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim();
  const entry = { args: process.argv.slice(2), cwd: process.cwd(), commits: Number(commits), apiKey: process.env.ANTHROPIC_API_KEY ?? null };
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(entry)}\n`);
}

if (mode === 'exit1') {
  process.stderr.write('fake claude failed\n');
  process.exit(1);
}
if (mode === 'noresult') process.stdout.write(`${JSON.stringify({ is_error: true })}\n`);
else if (mode === 'hang') setTimeout(() => {}, 60_000);
else if (mode === 'pass' || mode === 'fail') {
  execFileSync('git', ['apply', path.join(caseDir, `${mode}.patch`)]);
  process.stdout.write(`${JSON.stringify({ result: 'done' })}\n`);
} else throw new Error(`FAKE_CLAUDE_MODE must be pass, fail, exit1, noresult or hang, got ${mode}`);
