import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countWords } from '../src/count.mjs';

test('counts repeated words ignoring case', () => {
  assert.deepEqual(countWords('a B b'), { a: 1, b: 2 });
});
