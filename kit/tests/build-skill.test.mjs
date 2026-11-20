import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const SKILL = fs.readFileSync(path.resolve(import.meta.dirname, '../skills/build/SKILL.md'), 'utf8');
const endOfTheRun = SKILL.split('## End of the run')[1].split('\n## ')[0];

test('the end of the run routes on the review outcome, the product run, the task count, stubs and untouched paths', () => {
  for (const marker of ['Review: BLOCKED', 'Product run: none', 'Tasks:', 'Stub:', 'Untouched:']) {
    assert.ok(endOfTheRun.includes(marker), `End of the run does not mention '${marker}'`);
  }
});
