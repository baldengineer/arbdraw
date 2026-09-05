const assert = require('node:assert/strict');
const test = require('node:test');
const { generateNoiseSamples, squarePulseVoltage } = require('../js/waveform-shapes.js');

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

function seededRandom(initialSeed) {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function lagOneCorrelation(values) {
  const left = values.slice(0, -1),
    right = values.slice(1),
    leftMean = left.reduce((sum, value) => sum + value, 0) / left.length,
    rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0,
    leftVariance = 0,
    rightVariance = 0;
  for (let index = 0; index < left.length; index++) {
    const leftDelta = left[index] - leftMean,
      rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

test('white noise uses independent full-band samples within the voltage limits', () => {
  const randomValues = [0, 0.25, 0.5, 0.75],
    samples = generateNoiseSamples({
      count: randomValues.length,
      high: 5,
      low: -3,
      color: 'white',
      random: () => randomValues.shift(),
    });
  assert.deepEqual(samples, [-3, -1, 1, 3]);
});

test('pink noise emphasizes low-frequency correlation and stays within voltage limits', () => {
  const white = generateNoiseSamples({
      count: 10000,
      high: 2,
      low: -2,
      color: 'white',
      random: seededRandom(123),
    }),
    pink = generateNoiseSamples({
      count: 10000,
      high: 2,
      low: -2,
      color: 'pink',
      random: seededRandom(123),
    });
  assert.ok(lagOneCorrelation(white) < 0.1);
  assert.ok(lagOneCorrelation(pink) > 0.7);
  assert.ok(pink.every((value) => value >= -2 && value <= 2));
  assert.ok(pink.some((value) => Math.abs(value) === 2));
});
