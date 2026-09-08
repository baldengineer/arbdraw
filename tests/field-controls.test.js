const assert = require('node:assert/strict');
const test = require('node:test');
const fields = require('../js/fields.js');

test('field unit conversion preserves the canonical quantity', () => {
  assert.equal(fields.convert(1, 'V', 'mV', 'voltage'), 1000);
  assert.equal(fields.convert(5, 'kHz', 'Hz', 'frequency'), 5000);
  assert.equal(fields.convert(1, 'Kpts', 'pts', 'sampleCount'), 1000);
  assert.ok(Math.abs(fields.convert(1000, 'ns', 'µs', 'time') - 1) < 1e-12);
  assert.equal(fields.convert(1, 'V/div', 'mV/div', 'scopeVoltage'), 1000);
  assert.equal(fields.convert(2, 'ms/div', 'µs/div', 'scopeTime'), 2000);
});

test('field unit conversion rejects unknown units', () => {
  assert.throws(() => fields.convert(1, 'MHz', 'Hz', 'voltage'), RangeError);
});

test('numeric field validation keeps incomplete and out-of-range drafts invalid', () => {
  assert.equal(fields.validNumber('', { min: 0 }).valid, false);
  assert.equal(fields.validNumber('-', { min: 0 }).valid, false);
  assert.equal(fields.validNumber('4.5', { integer: true }).valid, false);
  assert.equal(fields.validNumber('4', { min: 1, max: 5 }).value, 4);
});
