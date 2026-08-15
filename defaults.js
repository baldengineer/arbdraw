/*
 * ArbDraw editable waveform defaults.
 *
 * Keep this as a plain JavaScript object so it loads when index.html is opened
 * directly from disk. Values use volts, hertz, and degrees.
 */
globalThis.ARBDRAW_DEFAULTS = {
  highLevelV: 5,
  lowLevelV: -5,
  offsetV: 0,
  amplitudeVpp: 10,
  sampleRateMSa: 2500,
  sampleCount: 10000,
  frequencyHz: 500000,
  phaseDegrees: 0,
  dutyCyclePercent: 50
};
