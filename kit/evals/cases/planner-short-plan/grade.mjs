import fs from 'node:fs';
import path from 'node:path';
import { changedFiles, hasReportHeadings } from '../../lib/report.mjs';

const PLAN = 'docs/specs/json-output.md';
const MAX_LINES = 200;

export default function grade({ repo, report }) {
  if (!hasReportHeadings(report)) return { pass: false, reason: 'the report lacks the six headings' };
  const changed = changedFiles(repo);
  if (changed.join() !== PLAN) return { pass: false, reason: `changed files are [${changed.join(', ')}], expected only ${PLAN}` };
  const plan = fs.readFileSync(path.join(repo, PLAN), 'utf8');
  const lines = plan.trimEnd().split('\n').length;
  if (lines > MAX_LINES) return { pass: false, reason: `the plan has ${lines} lines, expected at most ${MAX_LINES}` };
  const tasks = plan.split(/^#{2,4} (?=Task \d+\b)/m).slice(1);
  if (tasks.length === 0) return { pass: false, reason: 'the plan has no task section' };
  for (const [index, task] of tasks.entries()) {
    const proofs = task.split('Proof:').length - 1;
    if (proofs !== 1) return { pass: false, reason: `task section ${index + 1} has ${proofs} Proof: lines, expected exactly one` };
  }
  return { pass: true, reason: `${PLAN} has ${lines} lines with ${tasks.length} task(s), each with one proof` };
}
