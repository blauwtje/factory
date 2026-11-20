import fs from 'node:fs';
import { parseFlags, isMain } from '#script-flags';
import { resolvePlanPath } from '#checkout';
import { commitsOf, landedTasks, planIdOf, taskCommits } from '#plan-landed';
import { parsePlan } from '#plan-tasks';
import { frameOf } from '#plan-frame';
import { stubLines } from './stub-lines.mjs';
import { untouchedLines } from './untouched-lines.mjs';

const USAGE = 'usage: next-task.mjs --plan <plan> [--root <checkout>]';

const STANDING = [['Decisions', 'decisions'], ['Non-goals', 'nonGoals'], ['Assumptions', 'assumptions']];

function standingText(frame) {
  const found = frameOf(frame);
  return STANDING.filter(([, key]) => found[key].length > 0)
    .map(([title, key]) => `${title}:\n${found[key].map((item) => (/^\d+\. /.test(item) ? item : `- ${item}`)).join('\n')}\n`)
    .join('\n');
}

export function nextTaskReport({ planText, planPath, root }) {
  const { tasks, frame } = parsePlan(planText);
  const planId = planIdOf(planPath);
  const commits = commitsOf(root);
  const landed = landedTasks(tasks, commits, planId);
  const next = tasks.find((task) => !landed.includes(task.number) && task.dependsOn.every((number) => landed.includes(number)));
  const open = tasks.map((task) => task.number).filter((number) => !landed.includes(number));
  const landedLine = `Landed: ${landed.length === 0 ? 'none' : landed.join(', ')}\nTasks: ${landed.length} of ${tasks.length} landed; open: ${open.length === 0 ? 'none' : open.join(', ')}\n`;
  if (next === undefined) {
    const landedTaskCommits = tasks
      .filter((task) => landed.includes(task.number))
      .sort((a, b) => a.number - b.number)
      .map((task) => ({ number: task.number, files: task.files, shas: taskCommits(task, commits, planId) }));
    const landedCommits = landedTaskCommits.flatMap(({ number, shas }) => shas.map((sha) => ({ number, sha })));
    const findings = [...stubLines(root, landedCommits), ...untouchedLines(root, landedTaskCommits)];
    return `${landedLine}Next: none\n${findings.map((line) => `${line}\n`).join('')}`;
  }
  const standing = standingText(frame);
  const task = `${landedLine}Next: ${next.number} ${next.title}\n\n${next.section.trim()}\n`;
  return standing === '' ? task : `${task}\n${standing}`;
}

if (isMain(import.meta.url)) {
  const flags = parseFlags(process.argv.slice(2), { plan: 'value', root: 'value' }, { usage: USAGE });
  const planPath = resolvePlanPath({ plan: flags.plan, root: flags.root });
  process.stdout.write(nextTaskReport({ planText: fs.readFileSync(planPath, 'utf8'), planPath, root: flags.root ?? process.cwd() }));
}
