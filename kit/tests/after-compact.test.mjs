import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const KIT = path.resolve(import.meta.dirname, '..');

test('after a compaction the hook points the agent back at the rules and its plan', () => {
  const result = spawnSync(process.execPath, [path.join(KIT, 'hooks', 'after-compact.mjs')], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact' }),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'SessionStart');
  assert.match(output.additionalContext, /plan or brief/);
  assert.ok(output.additionalContext.includes(path.join(KIT, 'rules', 'principles.md')));
});

test('hooks.json runs the hook only on a compaction', () => {
  const { hooks } = JSON.parse(fs.readFileSync(path.join(KIT, 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(hooks.SessionStart, [
    { matcher: 'compact', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/after-compact.mjs"' }] }
  ]);
});
