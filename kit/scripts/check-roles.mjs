import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const REPORT_HEADINGS = 'Goal, Outcome, Evidence, Files, Decisions, Open points';
const PRINCIPLES = 'rules/principles.md';
const FRONTMATTER_KEYS = ['description', 'effort', 'model', 'name', 'tools'];
const LEAD_ROLES = {
  orchestrator: { model: 'claude-opus-5-5', effort: 'high' },
  'solo-agent': { model: 'claude-opus-5-5', effort: 'high' }
};
const TEAM_ROLES = ['planner', 'builder', 'tester', 'reviewer', 'ui-designer', 'researcher', 'debugger'];
const ROLES = [...Object.keys(LEAD_ROLES), ...TEAM_ROLES];
const PLANNING_ROLES = ['orchestrator', 'solo-agent'];

function splitFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match === null) return { fields: {}, body: text };
  const fields = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const at = line.indexOf(': ');
      return [line.slice(0, at), line.slice(at + 2).replace(/^"(.*)"$/, '$1')];
    })
  );
  return { fields, body: match[2] };
}

function labelledLines(body) {
  return body.split('\n').filter((line) => line.includes('[bron:'));
}

function expectedChoice(role, models) {
  if (role in LEAD_ROLES) return LEAD_ROLES[role];
  return Object.values(models).find((row) => row.role === role);
}

function checkRole(role, kitRoot, models) {
  const file = path.join(kitRoot, 'agents', `${role}.md`);
  if (!fs.existsSync(file)) return [`${role}: agents/${role}.md is missing`];
  const { fields, body } = splitFrontmatter(fs.readFileSync(file, 'utf8'));
  const problems = [];
  const keys = Object.keys(fields).sort();
  if (keys.join() !== FRONTMATTER_KEYS.join()) problems.push(`${role}: frontmatter keys are ${keys.join(', ')}, expected ${FRONTMATTER_KEYS.join(', ')}`);
  if (fields.name !== role) problems.push(`${role}: name is ${fields.name}`);
  const expected = expectedChoice(role, models);
  if (expected === undefined) problems.push(`${role}: kit/config.json models has no kind for this role`);
  else if (fields.model !== expected.model || fields.effort !== expected.effort) {
    problems.push(`${role}: model ${fields.model} effort ${fields.effort}, expected ${expected.model} ${expected.effort}`);
  }
  for (const line of labelledLines(body)) problems.push(`${role}: source label in a prompt line: ${line}`);
  if (!body.includes(REPORT_HEADINGS)) problems.push(`${role}: no report under the headings ${REPORT_HEADINGS}`);
  if (!body.includes(PRINCIPLES)) problems.push(`${role}: does not point at ${PRINCIPLES}`);
  if (PLANNING_ROLES.includes(role) && !(body.includes('plan_ready') && body.includes('[plan approved]'))) {
    problems.push(`${role}: does not call plan_ready and wait for [plan approved]`);
  }
  return problems;
}

export function checkRoles(kitRoot) {
  const { models } = JSON.parse(fs.readFileSync(path.join(kitRoot, 'config.json'), 'utf8'));
  const principles = path.join(kitRoot, PRINCIPLES);
  const principleProblems = fs.existsSync(principles)
    ? labelledLines(fs.readFileSync(principles, 'utf8')).map((line) => `principles: source label in a prompt line: ${line}`)
    : [`${PRINCIPLES} is missing`];
  const extra = fs.readdirSync(path.join(kitRoot, 'agents')).filter((name) => !ROLES.includes(path.basename(name, '.md')));
  return [
    ...ROLES.flatMap((role) => checkRole(role, kitRoot, models)),
    ...extra.map((name) => `agents/${name} is not a role of Decision 11`),
    ...principleProblems
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkRoles(path.resolve(import.meta.dirname, '..'));
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`${ROLES.length} roles match kit/config.json`);
}
