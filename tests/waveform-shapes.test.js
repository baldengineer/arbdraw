const assert = require('node:assert/strict');
const test = require('node:test');
const { squarePulseVoltage } = require('../js/waveform-shapes.js');

const base = {
  high: 5,
  low: -5,
  dutyPercent: 50,
  frequencyHz: 10e6,
  riseTimeSeconds: 0,
  fallTimeSeconds: 0,
};

test('zero transition times preserve ideal square-wave steps', () => {
  assert.equal(squarePulseVoltage({ ...base, phase: 0 }), 5);
  assert.equal(squarePulseVoltage({ ...base, phase: 0.499 }), 5);
  assert.equal(squarePulseVoltage({ ...base, phase: 0.5 }), -5);
});

test('rise time produces a linear edge with the requested slope', () => {
  const shape = { ...base, riseTimeSeconds: 10e-9 };
  assert.equal(squarePulseVoltage({ ...shape, phase: 0 }), -5);
  assert.ok(Math.abs(squarePulseVoltage({ ...shape, phase: 0.05 })) < 1e-12);
  assert.equal(squarePulseVoltage({ ...shape, phase: 0.1 }), 5);
});

test('fall time produces a linear edge after the duty boundary', () => {
  const shape = { ...base, fallTimeSeconds: 10e-9 };
  assert.equal(squarePulseVoltage({ ...shape, phase: 0.5 }), 5);
  assert.ok(Math.abs(squarePulseVoltage({ ...shape, phase: 0.55 })) < 1e-12);
  assert.equal(squarePulseVoltage({ ...shape, phase: 0.6 }), -5);
});

test('transition ramps are limited to their available cycle segments', () => {
  const shape = {
    ...base,
    dutyPercent: 25,
    riseTimeSeconds: 1,
    fallTimeSeconds: 1,
  };
  assert.equal(squarePulseVoltage({ ...shape, phase: 0 }), -5);
  assert.equal(squarePulseVoltage({ ...shape, phase: 0.25 }), 5);
  assert.ok(Math.abs(squarePulseVoltage({ ...shape, phase: 0.999999 }) + 5) < 0.00002);
});
