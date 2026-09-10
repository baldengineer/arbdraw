// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Property inputs, timing controls, defaults, and SI-unit selection.
const voltageScaleByLabel = { V: 1, mV: 0.001, µV: 0.000001 },
  amplitudeScaleByLabel = { Vpp: 1, mVpp: 0.001, µVpp: 0.000001 },
  frequencyScaleByLabel = { mHz: 0.001, Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 },
  periodScaleByLabel = { Ms: 1e6, s: 1, ms: 0.001, µs: 1e-6, ns: 1e-9 },
  sampleRateScaleByLabel = { 'pts/s': 1e-6, 'Kpts/s': 0.001, 'Mpts/s': 1, 'Sa/s': 1e-6, 'kSa/s': 0.001, 'MSa/s': 1, 'GSa/s': 1e3 },
  sampleCountScaleByLabel = { pts: 1, Kpts: 1e3, Mpts: 1e6 },
  tsResolutionScaleByLabel = { ps: 1e-12, ns: 1e-9, µs: 1e-6, ms: 0.001, s: 1 },
  transitionTimeScaleByLabel = { ps: 1e-12, ns: 1e-9, µs: 1e-6, ms: 0.001, s: 1 };
let amplitudeUnitScale = amplitudeScaleByLabel[DEFAULT_VALUES.amplitudeUnit];
const voltageUnitScales = {
  highInput: voltageScaleByLabel[DEFAULT_VALUES.highLevelUnit],
  lowInput: voltageScaleByLabel[DEFAULT_VALUES.lowLevelUnit],
  offsetInput: voltageScaleByLabel[DEFAULT_VALUES.offsetUnit],
};
let frequencyUnitScale = frequencyScaleByLabel[DEFAULT_VALUES.frequencyUnit],
  periodUnitScale = periodScaleByLabel[DEFAULT_VALUES.periodUnit],
  sampleRateUnitScale = sampleRateScaleByLabel[DEFAULT_VALUES.sampleRateUnit] || 1,
  sampleCountUnitScale = sampleCountScaleByLabel[DEFAULT_VALUES.sampleCountUnit] || 1,
  tsResolutionUnitScale = tsResolutionScaleByLabel[DEFAULT_VALUES.tsResolutionUnit] || 1e-9;
const sampleRateDisplayUnits = [
  { scale: 1, label: 'Mpts/s' },
  { scale: 0.001, label: 'Kpts/s' },
  { scale: 0.000001, label: 'pts/s' },
];
const transitionTimeUnitScales = {
  riseTimeInput: transitionTimeScaleByLabel[DEFAULT_VALUES.riseTimeUnit] || 1e-9,
  fallTimeInput: transitionTimeScaleByLabel[DEFAULT_VALUES.fallTimeUnit] || 1e-9,
};

const awgProfileSelect = $('awgProfileSelect');
const awgProfiles = Object.values(globalThis.ARBDRAW_AWG_PROFILES || {});
let selectedAwgProfile = null;

function profileById(id) {
  return awgProfiles.find((profile) => profile.id === id) || null;
}

function defaultAwgProfile() {
  return (
    profileById(DEFAULT_VALUES.awgProfileId) ||
    awgProfiles.find((profile) => profile.id === 'audio' || profile.name === 'Audio') ||
    awgProfiles.find((profile) => profile.id === 'other' || profile.name === 'Other') ||
    awgProfiles[0] ||
    null
  );
}

function renderAwgProfiles() {
  if (!awgProfileSelect) return;
  awgProfileSelect.replaceChildren(
    ...awgProfiles.map((profile) => new Option(profile.name, profile.id)),
  );
  awgProfileSelect.value = defaultAwgProfile()?.id || '';
  selectedAwgProfile = profileById(awgProfileSelect.value);
  if (Number.isFinite(selectedAwgProfile?.sampleDepth?.max)) {
    $('samplesEdit').max = selectedAwgProfile.sampleDepth.max;
  }
}

function applyAwgProfile(profile) {
  if (!profile) return;
  selectedAwgProfile = profile;
  if (Number.isFinite(profile.sampleRateMSa)) state.sampleRate = profile.sampleRateMSa;
  if (Number.isFinite(profile.sampleDepth?.default)) state.samples = profile.sampleDepth.default;
  if (Number.isFinite(profile.sampleDepth?.max)) {
    state.samples = Math.min(state.samples, profile.sampleDepth.max);
    $('samplesEdit').max = profile.sampleDepth.max;
  } else {
    $('samplesEdit').removeAttribute('max');
  }
  state.duration = state.samples / (state.sampleRate * 1000);
  renderTiming();
  generate();
  persistCurrentSettings();
}

function restoreAwgSettingsFromDocument(awg = {}) {
  const profile = profileById(awg.profileId);
  if (profile) {
    selectedAwgProfile = profile;
    awgProfileSelect.value = profile.id;
    if (Number.isFinite(profile.sampleDepth?.max)) $('samplesEdit').max = profile.sampleDepth.max;
    else $('samplesEdit').removeAttribute('max');
  }
  const rate = Number(awg.sampleRateMSa),
    samples = Number(awg.sampleCount),
    maximumSamples = Number.isFinite(selectedAwgProfile?.sampleDepth?.max)
      ? selectedAwgProfile.sampleDepth.max
      : Number.POSITIVE_INFINITY;
  if (Number.isFinite(rate) && rate > 0) state.sampleRate = rate;
  if (Number.isFinite(samples) && samples >= 2)
    state.samples = Math.min(Math.round(samples), maximumSamples);
  state.duration = state.samples / (state.sampleRate * 1000);
}

