import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shippingCents } from '../src/shipping.mjs';

test('a small order pays the flat rate', () => {
  assert.equal(shippingCents(1000), 499);
});

test('a large order ships free', () => {
  assert.equal(shippingCents(9000), 0);
});
