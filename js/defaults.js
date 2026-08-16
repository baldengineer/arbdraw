/*
 * ArbDraw editable waveform defaults.
 *
 * Keep this as a plain JavaScript object so it loads when index.html is opened
 * directly from disk. Values use volts, hertz, and degrees.
 */
globalThis.ARBDRAW_DEFAULTS = {
  highLevelV: 500,
  highLevelUnit: 'mV',
  lowLevelV: -500,
  lowLevelUnit: 'mV',
  offsetV: 0,
  offsetUnit: 'V',
  amplitudeVpp: 10,
  amplitudeUnit: 'Vpp',
  sampleRateMSa: 1250,
  sampleRateUnit: 'MSa/s',
  sampleCount: 1000,
  sampleCountUnit: 'pts',
  nCycles: 1,
  frequencyHz: 2.5,
  frequencyUnit: 'MHz',
  periodUnit: 'ns',
  phaseDegrees: 0,
  phaseUnit: '°',
  dutyCyclePercent: 50,
  dutyCycleUnit: '%',
  serialProtocol: 'UART',
  serialWordSize: 8,
  serialParity: 'none',
  serialStartBit: true,
  serialStopBit: true,
  serialPayload: '0xAA',
  editorColor: '#7bffb2',
  waveformColor: '#ffe45e',
  waveformVerticalDivisions: 10,
};