renderAwgProfiles();
awgProfileSelect?.addEventListener('change', () => {
  applyAwgProfile(profileById(awgProfileSelect.value));
});
awgProfileSelect?.addEventListener('dblclick', () => {
  applyAwgProfile(profileById(awgProfileSelect.value));
});
awgProfileSelect?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') applyAwgProfile(profileById(awgProfileSelect.value));
});

function persistCurrentSettings() {
  const toolNames = { pointer: 'Pointer', pencil: 'Edit', erase: 'Delete' },
    serial = typeof serialSettings === 'function' ? serialSettings() : {};
  persistSettings({
    highLevelV: state.high / voltageUnitScales.highInput,
    lowLevelV: state.low / voltageUnitScales.lowInput,
    offsetV: ((state.high + state.low) / 2) / voltageUnitScales.offsetInput,
    amplitudeVpp: (state.high - state.low) / amplitudeUnitScale,
    highLevelUnit: $('highInput').closest('label').querySelector('.voltage-unit-button').textContent,
    lowLevelUnit: $('lowInput').closest('label').querySelector('.voltage-unit-button').textContent,
    offsetUnit: $('offsetInput').closest('label').querySelector('.voltage-unit-button').textContent,
    amplitudeUnit: $('amplitudeUnitBtn').textContent,
    sampleRateMSa: state.sampleRate,
    sampleRateUnit: $('sampleRateUnitBtn').textContent,
    sampleCount: state.samples,
    sampleCountUnit: $('sampleCountUnitBtn').textContent,
    waveformType: state.type,
    nCycles: state.cycles,
    frequencyHz: state.frequency / frequencyUnitScale,
    frequencyUnit: $('frequencyUnitBtn').textContent,
    periodUnit: $('periodUnitBtn').textContent,
    tsResolutionUnit: $('tsResolutionUnitBtn').textContent,
    phaseDegrees: state.phase,
    dutyCyclePercent: state.duty,
    symmetryPercent: state.symmetry,
    rcTau: state.rcTau,
    riseTimeSeconds: state.riseTime,
    riseTimeUnit: document.querySelector(
      '.transition-time-unit-button[data-input="riseTimeInput"]',
    ).textContent,
    fallTimeSeconds: state.fallTime,
    fallTimeUnit: document.querySelector(
      '.transition-time-unit-button[data-input="fallTimeInput"]',
    ).textContent,
    noiseColor: state.noiseColor,
    filtersEnabled: state.filters?.enabled !== false,
    noisePercent: state.filters?.noisePercent ?? DEFAULT_VALUES.noisePercent,
    noisePercentMax: DEFAULT_VALUES.noisePercentMax,
    serialProtocol: serial.protocol,
    serialBaud: serial.baud,
    serialWordSize: serial.wordSize,
    serialBitOrder: serial.bitOrder,
    serialInvertData: serial.invertData,
    serialParity: serial.parity,
    serialStartBit: serial.startBit,
    serialPreIdleBits: serial.preIdleBits,
    serialPostIdleBits: serial.postIdleBits,
    serialStopBits: serial.stopBits,
    serialPayload: serial.payload,
    serialBinaryPattern: serial.binaryPattern,
    serial_debug: DEFAULT_VALUES.serial_debug,
    editor_tool: toolNames[state.tool] || DEFAULT_VALUES.editor_tool,
    editorColor: DEFAULT_VALUES.editorColor,
    waveformColor: DEFAULT_VALUES.waveformColor,
    waveformVerticalDivisions:
      typeof scopeState !== 'undefined'
        ? scopeState.verticalDivisions
        : DEFAULT_VALUES.waveformVerticalDivisions,
    awgProfileId: selectedAwgProfile?.id || defaultAwgProfile()?.id || 'other',
  });
}
function displayAmplitude(volts) {
  return Number((volts / amplitudeUnitScale).toPrecision(10));
}
function displayVoltage(inputId, volts) {
  return Number((volts / voltageUnitScales[inputId]).toPrecision(10));
}
function inputVoltage(inputId) {
  return +$(inputId).value * voltageUnitScales[inputId];
}
function displayFrequency(hertz) {
  return Number((hertz / frequencyUnitScale).toPrecision(10));
}
function inputFrequency() {
  return +$('frequencyInput').value * frequencyUnitScale;
}
function displayPeriod(hertz) {
  return Number((1 / hertz / periodUnitScale).toPrecision(10));
}
function inputPeriodFrequency() {
  return 1 / (+$('periodInput').value * periodUnitScale);
}
function displayTransitionTime(inputId, seconds) {
  return Number((seconds / transitionTimeUnitScales[inputId]).toPrecision(10));
}
function inputTransitionTime(inputId) {
  return +$(inputId).value * transitionTimeUnitScales[inputId];
}
function renderTransitionTimes() {
  $('riseTimeInput').value = displayTransitionTime('riseTimeInput', state.riseTime);
  $('fallTimeInput').value = displayTransitionTime('fallTimeInput', state.fallTime);
  ARBDRAW_FIELDS.formatInputs();
}
$('amplitudeUnitBtn').textContent = DEFAULT_VALUES.amplitudeUnit;
$('frequencyUnitBtn').textContent = DEFAULT_VALUES.frequencyUnit;
$('periodUnitBtn').textContent = DEFAULT_VALUES.periodUnit;
$('sampleRateUnitBtn').textContent =
  sampleRateDisplayUnits.find((unit) => unit.scale === sampleRateUnitScale)?.label || 'Mpts/s';
