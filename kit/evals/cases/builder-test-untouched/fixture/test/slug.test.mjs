import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slug } from '../src/slug.mjs';

test('joins lower-case words with one hyphen', () => {
  assert.equal(slug('Hello  World'), 'hello-world');
});

test('drops leading and trailing spaces', () => {
  assert.equal(slug(' Trim me '), 'trim-me');
});
