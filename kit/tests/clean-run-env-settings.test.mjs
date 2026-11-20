import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tempDir } from './harness.mjs';

const preload = pathToFileURL(path.resolve(import.meta.dirname, 'clean-run-env.mjs')).href;

test('the preload points the Claude config folder at an empty folder', () => {
  const developer = tempDir('clean-run-env-config-');
  fs.writeFileSync(path.join(developer, 'settings.json'), JSON.stringify({ autoMemoryEnabled: false }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: developer };
  delete env.FACTORY_TEST_TMP_ROOT;
  const code = `console.log(process.env.CLAUDE_CONFIG_DIR)`;
  const r = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '-e', code], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(r.stdout.trim(), developer);
});
