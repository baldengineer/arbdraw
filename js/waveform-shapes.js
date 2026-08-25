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

  return Object.freeze({ squarePulseVoltage });
});
