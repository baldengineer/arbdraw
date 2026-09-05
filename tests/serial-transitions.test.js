const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const shapes = require('../js/waveform-shapes.js');
const serial = (options = {}) => shapes.createSerialVoltage({
  bits: [1, 0, 0, 1, 0], baud: 1, high: 6, low: -2,
  riseTimeSeconds: 0, fallTimeSeconds: 0, ...options,
});

test('zero serial transition times preserve ideal bits and trailing idle', () => {
  const voltage = serial();
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(voltage), [6, -2, -2, 6, -2, 6, 6]);
});

test('serial ramps use separate rise/fall times without restarting on repeated bits', () => {
  const voltage = serial({ riseTimeSeconds: .5, fallTimeSeconds: 1.5 });
  assert.equal(voltage(1), 6);
  assert.equal(voltage(1.75), 2);
  assert.ok(Math.abs(voltage(2) - (6 - 8 / 1.5)) < 1e-12);
  assert.equal(voltage(2.5), -2);
  assert.equal(voltage(3.25), 2);
  assert.equal(voltage(3.5), 6);
  // The next fall is capped at one bit, where trailing idle starts.
  assert.equal(voltage(4.5), 2);
  assert.equal(voltage(5), -2);
  assert.equal(voltage(5.25), 2);
  assert.equal(voltage(5.5), 6);
});

test('long serial ramps are capped at the next opposite edge, like square waves', () => {
  const voltage = serial({ bits: [0, 1, 0, 1], riseTimeSeconds: 10, fallTimeSeconds: 10 });
  for (const t of [.25, .5, .75, 1, 1.25, 1.5, 1.75, 2]) {
    const square = shapes.squarePulseVoltage({ phase: t / 2 + .5, high: 6, low: -2,
      dutyPercent: 50, frequencyHz: .5, riseTimeSeconds: 10, fallTimeSeconds: 10 });
    assert.equal(voltage(t), square);
  }
});

test('serial generation applies transition settings and exposes the controls', () => {
  const source = fs.readFileSync(require.resolve('../js/waveform-editor.js'), 'utf8');
  const properties = [{ hidden: true }, { hidden: true }];
  const context = vm.createContext({
    state: { type: 'serial', samples: 5, high: 6, low: -2, phase: 0, cycles: 1,
      riseTime: .5, fallTime: .5 },
    ARBDRAW_WAVEFORM_SHAPES: shapes,
    serialBitPattern: () => [0, 1], serialSettings: () => ({ baud: 1 }),
    waveformDurationMs: () => 1000, applyFilters: data => data,
    pushHistory() {}, draw() {}, persistCurrentSettings() {},
    $: () => ({ classList: { contains: () => true } }),
    document: { querySelectorAll: () => properties },
  });
  vm.runInContext(source.slice(source.indexOf('function generate('), source.indexOf('function clone')), context);
  context.generate();
  assert.deepEqual(Array.from(context.state.data), [6, 2, -2, -2, -2]);
  vm.runInContext(source.slice(source.indexOf('function updateTransitionPropertiesVisibility('),
    source.indexOf('function updateSymmetryVisibility(')), context);
  context.updateTransitionPropertiesVisibility('serial');
  assert.ok(properties.every(property => !property.hidden));
});
