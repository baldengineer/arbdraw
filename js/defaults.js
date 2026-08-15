/*
 * ArbDraw editable waveform defaults.
 *
 * Keep this as a plain JavaScript object so it loads when index.html is opened
 * directly from disk. Values use volts, hertz, and degrees.
 */
globalThis.ARBDRAW_DEFAULTS = {
  highLevelV: 5,
  highLevelUnit: 'V',
  lowLevelV: -5,
  lowLevelUnit: 'V',
  offsetV: 0,
  offsetUnit: 'V',
  amplitudeVpp: 10,
  amplitudeUnit: 'Vpp',
  sampleRateMSa: 1250,
  sampleRateUnit: 'MSa/s',
  sampleCount: 1000,
  sampleCountUnit: 'pts',
  frequencyHz: 2.5,
  frequencyUnit: 'MHz',
  periodUnit: 'ns',
  phaseDegrees: 0,
  phaseUnit: '°',
  dutyCyclePercent: 50,
  dutyCycleUnit: '%',
  editorColor: '#7bffb2',
  waveformColor: '#ffe45e',
};