$('sampleCountUnitBtn').textContent = DEFAULT_VALUES.sampleCountUnit;
$('tsResolutionUnitBtn').textContent = DEFAULT_VALUES.tsResolutionUnit;
document.querySelector('.transition-time-unit-button[data-input="riseTimeInput"]').textContent =
  DEFAULT_VALUES.riseTimeUnit;
document.querySelector('.transition-time-unit-button[data-input="fallTimeInput"]').textContent =
  DEFAULT_VALUES.fallTimeUnit;
document.querySelector('.voltage-unit-button[data-input="highInput"]').textContent =
  DEFAULT_VALUES.highLevelUnit;
document.querySelector('.voltage-unit-button[data-input="lowInput"]').textContent =
  DEFAULT_VALUES.lowLevelUnit;
document.querySelector('.voltage-unit-button[data-input="offsetInput"]').textContent =
  DEFAULT_VALUES.offsetUnit;
function renderTiming() {
  $('samplesEdit').value = Number((state.samples / sampleCountUnitScale).toPrecision(10));
  $('rateEdit').value = Number((state.sampleRate / sampleRateUnitScale).toPrecision(10));
  $('rateEdit').min = 0.000001 / sampleRateUnitScale;
  $('rateEdit').step = 0.000001 / sampleRateUnitScale;
  $('samplesEdit').min = 2 / sampleCountUnitScale;
  $('samplesEdit').step = 1 / sampleCountUnitScale;
  if (Number.isFinite(selectedAwgProfile?.sampleDepth?.max))
    $('samplesEdit').max = selectedAwgProfile.sampleDepth.max / sampleCountUnitScale;
  $('tsResolutionEdit').value = Number(
    ((state.duration / 1000 / Math.max(1, state.samples - 1)) / tsResolutionUnitScale).toPrecision(10),
  );
  $('sampleRateField').title = 'Not used but saved in the JSON.';
  $('samplesField').removeAttribute('title');
  renderAwgTiming();
}
function renderFrequency() {
  $('frequencyInput').value = displayFrequency(state.frequency);
  $('periodInput').value = displayPeriod(state.frequency);
  renderAwgTiming();
}
function renderAwgTiming() {
  if (!$('awgFrequencyEdit') || !Number.isFinite(state.frequency) || state.frequency <= 0) return;
  const awgFrequency = state.frequency / Math.max(1, state.cycles),
    awgPeriod = 1 / awgFrequency,
    frequencyUnit = displayUnitFor(awgFrequency, frequencyDisplayUnits),
    periodUnit = displayUnitFor(awgPeriod, periodDisplayUnits);
  $('awgFrequencyEdit').value = Number((awgFrequency / frequencyUnit.scale).toPrecision(10));
  $('awgFrequencyUnit').textContent = frequencyUnit.label;
  $('awgPeriodEdit').value = Number((awgPeriod / periodUnit.scale).toPrecision(10));
  $('awgPeriodUnit').textContent = periodUnit.label;
  projectDocument.AWG = {
    ...(projectDocument.AWG || {}),
    profileId: selectedAwgProfile?.id || globalThis.ARBDRAW_DEFAULT_AWG_PROFILE || 'other',
    sampleRateType: selectedAwgProfile?.sampleRateType || 'Fixed',
    sampleRateMSa: state.sampleRate,
    sampleCount: state.samples,
    tsResolutionSeconds: state.duration / 1000 / Math.max(1, state.samples - 1),
    frequencyHz: awgFrequency,
    periodSeconds: awgPeriod,
  };
  ARBDRAW_FIELDS.formatInputs();
}
function formatRate(value) {
  return value >= 100
    ? value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : value >= 1
      ? value.toFixed(3)
      : value.toPrecision(4);
}
function formatDuration(value) {
  if (value < 0.001) return (value * 1e6).toFixed(2) + ' ns';
  if (value < 1) return (value * 1000).toFixed(3) + ' µs';
  if (value < 1000) return value.toFixed(3) + ' ms';
  return (value / 1000).toFixed(3) + ' s';
}
function syncInputs() {
  state.high = inputVoltage('highInput');
  state.low = inputVoltage('lowInput');
  if (state.high < state.low) [state.high, state.low] = [state.low, state.high];
  state.cycles = Math.max(1, Math.round(+$('cyclesInput').value));
  state.frequency = Math.max(0.000001, inputFrequency());
  state.phase = +$('phaseInput').value;
  state.duty = +$('dutyInput').value;
  state.symmetry = +$('symmetryInput').value;
  state.rcTau = Math.max(0.000001, +$('rcTauInput').value);
  state.riseTime = Math.max(0, inputTransitionTime('riseTimeInput'));
  state.fallTime = Math.max(0, inputTransitionTime('fallTimeInput'));
  $('highInput').value = displayVoltage('highInput', state.high);
  $('lowInput').value = displayVoltage('lowInput', state.low);
  $('amplitudeInput').value = displayAmplitude(state.high - state.low);
  $('offsetInput').value = displayVoltage('offsetInput', (state.high + state.low) / 2);
  $('cyclesInput').value = state.cycles;
  $('dutyValue').textContent = state.duty + '%';
  renderTransitionTimes();
  renderFrequency();
  renderTiming();
}

let waveformPreviewTransaction = null;

function beginWaveformPreview() {
  if (waveformPreviewTransaction) return;
  waveformPreviewTransaction = {
    snapshot: cloneWaveform(),
    historyLength: state.history.length,
    redo: state.redo.map((snapshot) => cloneWaveform(snapshot)),
  };
  pushHistory();
}

