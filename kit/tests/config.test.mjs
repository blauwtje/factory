import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { settingValue } from '#settings-store';

const KIT_ROOT = path.resolve(import.meta.dirname, '..');
const KINDS = ['plan', 'plan-large', 'build', 'build-heavy', 'mechanical', 'test', 'review', 'security', 'design', 'research', 'lookup', 'tradeoff', 'debug', 'debug-heavy'];
const ROLES = ['orchestrator', 'planner', 'builder', 'tester', 'reviewer', 'ui-designer', 'researcher', 'debugger', 'solo-agent'];
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const EFFORTS = ['medium', 'high', 'xhigh'];

function keptFiles(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : keptFiles(file);
    return [file];
  });
}

test('specs is stored in docs', () => {
  assert.equal(settingValue('specs'), 'docs');
});

test('models holds one row for each of the 14 kinds, with a role, a full model name and an effort', () => {
  const models = settingValue('models');
  assert.deepEqual(Object.keys(models).sort(), [...KINDS].sort());
  for (const [kind, row] of Object.entries(models)) {
    assert.deepEqual(Object.keys(row).sort(), ['effort', 'model', 'role'], kind);
    assert.ok(ROLES.includes(row.role), `${kind}: role ${row.role}`);
    assert.ok(MODELS.includes(row.model), `${kind}: model ${row.model}`);
    assert.ok(EFFORTS.includes(row.effort), `${kind}: effort ${row.effort}`);
  }
});

test('mechanical work runs on Haiku at medium effort', () => {
  assert.deepEqual(settingValue('models').mechanical, { role: 'builder', model: 'claude-haiku-5-5', effort: 'medium' });
});

test('an unknown setting names the known ones', () => {
  assert.throws(() => settingValue('ship'), /unknown setting ship; known: specs, models/);
});

test('no kit file reads a plugin option or points at an exo path', () => {
  const offenders = keptFiles(KIT_ROOT).filter((file) => {
    if (path.basename(file) === 'LICENSE' || file === import.meta.filename) return false;
    return /CLAUDE_PLUGIN_OPTION_|plugins\/exo|\.exo\b/.test(fs.readFileSync(file, 'utf8'));
  });
  assert.deepEqual(offenders.map((file) => path.relative(KIT_ROOT, file)), []);
});
