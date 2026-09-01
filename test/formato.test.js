import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pesos, metros } from '../assets/js/formato.js';

test('pesos usa punto de miles y no lleva decimales', () => {
  assert.equal(pesos(1833480000), '$1.833.480.000');
  assert.equal(pesos(0), '$0');
});

test('metros usa punto de miles y lleva la unidad', () => {
  assert.equal(metros(16668), '16.668 m²');
  assert.equal(metros(2140), '2.140 m²');
});