function finishWaveformPreview() {
  if (!waveformPreviewTransaction) return false;
  pushHistory();
  persistCurrentSettings();
  waveformPreviewTransaction = null;
  return true;
}

function cancelWaveformPreview() {
  if (!waveformPreviewTransaction) return;
  const { snapshot, historyLength, redo } = waveformPreviewTransaction;
  restoreWaveform(snapshot);
  state.history.length = historyLength;
  state.redo = redo;
  waveformPreviewTransaction = null;
}

function commitTimingInput(kind, { preview = false } = {}) {
  const input = kind === 'rate'
      ? $('rateEdit')
      : kind === 'samples'
        ? $('samplesEdit')
        : $('tsResolutionEdit'),
    value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) {
    renderTiming();
    return;
  }
  const wasPreviewing = Boolean(waveformPreviewTransaction);
  if (kind === 'rate') {
    const sampleRate = value * sampleRateUnitScale;
    if (Math.abs(sampleRate - state.sampleRate) <= Math.max(1, state.sampleRate) * 1e-10) {
      renderTiming();
      if (!preview) finishWaveformPreview();
      return;
    }
    if (preview) beginWaveformPreview();
    globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
    globalThis.updateAudioPlaybackButton?.();
    state.sampleRate = Math.max(0.000001, sampleRate);
    state.duration = state.samples / (state.sampleRate * 1000);
    renderTiming();
    draw();
    if (!preview && !wasPreviewing) {
      pushHistory();
      persistCurrentSettings();
    } else if (!preview) finishWaveformPreview();
  } else if (kind === 'tsResolution') {
    const desiredResolutionSeconds = value * tsResolutionUnitScale,
      durationSeconds = state.samples / (state.sampleRate * 1e6),
      samples = Math.ceil(durationSeconds / desiredResolutionSeconds) + 1,
      maximumSamples = Number.isFinite(selectedAwgProfile?.sampleDepth?.max)
        ? selectedAwgProfile.sampleDepth.max
        : Number.POSITIVE_INFINITY;
    if (
      !Number.isFinite(desiredResolutionSeconds) ||
      desiredResolutionSeconds <= 0 ||
      !Number.isFinite(samples)
    ) {
      renderTiming();
      return;
    }
    if (preview) beginWaveformPreview();
    state.samples = Math.min(Math.max(2, samples), maximumSamples);
    renderTiming();
    generate(state.type, !preview && !wasPreviewing, !preview && !wasPreviewing);
    if (!preview && wasPreviewing) finishWaveformPreview();
  } else {
    const samples = Math.min(
      Math.max(2, Math.round(value * sampleCountUnitScale)),
      Number.isFinite(selectedAwgProfile?.sampleDepth?.max)
        ? selectedAwgProfile.sampleDepth.max
        : Number.POSITIVE_INFINITY,
    );
    if (samples === state.samples) {
      renderTiming();
      if (!preview) finishWaveformPreview();
      return;
    }
    if (preview) beginWaveformPreview();
    state.samples = samples;
    state.duration = state.samples / (state.sampleRate * 1000);
    renderTiming();
    generate(state.type, !preview && !wasPreviewing, !preview && !wasPreviewing);
    if (!preview && wasPreviewing) finishWaveformPreview();
  }
}
const timingFieldControllers = [];
for (const kind of ['rate', 'samples', 'tsResolution']) {
  const input = $(
    kind === 'rate' ? 'rateEdit' : kind === 'samples' ? 'samplesEdit' : 'tsResolutionEdit',
  );
  timingFieldControllers.push(
    ARBDRAW_FIELDS.attach(
      input,
      {
        ...(ARBDRAW_FIELD_DEFINITIONS.timing[input.id] || {}),
        id: input.id,
        kind: 'number',
        label: ARBDRAW_FIELD_DEFINITIONS.timing[input.id]?.label || input.getAttribute('aria-label') || kind,
        behavior: 'commitOnExit',
        constraints: { min: Number(input.min) || 0 },
      },
      {
        commit: () => commitTimingInput(kind),
        preview: (_, meta) => {
          if (meta.valid) commitTimingInput(kind, { preview: true });
        },
        cancel: () => {
          cancelWaveformPreview();
          renderTiming();
        },
      },
    ),
  );
}
for (const id of ['awgFrequencyEdit', 'awgPeriodEdit']) {
  ARBDRAW_FIELDS.applyDefinition($(id), {
    ...(ARBDRAW_FIELD_DEFINITIONS.timing[id] || {}),
    id,
  });
}
function propertiesDiffer() {
  const values = [
      inputVoltage('highInput'),
      inputVoltage('lowInput'),
      +$('cyclesInput').value,
      inputFrequency(),
      +$('phaseInput').value,
      +$('dutyInput').value,
      +$('symmetryInput').value,
      +$('rcTauInput').value,
      inputTransitionTime('riseTimeInput'),
      inputTransitionTime('fallTimeInput'),
    ],
    current = [
      state.high,
      state.low,
      state.cycles,
      state.frequency,
      state.phase,
      state.duty,
      state.symmetry,
      state.rcTau,
      state.riseTime,
      state.fallTime,
    ];
  return values.some(
    (value, index) =>
      !Number.isFinite(value) ||
      Math.abs(value - current[index]) > Math.max(1, Math.abs(current[index])) * 1e-10,
  );
}
function propertiesValid() {
  return (
    [
      $('highInput'),
      $('lowInput'),
      $('cyclesInput'),
      $('frequencyInput'),
      $('phaseInput'),
      $('dutyInput'),
      $('symmetryInput'),
      $('rcTauInput'),
      $('riseTimeInput'),
      $('fallTimeInput'),
    ].every(
      (input) => Number.isFinite(+input.value),
    ) &&
    Number.isInteger(+$('cyclesInput').value) &&
    +$('cyclesInput').value >= 1 &&
    inputFrequency() > 0 &&
    +$('symmetryInput').value >= 0 &&
    +$('symmetryInput').value <= 100 &&
    +$('rcTauInput').value > 0 &&
    inputTransitionTime('riseTimeInput') >= 0 &&
    inputTransitionTime('fallTimeInput') >= 0
  );
}
function valueChanged(value, current) {
  return Math.abs(value - current) > Math.max(1, Math.abs(current)) * 1e-10;
}
function applyProperties({ preview = false } = {}) {
  if (!propertiesValid()) return false;
  const differs = propertiesDiffer();
  if (!differs && !waveformPreviewTransaction) return false;
  if (preview && differs) beginWaveformPreview();
  const frequencyChanged = valueChanged(inputFrequency(), state.frequency);
  const transitionChanged =
    valueChanged(inputTransitionTime('riseTimeInput'), state.riseTime) ||
    valueChanged(inputTransitionTime('fallTimeInput'), state.fallTime);
  const amplitudeChanged =
    valueChanged(inputVoltage('highInput'), state.high) ||
    valueChanged(inputVoltage('lowInput'), state.low);
  const waveformChanged =
    amplitudeChanged ||
    ((state.type === 'serial' || state.type === 'square' || state.type === 'pulse') &&
      frequencyChanged) ||
    transitionChanged ||
    valueChanged(+$('cyclesInput').value, state.cycles) ||
    valueChanged(+$('phaseInput').value, state.phase) ||
    valueChanged(+$('dutyInput').value, state.duty) ||
    valueChanged(+$('symmetryInput').value, state.symmetry) ||
    valueChanged(+$('rcTauInput').value, state.rcTau);
  syncInputs();
  if (waveformChanged) {
    generate(state.type, !preview && !waveformPreviewTransaction, !preview && !waveformPreviewTransaction);
    if (amplitudeChanged) refreshScopeTime();
    else refreshScopeVertical();
  } else {
    draw();
    if (!$('samplesView').classList.contains('hidden')) renderSamples();
  }
  if (preview) return true;
  if (waveformPreviewTransaction) finishWaveformPreview();
  else {
    if (!waveformChanged) pushHistory();
    persistCurrentSettings();
  }
  return true;
}
document.querySelectorAll('[data-symmetry]').forEach((button) => {
  button.addEventListener('click', () => {
    $('symmetryInput').value = button.dataset.symmetry;
    applyProperties();
  });
});
$('dutyInput').oninput = () => {
  if ($('dutyInput').disabled) return;
  state.duty = +$('dutyInput').value;
  $('dutyValue').textContent = state.duty + '%';
  generate(state.type, false);
  refreshScopeVertical();
};
$('dutyInput').addEventListener('change', () => pushHistory());
$('frequencyInput').addEventListener('input', () => {
  const value = inputFrequency();
  if (value > 0) $('periodInput').value = displayPeriod(value);
});
$('periodInput').addEventListener('input', () => {
  const value = inputPeriodFrequency();
  if (value > 0) $('frequencyInput').value = displayFrequency(value);
});
$('amplitudeInput').oninput = () => {
  const mid = (inputVoltage('highInput') + inputVoltage('lowInput')) / 2,
    a = (Math.max(0, +$('amplitudeInput').value) * amplitudeUnitScale) / 2;
  $('highInput').value = displayVoltage('highInput', mid + a);
  $('lowInput').value = displayVoltage('lowInput', mid - a);
};
$('offsetInput').oninput = () => {
  const a = (inputVoltage('highInput') - inputVoltage('lowInput')) / 2,
    m = inputVoltage('offsetInput');
  $('highInput').value = displayVoltage('highInput', m + a);
  $('lowInput').value = displayVoltage('lowInput', m - a);
};
$('offsetInput').addEventListener('change', () => {
  if (state.type === 'dc' && !waveformPreviewTransaction) pushHistory();
});
$('cyclesInput').addEventListener('blur', () => {
  const value = Number($('cyclesInput').value);
  $('cyclesInput').value = Number.isFinite(value) ? Math.max(1, Math.round(value)) : state.cycles;
});
// All ordinary inspector fields share the same draft, validation, Enter, and
// Escape lifecycle. Feature-specific input/preview handlers above remain
// responsible for coupled values and waveform rendering.
const inspectorFieldControllers = [];
document
  .querySelectorAll('.inspector input:not(.switch-input):not(#dutyInput)')
  .forEach((input) => {
    if (input.closest('.serial-section')) return;
    inspectorFieldControllers.push(
      ARBDRAW_FIELDS.attach(
        input,
        {
          ...(ARBDRAW_FIELD_DEFINITIONS.inspector[input.id] || {}),
          id: input.id,
          kind: input.type === 'number' ? 'number' : input.type === 'range' ? 'range' : 'text',
          label: ARBDRAW_FIELD_DEFINITIONS.inspector[input.id]?.label || input.getAttribute('aria-label') || input.id,
          constraints: input.type === 'number'
            ? {
                ...(ARBDRAW_FIELD_DEFINITIONS.inspector[input.id]?.constraints || {}),
                ...(input.min !== '' ? { min: Number(input.min) } : {}),
                ...(input.max !== '' ? { max: Number(input.max) } : {}),
              }
            : {},
          behavior: 'commitOnExit',
        },
        {
          commit: () => applyProperties(),
          preview: (_, meta) => {
            if (meta.valid) applyProperties({ preview: true });
          },
          cancel: () => cancelWaveformPreview(),
        },
      ),
    );
  });
