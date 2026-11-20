import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkRoles } from '../scripts/check-roles.mjs';

const KIT_ROOT = path.resolve(import.meta.dirname, '..');
const TABLE = {
  orchestrator: ['claude-opus-5-5', 'high'],
  planner: ['claude-opus-5-5', 'high'],
  builder: ['claude-sonnet-5-5', 'medium'],
  tester: ['claude-sonnet-5-5', 'medium'],
  reviewer: ['claude-opus-5-5', 'high'],
  'ui-designer': ['claude-opus-5-5', 'high'],
  researcher: ['claude-sonnet-5-5', 'medium'],
  debugger: ['claude-opus-5-5', 'high'],
  'solo-agent': ['claude-opus-5-5', 'high']
};

function readRole(role) {
  return fs.readFileSync(path.join(KIT_ROOT, 'agents', `${role}.md`), 'utf8');
}

function copiedKit() {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  for (const entry of ['agents', 'rules', 'config.json']) fs.cpSync(path.join(KIT_ROOT, entry), path.join(copy, entry), { recursive: true });
  return copy;
}

test('the nine roles carry the model and effort of the Decision 11 table', () => {
  for (const [role, [model, effort]] of Object.entries(TABLE)) {
    const text = readRole(role);
    assert.match(text, new RegExp(`^name: ${role}$`, 'm'), role);
    assert.match(text, new RegExp(`^model: ${model}$`, 'm'), role);
    assert.match(text, new RegExp(`^effort: ${effort}$`, 'm'), role);
  }
});

test('check-roles accepts the kit', () => {
  assert.deepEqual(checkRoles(KIT_ROOT), []);
});

test('check-roles rejects a source label in a prompt line, since the model cannot look it up', () => {
  const copy = copiedKit();
  fs.appendFileSync(path.join(copy, 'agents', 'builder.md'), '- Do whatever you like. [bron: Tan LT7]\n');
  fs.appendFileSync(path.join(copy, 'rules', 'principles.md'), '- Keep it small. [bron: Tan LT7]\n');
  const problems = checkRoles(copy).join('\n');
  assert.match(problems, /builder: source label in a prompt line: - Do whatever you like\. \[bron: Tan LT7\]/);
  assert.match(problems, /principles: source label in a prompt line: - Keep it small\. \[bron: Tan LT7\]/);
});

test('check-roles rejects a role whose model differs from kit/config.json', () => {
  const copy = copiedKit();
  const file = path.join(copy, 'agents', 'tester.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('claude-sonnet-5-5', 'claude-haiku-5-5'));
  assert.match(checkRoles(copy).join('\n'), /tester: model claude-haiku-5-5 effort medium, expected claude-sonnet-5-5 medium/);
});

test('check-roles rejects a role with no kind in kit/config.json', () => {
  const copy = copiedKit();
  const file = path.join(copy, 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [kind, row] of Object.entries(config.models)) if (row.role === 'debugger') delete config.models[kind];
  fs.writeFileSync(file, JSON.stringify(config));
  assert.match(checkRoles(copy).join('\n'), /debugger: kit\/config\.json models has no kind for this role/);
});

test('the planning roles wait for [plan approved] after plan_ready and write the plan under docs/specs', () => {
  for (const role of ['orchestrator', 'solo-agent']) {
    const text = readRole(role);
    assert.match(text, /docs\/specs\/<slug>\.md/, role);
    assert.match(text, /plan_ready/, role);
    assert.match(text, /\[plan approved\]/, role);
  }
});

test('the orchestrator holds the bus tools, the modes and the step-up rules', () => {
  const text = readRole('orchestrator');
  for (const word of ['spawn_agent', 'set_agent_model', 'send_to_agent', 'list_agents', 'read_agent', 'Auto', 'Solo', 'Team', 'step up', 'factory-agent/<slug>/<agent>']) {
    assert.ok(text.includes(word), word);
  }
});

test('the reviewer and the review skill end with one Review outcome line', () => {
  const skill = fs.readFileSync(path.join(KIT_ROOT, 'skills', 'review', 'SKILL.md'), 'utf8');
  assert.match(skill, /Review: FINDINGS <n> fixed, <m> dropped/);
  assert.match(readRole('reviewer'), /Review: FINDINGS <n>`/);
  for (const text of [readRole('reviewer'), skill]) {
    assert.match(text, /Review: CLEAN/);
    assert.match(text, /Review: BLOCKED <reason>/);
    assert.match(text, /could not be read or run/);
  }
});

test('the test and review roles report only failures with file, line and error', () => {
  for (const role of ['tester', 'reviewer']) assert.match(readRole(role), /only failures[^\n]*file, line and error/, role);
});
