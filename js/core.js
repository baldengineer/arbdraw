// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
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

  const noisePercentMax = Math.min(100, Math.max(0, finite('noisePercentMax', 10))),
    noisePercent = Math.min(noisePercentMax, Math.max(0, finite('noisePercent', 1)));

  const unit = (key, units, fallback) =>
    Object.hasOwn(units, source[key]) ? source[key] : fallback;

  const highLevelUnit = unit('highLevelUnit', voltageUnits, 'V');
  const lowLevelUnit = unit('lowLevelUnit', voltageUnits, 'V');
  const offsetUnit = unit('offsetUnit', voltageUnits, 'V');
  const amplitudeUnit = unit('amplitudeUnit', amplitudeUnits, 'Vpp');
  const frequencyUnit = unit('frequencyUnit', frequencyUnits, 'Hz');
  const periodUnit = unit('periodUnit', periodUnits, 'µs');
  const tsResolutionUnit = unit('tsResolutionUnit', periodUnits, 'ns');
  const sampleRateUnit = unit('sampleRateUnit', sampleRateUnits, 'MSa/s');
  const sampleCountUnit = unit('sampleCountUnit', sampleCountUnits, 'pts');
  const waveformTypes = ['sine', 'square', 'triangle', 'ramp', 'pulse', 'dc', 'noise', 'custom', 'serial'];

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
    tsResolutionUnit,
    sampleRateUnit,
    sampleCountUnit,
    waveformType: waveformTypes.includes(source.waveformType) ? source.waveformType : 'sine',
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
    nCycles: Math.max(1, Math.round(finite('nCycles', 1))),
    frequencyHz: Math.max(
      0.000001,
      finite('frequencyHz', 750000 / frequencyUnits[frequencyUnit]) * frequencyUnits[frequencyUnit],
    ),
    phaseDegrees: finite('phaseDegrees', 0),
    dutyCyclePercent: Math.min(99, Math.max(1, finite('dutyCyclePercent', 50))),
    filtersEnabled: source.filtersEnabled !== false,
    noisePercent,
    noisePercentMax,
    serialProtocol: ['UART', 'I2C'].includes(source.serialProtocol)
      ? source.serialProtocol
      : 'UART',
    serialBaud: Math.max(1, Math.round(finite('serialBaud', 115200))),
    serialWordSize: [7, 8].includes(Number(source.serialWordSize))
      ? Number(source.serialWordSize)
      : 8,
    serialBitOrder: ['LSB', 'MSB'].includes(source.serialBitOrder)
      ? source.serialBitOrder
      : 'LSB',
    serialInvertData: source.serialInvertData === true,
    serialParity: ['odd', 'even', 'none'].includes(source.serialParity)
      ? source.serialParity
      : 'none',
    serialStartBit: source.serialStartBit !== false,
    serialPreIdleBits: Math.max(0, Math.round(finite('serialPreIdleBits', 1))),
    serialPostIdleBits: Math.max(0, Math.round(finite('serialPostIdleBits', 1))),
    serialStopBits: [1, 2].includes(Number(source.serialStopBits))
      ? Number(source.serialStopBits)
      : 1,
    serialPayload: String(source.serialPayload ?? '0xAA'),
    serialBinaryPattern: /^[01]+$/.test(String(source.serialBinaryPattern || ''))
      ? String(source.serialBinaryPattern)
      : '',
    serial_debug: source.serial_debug === true,
    editor_tool: ['Pointer', 'Edit', 'Delete'].includes(source.editor_tool)
      ? source.editor_tool
      : 'Edit',
    editorColor: color('editorColor', '#7bffb2'),
    waveformColor: color('waveformColor', '#ffe45e'),
    waveformVerticalDivisions: Math.max(
      2,
      Math.round(finite('waveformVerticalDivisions', 10)),
    ),
  });
}

const SETTINGS_STORAGE_KEY = 'arbdraw-settings';

function readStoredSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function persistSettings(settings) {
  try {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...readStoredSettings(), ...settings }),
    );
  } catch {
    // Storage may be unavailable for restricted file or private browsing contexts.
  }
}

function resetStoredSettings() {
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch {
    // Storage may be unavailable for restricted file or private browsing contexts.
  }
}

const STORED_SETTINGS = readStoredSettings();
const DEFAULT_VALUES = normalizeDefaults({
  ...globalThis.ARBDRAW_DEFAULTS,
  ...STORED_SETTINGS,
});
// Merge newly added defaults into the stored settings without overwriting user values.
persistSettings({ ...globalThis.ARBDRAW_DEFAULTS, ...STORED_SETTINGS });

function normalizeFilterSettings(source = {}) {
  const noisePercent = Number(source.noisePercent);
  const cutoff = Number(source.lowPassCutoffHz);
  return {
    enabled: source.enabled !== false,
    noiseEnabled: source.noiseEnabled === true,
    noisePercent: Number.isFinite(noisePercent)
      ? Math.min(DEFAULT_VALUES.noisePercentMax, Math.max(0, noisePercent))
      : DEFAULT_VALUES.noisePercent,
    lowPassEnabled: source.lowPassEnabled === true,
    lowPassCutoffHz: Number.isFinite(cutoff) && cutoff > 0 ? cutoff : null,
  };
}