const propertyDefaultMap = {
  highInput: 'highLevelV',
  lowInput: 'lowLevelV',
  offsetInput: 'offsetV',
  amplitudeInput: 'amplitudeVpp',
  cyclesInput: 'nCycles',
  frequencyInput: 'frequencyHz',
  periodInput: 'frequencyHz',
  phaseInput: 'phaseDegrees',
  dutyInput: 'dutyCyclePercent',
  symmetryInput: 'symmetryPercent',
  rcTauInput: 'rcTau',
  riseTimeInput: 'riseTimeSeconds',
  fallTimeInput: 'fallTimeSeconds',
};
function setPropertyInputDefault(input) {
  const key = propertyDefaultMap[input.id];
  if (!key) return;
  input.value =
    input.id === 'periodInput'
      ? displayPeriod(DEFAULT_VALUES.frequencyHz)
      : input.id === 'frequencyInput'
        ? displayFrequency(DEFAULT_VALUES.frequencyHz)
        : input.id === 'riseTimeInput' || input.id === 'fallTimeInput'
          ? displayTransitionTime(input.id, DEFAULT_VALUES[key])
          : input.id === 'amplitudeInput'
            ? displayAmplitude(DEFAULT_VALUES.amplitudeVpp)
            : voltageUnitScales[input.id]
              ? displayVoltage(input.id, DEFAULT_VALUES[key])
              : DEFAULT_VALUES[key];
  input.dispatchEvent(new Event('input', { bubbles: true }));
  applyProperties();
}
$('defaultAllBtn').onclick = () => {
  if (!window.confirm('Reset all settings to defaults? This will replace your saved settings.'))
    return;
  resetStoredSettings();
  window.location.reload();
};
let contextPropertyInput = null;
document.querySelectorAll('.inspector input').forEach((input) =>
  input.addEventListener('contextmenu', (event) => {
    if (input.closest('.serial-section')) return;
    event.preventDefault();
    contextPropertyInput = input;
    const menu = $('propertyContextMenu'),
      width = 150,
      height = 42;
    menu.style.left = Math.min(event.clientX, innerWidth - width - 8) + 'px';
    menu.style.top = Math.min(event.clientY, innerHeight - height - 8) + 'px';
    menu.classList.add('open');
    $('setFieldDefaultBtn').focus();
  }),
);
function closePropertyContextMenu() {
  $('propertyContextMenu').classList.remove('open');
}
$('setFieldDefaultBtn').onclick = () => {
  if (contextPropertyInput) setPropertyInputDefault(contextPropertyInput);
  closePropertyContextMenu();
};
function closeAmplitudeUnitMenu() {
  $('amplitudeUnitMenu').classList.remove('open');
  $('amplitudeUnitBtn').setAttribute('aria-expanded', 'false');
}
$('amplitudeUnitBtn').onclick = (event) => {
  event.stopPropagation();
  const button = $('amplitudeUnitBtn'),
    menu = $('amplitudeUnitMenu'),
    rect = button.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, innerWidth - 100) + 'px';
  menu.style.top = rect.bottom + 4 + 'px';
  menu.classList.add('open');
  button.setAttribute('aria-expanded', 'true');
  menu
    .querySelectorAll('button')
    .forEach((option) =>
      option.setAttribute('aria-checked', String(+option.dataset.scale === amplitudeUnitScale)),
    );
};
function selectAmplitudeUnit(scale, label) {
  const currentLabel = $('amplitudeUnitBtn').textContent,
    currentValue = Number($('amplitudeInput').value);
  amplitudeUnitScale = scale;
  $('amplitudeUnitBtn').textContent = label;
  if (Number.isFinite(currentValue))
    $('amplitudeInput').value = ARBDRAW_FIELDS.convert(currentValue, currentLabel, label, 'amplitude');
  $('amplitudeInput').dispatchEvent(new Event('input', { bubbles: true }));
  applyProperties();
  persistCurrentSettings();
  closeAmplitudeUnitMenu();
}
$('amplitudeUnitMenu')
  .querySelectorAll('button')
  .forEach(
    (option) =>
      (option.onclick = () => selectAmplitudeUnit(+option.dataset.scale, option.dataset.label)),
  );
