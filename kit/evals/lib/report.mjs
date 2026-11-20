import { spawnSync } from 'node:child_process';
import os from 'node:os';
import process from 'node:process';

const REPORT_HEADINGS = ['goal', 'outcome', 'evidence', 'files', 'decisions', 'open points'];

export function hasReportHeadings(report) {
  const headings = report
    .split('\n')
    .map((line) => (/^#{1,6}\s+(.+?)\s*$/.exec(line) ?? /^\*\*(.+?):?\*\*/.exec(line))?.[1].replace(/:$/, '').toLowerCase())
    .filter((heading) => heading !== undefined);
  let next = 0;
  for (const heading of headings) if (heading === REPORT_HEADINGS[next]) next += 1;
  return next === REPORT_HEADINGS.length;
}

export function changedFiles(repo) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '-z'], { cwd: repo, env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git status failed in ${repo}: ${result.stderr}`);
  const entries = result.stdout.split('\0').filter((entry) => entry !== '');
  const files = [];
  for (let i = 0; i < entries.length; i += 1) {
    files.push(entries[i].slice(3));
    if (entries[i][0] === 'R' || entries[i][0] === 'C') i += 1;
  }
  return files.filter((file) => !file.startsWith('.claude/')).sort();
}