function createDefaultDocument() {
  const durationMs = DEFAULT_VALUES.sampleCount / (DEFAULT_VALUES.sampleRateMSa * 1000);

  return {
    schema: 'arbdraw.waveform',
    version: 1,
    name: 'Waveform 01',
    AWG: {
      profileId: globalThis.ARBDRAW_DEFAULT_AWG_PROFILE || 'other',
      sampleRateType: 'Fixed',
      sampleRateMSa: DEFAULT_VALUES.sampleRateMSa,
      sampleCount: DEFAULT_VALUES.sampleCount,
      tsResolutionSeconds: durationMs / 1000 / Math.max(1, DEFAULT_VALUES.sampleCount - 1),
      frequencyHz: DEFAULT_VALUES.frequencyHz / Math.max(1, DEFAULT_VALUES.nCycles),
      periodSeconds: Math.max(1, DEFAULT_VALUES.nCycles) / DEFAULT_VALUES.frequencyHz,
    },
    waveform: {
      type: DEFAULT_VALUES.waveformType,
      highVoltage: DEFAULT_VALUES.highLevelV,
      lowVoltage: DEFAULT_VALUES.lowLevelV,
      durationMs,
      sampleRateMSa: DEFAULT_VALUES.sampleRateMSa,
      frequencyHz: DEFAULT_VALUES.frequencyHz,
      cycles: DEFAULT_VALUES.nCycles,
      phaseDegrees: DEFAULT_VALUES.phaseDegrees,
      dutyCyclePercent: DEFAULT_VALUES.dutyCyclePercent,
      filters: {
        enabled: DEFAULT_VALUES.filtersEnabled,
        noiseEnabled: false,
        noisePercent: DEFAULT_VALUES.noisePercent,
        lowPassEnabled: false,
        lowPassCutoffHz: null,
      },
      serial: {
        protocol: DEFAULT_VALUES.serialProtocol,
        baud: DEFAULT_VALUES.serialBaud,
        wordSize: DEFAULT_VALUES.serialWordSize,
        bitOrder: DEFAULT_VALUES.serialBitOrder,
        invertData: DEFAULT_VALUES.serialInvertData,
        parity: DEFAULT_VALUES.serialParity,
        startBit: DEFAULT_VALUES.serialStartBit,
        preIdleBits: DEFAULT_VALUES.serialPreIdleBits,
        postIdleBits: DEFAULT_VALUES.serialPostIdleBits,
        stopBits: DEFAULT_VALUES.serialStopBits,
        payload: DEFAULT_VALUES.serialPayload,
        binaryPattern: DEFAULT_VALUES.serialBinaryPattern,
      },
      sampleCount: DEFAULT_VALUES.sampleCount,
      values: [],
    },
  };
}

let projectDocument = createDefaultDocument();

const state = {
  tool: {
    Pointer: 'pointer',
    Edit: 'pencil',
    Delete: 'erase',
  }[DEFAULT_VALUES.editor_tool],
  waveformRenderMode: 'vectors',
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
  filters: 'filters',
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
  serial: 'Serial data',
};

function normalizeSerialSettings(source = {}, fallback = DEFAULT_VALUES) {
  if (!source || typeof source !== 'object') source = {};
  return {
    protocol: ['UART', 'I2C'].includes(source.protocol) ? source.protocol : fallback.serialProtocol,
    baud:
      Number.isFinite(Number(source.baud)) && Number(source.baud) > 0
        ? Math.round(Number(source.baud))
        : fallback.serialBaud,
    wordSize: [7, 8].includes(Number(source.wordSize))
      ? Number(source.wordSize)
      : fallback.serialWordSize,
    bitOrder: ['LSB', 'MSB'].includes(source.bitOrder)
      ? source.bitOrder
      : fallback.serialBitOrder,
    invertData: typeof source.invertData === 'boolean'
      ? source.invertData
      : fallback.serialInvertData,
    parity: ['odd', 'even', 'none'].includes(source.parity)
      ? source.parity
      : fallback.serialParity,
    startBit: typeof source.startBit === 'boolean' ? source.startBit : fallback.serialStartBit,
    preIdleBits:
      Number.isFinite(Number(source.preIdleBits)) && Number(source.preIdleBits) >= 0
        ? Math.round(Number(source.preIdleBits))
        : fallback.serialPreIdleBits,
    postIdleBits:
      Number.isFinite(Number(source.postIdleBits)) && Number(source.postIdleBits) >= 0
        ? Math.round(Number(source.postIdleBits))
        : fallback.serialPostIdleBits,
    stopBits: [1, 2].includes(Number(source.stopBits))
      ? Number(source.stopBits)
      : fallback.serialStopBits,
    payload: typeof source.payload === 'string' ? source.payload : fallback.serialPayload,
    binaryPattern: /^[01]+$/.test(String(source.binaryPattern || ''))
      ? String(source.binaryPattern)
      : fallback.serialBinaryPattern,
  };
}

const $ = (id) => document.getElementById(id);

function waveformDurationMs() {
  return (1 / state.frequency) * 1000;
}

function axisTimeUnitFor(milliseconds) {
  if (milliseconds >= 1000) return { scaleMs: 1000, label: 's' };
  if (milliseconds >= 1) return { scaleMs: 1, label: 'ms' };
  if (milliseconds >= 0.001) return { scaleMs: 0.001, label: 'µs' };
  return { scaleMs: 0.000001, label: 'ns' };
}

function axisVoltageUnitFor(minimumVolts, maximumVolts) {
  return Math.abs(minimumVolts) < 1 && Math.abs(maximumVolts) < 1
    ? { scaleV: 0.001, label: 'mV' }
    : { scaleV: 1, label: 'V' };
}
