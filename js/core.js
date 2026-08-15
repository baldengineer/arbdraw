// Shared defaults, project document, and application state.
function normalizeDefaults(source = {}) {
  const finite = (key, fallback) =>
    Number.isFinite(Number(source[key])) ? Number(source[key]) : fallback;

  const color = (key, fallback) =>
    /^#[0-9a-f]{6}$/i.test(String(source[key] || '')) ? String(source[key]) : fallback;

  const voltageUnits = {
    V: 1,
    mV: 0.001,
    µV: 0.000001,
  };
  const amplitudeUnits = {
    Vpp: 1,
    mVpp: 0.001,
    µVpp: 0.000001,
  };
  const frequencyUnits = {
    mHz: 0.001,
    Hz: 1,
    kHz: 1e3,
    MHz: 1e6,
    GHz: 1e9,
  };
  const periodUnits = {
    Ms: 1e6,
    s: 1,
    ms: 0.001,
    µs: 1e-6,
    ns: 1e-9,
  };
  const sampleRateUnits = {
    'Sa/s': 1e-6,
    'kSa/s': 0.001,
    'MSa/s': 1,
    'GSa/s': 1e3,
  };
  const sampleCountUnits = {
    pts: 1,
    kpts: 1e3,
    Mpts: 1e6,
  };

  const unit = (key, units, fallback) =>
    Object.hasOwn(units, source[key]) ? source[key] : fallback;

  const highLevelUnit = unit('highLevelUnit', voltageUnits, 'V');
  const lowLevelUnit = unit('lowLevelUnit', voltageUnits, 'V');
  const offsetUnit = unit('offsetUnit', voltageUnits, 'V');
  const amplitudeUnit = unit('amplitudeUnit', amplitudeUnits, 'Vpp');
  const frequencyUnit = unit('frequencyUnit', frequencyUnits, 'Hz');
  const periodUnit = unit('periodUnit', periodUnits, 'µs');
  const sampleRateUnit = unit('sampleRateUnit', sampleRateUnits, 'MSa/s');
  const sampleCountUnit = unit('sampleCountUnit', sampleCountUnits, 'pts');

  const offsetV = finite('offsetV', 0) * voltageUnits[offsetUnit];
  const amplitudeVpp = Math.max(0, finite('amplitudeVpp', 10) * amplitudeUnits[amplitudeUnit]);

  let highLevelV =
    finite('highLevelV', (offsetV + amplitudeVpp / 2) / voltageUnits[highLevelUnit]) *
    voltageUnits[highLevelUnit];
  let lowLevelV =
    finite('lowLevelV', (offsetV - amplitudeVpp / 2) / voltageUnits[lowLevelUnit]) *
    voltageUnits[lowLevelUnit];

  if (highLevelV < lowLevelV) {
    [highLevelV, lowLevelV] = [lowLevelV, highLevelV];
  }

  return Object.freeze({
    highLevelV,
    lowLevelV,
    offsetV,
    amplitudeVpp,
    highLevelUnit,
    lowLevelUnit,
    offsetUnit,
    amplitudeUnit,
    frequencyUnit,
    periodUnit,
    sampleRateUnit,
    sampleCountUnit,
    phaseUnit: String(source.phaseUnit || '°'),
    dutyCycleUnit: String(source.dutyCycleUnit || '%'),
    sampleRateMSa: Math.max(
      0.000001,
      finite('sampleRateMSa', 2500 / sampleRateUnits[sampleRateUnit]) *
        sampleRateUnits[sampleRateUnit],
    ),
    sampleCount: Math.max(
      2,
      Math.round(
        finite('sampleCount', 10000 / sampleCountUnits[sampleCountUnit]) *
          sampleCountUnits[sampleCountUnit],
      ),
    ),
    frequencyHz: Math.max(
      0.000001,
      finite('frequencyHz', 750000 / frequencyUnits[frequencyUnit]) * frequencyUnits[frequencyUnit],
    ),
    phaseDegrees: finite('phaseDegrees', 0),
    dutyCyclePercent: Math.min(95, Math.max(5, finite('dutyCyclePercent', 50))),
    editorColor: color('editorColor', '#7bffb2'),
    waveformColor: color('waveformColor', '#ffe45e'),
  });
}

const DEFAULT_VALUES = normalizeDefaults(globalThis.ARBDRAW_DEFAULTS);

function createDefaultDocument() {
  const durationMs = DEFAULT_VALUES.sampleCount / (DEFAULT_VALUES.sampleRateMSa * 1000);

  return {
    schema: 'arbdraw.waveform',
    version: 1,
    name: 'Waveform 01',
    waveform: {
      type: 'sine',
      highVoltage: DEFAULT_VALUES.highLevelV,
      lowVoltage: DEFAULT_VALUES.lowLevelV,
      durationMs,
      sampleRateMSa: DEFAULT_VALUES.sampleRateMSa,
      frequencyHz: DEFAULT_VALUES.frequencyHz,
      cycles: (DEFAULT_VALUES.frequencyHz * durationMs) / 1000,
      phaseDegrees: DEFAULT_VALUES.phaseDegrees,
      dutyCyclePercent: DEFAULT_VALUES.dutyCyclePercent,
      sampleCount: DEFAULT_VALUES.sampleCount,
      values: [],
    },
  };
}

let projectDocument = createDefaultDocument();

const state = {
  tool: 'pencil',
  zoom: 1,
  history: [],
  redo: [],
  drawing: false,
  lineStart: null,
};

const documentFields = {
  type: 'type',
  high: 'highVoltage',
  low: 'lowVoltage',
  duration: 'durationMs',
  sampleRate: 'sampleRateMSa',
  frequency: 'frequencyHz',
  cycles: 'cycles',
  phase: 'phaseDegrees',
  duty: 'dutyCyclePercent',
  samples: 'sampleCount',
  data: 'values',
};

Object.entries(documentFields).forEach(([stateKey, documentKey]) => {
  Object.defineProperty(state, stateKey, {
    get: () => projectDocument.waveform[documentKey],
    set: (value) => {
      projectDocument.waveform[documentKey] = value;
    },
  });
});

const titles = {
  sine: 'Sine wave',
  square: 'Square wave',
  triangle: 'Triangle wave',
  ramp: 'Ramp wave',
  pulse: 'Pulse wave',
  dc: 'DC level',
  noise: 'White noise',
  custom: 'Custom waveform',
};

const $ = (id) => document.getElementById(id);
