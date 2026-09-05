// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Pure waveform-shape helpers shared by the browser app and unit tests.
(function exposeWaveformShapes(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ARBDRAW_WAVEFORM_SHAPES = api;
})(typeof globalThis === 'object' ? globalThis : this, function createWaveformShapes() {
  function squarePulseVoltage({
    phase,
    high,
    low,
    dutyPercent,
    frequencyHz,
    riseTimeSeconds,
    fallTimeSeconds,
  }) {
    const cyclePhase = ((phase % 1) + 1) % 1,
      duty = Math.min(0.99, Math.max(0.01, dutyPercent / 100)),
      voltageRange = high - low,
      riseFraction = Math.min(duty, Math.max(0, riseTimeSeconds * frequencyHz)),
      fallFraction = Math.min(1 - duty, Math.max(0, fallTimeSeconds * frequencyHz));

    // Zero is deliberately an ideal step and reproduces the original square/pulse shape.
    if (riseFraction > 0 && cyclePhase < riseFraction)
      return low + voltageRange * (cyclePhase / riseFraction);
    if (cyclePhase < duty) return high;
    if (fallFraction > 0 && cyclePhase < duty + fallFraction)
      return high - voltageRange * ((cyclePhase - duty) / fallFraction);
    return low;
  }

  function createSerialVoltage({ bits, baud, high, low, riseTimeSeconds, fallTimeSeconds }) {
    const edges = [];
    let previous = 1; // Serial lines idle high before and after the payload.
    for (let i = 0; i <= bits.length; i++) {
      const bit = i < bits.length ? bits[i] : 1;
      if (bit !== previous) edges.push({ time: i / baud, bit });
      previous = bit;
    }
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      edge.duration = Math.min(
        Math.max(0, edge.bit ? riseTimeSeconds : fallTimeSeconds),
        i + 1 < edges.length ? edges[i + 1].time - edge.time : Infinity,
      );
    }
    return (elapsedSeconds) => {
      let left = 0, right = edges.length;
      while (left < right) {
        const middle = Math.floor((left + right) / 2);
        if (edges[middle].time <= elapsedSeconds) left = middle + 1;
        else right = middle;
      }
      if (!left) return high;
      const edge = edges[left - 1],
        progress = edge.duration > 0 ? Math.min(1, (elapsedSeconds - edge.time) / edge.duration) : 1;
      return edge.bit ? low + (high - low) * progress : high - (high - low) * progress;
    };
  }

  function triangleVoltage({ phase, high, low, symmetryPercent = 50 }) {
    const p = ((phase % 1) + 1) % 1,
      rise = Math.min(100, Math.max(0, symmetryPercent)) / 100;
    const level = rise === 0 ? 1 - p : rise === 1 ? p :
      p < rise ? p / rise : (1 - p) / (1 - rise);
    return low + (high - low) * level;
  }

  function generateNoiseSamples({ count, high, low, color = 'white', random = Math.random }) {
    const sampleCount = Math.max(0, Math.floor(count)),
      midpoint = (high + low) / 2,
      amplitude = (high - low) / 2,
      whiteSample = () => random() * 2 - 1;

    if (color !== 'pink')
      return Array.from({ length: sampleCount }, () => midpoint + amplitude * whiteSample());

    // Paul Kellet's seven-pole approximation shapes white noise to approximately 1/f pink noise.
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    const pinkSamples = Array.from({ length: sampleCount }, () => {
      const white = whiteSample();
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      return pink;
    });
    const mean = pinkSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, sampleCount),
      peak = pinkSamples.reduce((maximum, value) => Math.max(maximum, Math.abs(value - mean)), 0);
    return pinkSamples.map((value) => midpoint + amplitude * ((value - mean) / (peak || 1)));
  }

  return Object.freeze({ generateNoiseSamples, squarePulseVoltage, triangleVoltage, createSerialVoltage });
});
