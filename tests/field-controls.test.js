const assert = require('node:assert/strict');
const test = require('node:test');
const fields = require('../js/fields.js');

function fakeInput(value = '1') {
  const listeners = new Map();
  return {
    id: 'testInput',
    type: 'number',
    value,
    dataset: {},
    ownerDocument: null,
    classList: { toggle() {} },
    getAttribute() { return null; },
    setAttribute() {},
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.({ type, target: this }); },
  };
}

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

test('numeric input formatting truncates to the configurable default precision', () => {
  assert.equal(fields.formatNumber(1.23459), '1.2345');
  assert.equal(fields.formatNumber(-1.23459), '-1.2345');
  assert.equal(fields.formatNumber(1.23459, 2), '1.23');
});

test('fields preview valid drafts by default and can opt out', () => {
  const liveInput = fakeInput();
  let livePreview;
  const liveControl = fields.attach(liveInput, { id: 'liveInput', kind: 'number' }, {
    preview: (value, meta) => {
      livePreview = { value, valid: meta.valid };
    },
  });
  liveInput.value = '2';
  liveInput.dispatch('input');
  assert.deepEqual(livePreview, { value: 2, valid: true });
  liveControl.destroy();

  const explicitInput = fakeInput();
  let explicitPreview = false;
  const explicitControl = fields.attach(
    explicitInput,
    { id: 'explicitInput', kind: 'number', liveUpdate: false },
    { preview: () => { explicitPreview = true; } },
  );
  explicitInput.value = '2';
  explicitInput.dispatch('input');
  assert.equal(explicitPreview, false);
  explicitControl.destroy();
});
