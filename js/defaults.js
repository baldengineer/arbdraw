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
  frequencyUnit: 'kHz',
  periodUnit: 'us',
  phaseDegrees: 0,
  phaseUnit: '°',
  dutyCyclePercent: 50,
  dutyCycleUnit: '%',
  serialProtocol: 'UART',
  serialBaud: 57600,
  serialWordSize: 8,
  serialBitOrder: 'LSB',
  serialInvertData: false,
  serialParity: 'none',
  serialStartBit: true,
  serialPreIdleBits: 1,
  serialPostIdleBits: 10,
  serialStopBits: 1,
  serialPayload: '0xAA',
  serialBinaryPattern: '',
  serial_debug: false,
  editorColor: '#7bffb2',
  waveformColor: '#ffe45e',
  waveformVerticalDivisions: 10,
};