const amplitudeSuffixes = {
  u: { scale: 0.000001, label: 'µVpp' },
  m: { scale: 0.001, label: 'mVpp' },
  v: { scale: 1, label: 'Vpp' },
};
$('amplitudeInput').addEventListener('keydown', (event) => {
  const unit = amplitudeSuffixes[event.key.toLowerCase()];
  if (!unit || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  selectAmplitudeUnit(unit.scale, unit.label);
});
let activeVoltageUnitInput = null;
function closeVoltageUnitMenu() {
  $('voltageUnitMenu').classList.remove('open');
  document
    .querySelectorAll('.voltage-unit-button')
    .forEach((button) => button.setAttribute('aria-expanded', 'false'));
}
document.querySelectorAll('.voltage-unit-button').forEach(
  (button) =>
    (button.onclick = (event) => {
      event.stopPropagation();
      activeVoltageUnitInput = button.dataset.input;
      const menu = $('voltageUnitMenu'),
        rect = button.getBoundingClientRect();
      menu.style.left = Math.min(rect.left, innerWidth - 100) + 'px';
      menu.style.top = rect.bottom + 4 + 'px';
      menu.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
      menu
        .querySelectorAll('button')
        .forEach((option) =>
          option.setAttribute(
            'aria-checked',
            String(+option.dataset.scale === voltageUnitScales[activeVoltageUnitInput]),
          ),
        );
    }),
);
function selectVoltageUnit(inputId, scale, label) {
  const button = document.querySelector(`.voltage-unit-button[data-input="${inputId}"]`),
    currentLabel = button.textContent,
    currentValue = Number($(inputId).value);
  voltageUnitScales[inputId] = scale;
  button.textContent = label;
  if (Number.isFinite(currentValue))
    $(inputId).value = ARBDRAW_FIELDS.convert(currentValue, currentLabel, label, 'voltage');
  $(inputId).dispatchEvent(new Event('input', { bubbles: true }));
  applyProperties();
  persistCurrentSettings();
  closeVoltageUnitMenu();
}
$('voltageUnitMenu')
  .querySelectorAll('button')
  .forEach(
    (option) =>
      (option.onclick = () => {
        if (activeVoltageUnitInput)
          selectVoltageUnit(activeVoltageUnitInput, +option.dataset.scale, option.dataset.label);
      }),
  );
const voltageSuffixes = {
  u: { scale: 0.000001, label: 'µV' },
  m: { scale: 0.001, label: 'mV' },
  v: { scale: 1, label: 'V' },
};
for (const inputId of Object.keys(voltageUnitScales))
  $(inputId).addEventListener('keydown', (event) => {
    const unit = voltageSuffixes[event.key.toLowerCase()];
    if (!unit || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    selectVoltageUnit(inputId, unit.scale, unit.label);
  });
function closeTimingUnitMenus() {
  for (const id of ['frequency', 'period', 'tsResolution', 'sampleRate', 'sampleCount']) {
    $(id + 'UnitMenu').classList.remove('open');
    $(id + 'UnitBtn').setAttribute('aria-expanded', 'false');
  }
  $('transitionTimeUnitMenu').classList.remove('open');
  document
    .querySelectorAll('.transition-time-unit-button')
    .forEach((button) => button.setAttribute('aria-expanded', 'false'));
}
function openTimingUnitMenu(kind) {
  const button = $(kind + 'UnitBtn'),
    menu = $(kind + 'UnitMenu'),
    scale = kind === 'frequency'
      ? frequencyUnitScale
      : kind === 'period'
        ? periodUnitScale
        : kind === 'sampleRate'
          ? sampleRateUnitScale
          : kind === 'sampleCount'
            ? sampleCountUnitScale
            : tsResolutionUnitScale;
  menu.classList.add('open');
  const buttonRect = button.getBoundingClientRect(),
    menuRect = menu.getBoundingClientRect(),
    left = Math.max(4, Math.min(buttonRect.left, innerWidth - menuRect.width - 4)),
    belowTop = buttonRect.bottom + 4,
    aboveTop = buttonRect.top - menuRect.height - 4,
    top = belowTop + menuRect.height <= innerHeight - 4 ? belowTop : Math.max(4, aboveTop);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  button.setAttribute('aria-expanded', 'true');
  menu
    .querySelectorAll('button')
    .forEach((option) =>
      option.setAttribute('aria-checked', String(+option.dataset.scale === scale)),
    );
}

const frequencyDisplayUnits = [
  { scale: 1e9, label: 'GHz' },
  { scale: 1e6, label: 'MHz' },
  { scale: 1e3, label: 'kHz' },
  { scale: 1, label: 'Hz' },
  { scale: 0.001, label: 'mHz' },
];

const periodDisplayUnits = [
  { scale: 1e6, label: 'Ms' },
  { scale: 1, label: 's' },
  { scale: 0.001, label: 'ms' },
  { scale: 0.000001, label: 'µs' },
  { scale: 0.000000001, label: 'ns' },
];

function displayUnitFor(value, units) {
  return units.find((unit) => value >= unit.scale) || units.at(-1);
}

function selectTimingUnit(kind, scale, label) {
  if (kind === 'frequency') {
    const currentLabel = $('frequencyUnitBtn').textContent,
      currentValue = Number($('frequencyInput').value),
      hertz = Number.isFinite(currentValue)
        ? ARBDRAW_FIELDS.convert(currentValue, currentLabel, 'Hz', 'frequency')
        : Number.NaN;
    frequencyUnitScale = scale;
    $('frequencyUnitBtn').textContent = label;

    if (Number.isFinite(hertz) && hertz > 0) {
      $('frequencyInput').value = ARBDRAW_FIELDS.convert(hertz, 'Hz', label, 'frequency');
      const periodUnit = displayUnitFor(1 / hertz, periodDisplayUnits);
      periodUnitScale = periodUnit.scale;
      $('periodUnitBtn').textContent = periodUnit.label;
      $('periodInput').value = displayPeriod(hertz);
    }
  } else {
    const currentLabel = $('periodUnitBtn').textContent,
      currentValue = Number($('periodInput').value),
      seconds = Number.isFinite(currentValue)
        ? ARBDRAW_FIELDS.convert(currentValue, currentLabel, 's', 'period')
        : Number.NaN;
    periodUnitScale = scale;
    $('periodUnitBtn').textContent = label;

    const hertz = Number.isFinite(seconds) && seconds > 0 ? 1 / seconds : Number.NaN;
    if (Number.isFinite(hertz) && hertz > 0) {
      $('periodInput').value = ARBDRAW_FIELDS.convert(seconds, 's', label, 'period');
      const frequencyUnit = displayUnitFor(hertz, frequencyDisplayUnits);
      frequencyUnitScale = frequencyUnit.scale;
      $('frequencyUnitBtn').textContent = frequencyUnit.label;
      $('frequencyInput').value = displayFrequency(hertz);
    }
  }

  applyProperties();
  persistCurrentSettings();
  closeTimingUnitMenus();
}
for (const kind of ['frequency', 'period']) {
  $(kind + 'UnitBtn').onclick = (event) => {
    event.stopPropagation();
    openTimingUnitMenu(kind);
  };
  $(kind + 'UnitMenu')
    .querySelectorAll('button')
    .forEach(
      (option) =>
        (option.onclick = () =>
          selectTimingUnit(kind, +option.dataset.scale, option.dataset.label)),
    );
}
function selectTsResolutionUnit(scale, label) {
  tsResolutionUnitScale = scale;
  $('tsResolutionUnitBtn').textContent = label;
  renderTiming();
  persistCurrentSettings();
  closeTimingUnitMenus();
}
$('sampleRateUnitBtn').onclick = (event) => {
  event.stopPropagation();
  openTimingUnitMenu('sampleRate');
};
$('sampleRateUnitMenu').querySelectorAll('button').forEach(
  (option) => (option.onclick = () => {
    sampleRateUnitScale = +option.dataset.scale;
    $('sampleRateUnitBtn').textContent = option.dataset.label;
    renderTiming();
    persistCurrentSettings();
    closeTimingUnitMenus();
  }),
);
$('sampleCountUnitBtn').onclick = (event) => {
  event.stopPropagation();
  openTimingUnitMenu('sampleCount');
};
$('sampleCountUnitMenu').querySelectorAll('button').forEach(
  (option) => (option.onclick = () => {
    sampleCountUnitScale = +option.dataset.scale;
    $('sampleCountUnitBtn').textContent = option.dataset.label;
    renderTiming();
    persistCurrentSettings();
    closeTimingUnitMenus();
  }),
);
$('tsResolutionUnitBtn').onclick = (event) => {
  event.stopPropagation();
  openTimingUnitMenu('tsResolution');
};
$('tsResolutionUnitMenu').querySelectorAll('button').forEach(
  (option) => (option.onclick = () => selectTsResolutionUnit(+option.dataset.scale, option.dataset.label)),
);
let activeTransitionTimeInput = null;
document.querySelectorAll('.transition-time-unit-button').forEach((button) => {
  button.onclick = (event) => {
    event.stopPropagation();
    activeTransitionTimeInput = button.dataset.input;
    const menu = $('transitionTimeUnitMenu'),
      rect = button.getBoundingClientRect();
    menu.style.left = Math.min(rect.left, innerWidth - 100) + 'px';
    menu.style.top = rect.bottom + 4 + 'px';
    menu.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    menu.querySelectorAll('button').forEach((option) =>
      option.setAttribute(
        'aria-checked',
        String(+option.dataset.scale === transitionTimeUnitScales[activeTransitionTimeInput]),
      ),
    );
  };
});
function selectTransitionTimeUnit(inputId, scale, label) {
  const seconds = inputTransitionTime(inputId);
  transitionTimeUnitScales[inputId] = scale;
  document.querySelector(`.transition-time-unit-button[data-input="${inputId}"]`).textContent =
    label;
  $(inputId).value = displayTransitionTime(inputId, seconds);
  persistCurrentSettings();
  closeTimingUnitMenus();
}
$('transitionTimeUnitMenu').querySelectorAll('button').forEach((option) => {
  option.onclick = () => {
    if (activeTransitionTimeInput)
      selectTransitionTimeUnit(
        activeTransitionTimeInput,
        +option.dataset.scale,
        option.dataset.label,
      );
  };
});
const frequencySuffixes = {
    h: { scale: 1, label: 'Hz' },
    H: { scale: 1, label: 'Hz' },
    k: { scale: 1000, label: 'kHz' },
    K: { scale: 1000, label: 'kHz' },
    m: { scale: 0.001, label: 'mHz' },
    M: { scale: 1000000, label: 'MHz' },
    g: { scale: 1000000000, label: 'GHz' },
    G: { scale: 1000000000, label: 'GHz' },
  },
  periodSuffixes = {
    s: { scale: 1, label: 's' },
    m: { scale: 0.001, label: 'ms' },
    M: { scale: 1000000, label: 'Ms' },
    u: { scale: 0.000001, label: 'µs' },
    U: { scale: 0.000001, label: 'µs' },
    n: { scale: 0.000000001, label: 'ns' },
    N: { scale: 0.000000001, label: 'ns' },
  },
  transitionTimeSuffixes = {
    s: { scale: 1, label: 's' },
    m: { scale: 0.001, label: 'ms' },
    u: { scale: 0.000001, label: 'µs' },
    U: { scale: 0.000001, label: 'µs' },
    n: { scale: 0.000000001, label: 'ns' },
    N: { scale: 0.000000001, label: 'ns' },
    p: { scale: 0.000000000001, label: 'ps' },
    P: { scale: 0.000000000001, label: 'ps' },
  };
$('frequencyInput').addEventListener('keydown', (event) => {
  const unit = frequencySuffixes[event.key];
  if (!unit || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  selectTimingUnit('frequency', unit.scale, unit.label);
});
$('periodInput').addEventListener('keydown', (event) => {
  const unit = periodSuffixes[event.key];
  if (!unit || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  selectTimingUnit('period', unit.scale, unit.label);
});
for (const inputId of Object.keys(transitionTimeUnitScales)) {
  $(inputId).addEventListener('keydown', (event) => {
    const unit = transitionTimeSuffixes[event.key];
    if (!unit || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    selectTransitionTimeUnit(inputId, unit.scale, unit.label);
  });
}
