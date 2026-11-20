import assert from 'node:assert/strict';
import { test } from 'node:test';
import { totalCents } from '../src/cart.mjs';

test('adds up price times quantity', () => {
  assert.equal(totalCents([{ cents: 250, quantity: 2 }, { cents: 100, quantity: 1 }]), 600);
});

test('an empty cart costs nothing', () => {
  assert.equal(totalCents([]), 0);
});
