import assert from 'node:assert/strict';
import { test } from 'node:test';
import { greet, greetAll } from '../src/greet.mjs';

test('greets one name', () => {
  assert.equal(greet('ada'), 'Hello, Ada!');
});

test('greets each name on its own line', () => {
  assert.equal(greetAll(['ada', 'mary-jane']), 'Hello, Ada!\nHello, Mary-Jane!');
});
