// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Property inputs, timing controls, defaults, and SI-unit selection.
const voltageScaleByLabel = { V: 1, mV: 0.001, µV: 0.000001 },
  amplitudeScaleByLabel = { Vpp: 1, mVpp: 0.001, µVpp: 0.000001 },
  frequencyScaleByLabel = { mHz: 0.001, Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 },
  periodScaleByLabel = { Ms: 1e6, s: 1, ms: 0.001, µs: 1e-6, ns: 1e-9 },
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
  tsResolutionUnitScale = tsResolutionScaleByLabel[DEFAULT_VALUES.tsResolutionUnit] || 1e-9;
const transitionTimeUnitScales = {
  riseTimeInput: transitionTimeScaleByLabel[DEFAULT_VALUES.riseTimeUnit] || 1e-9,
  fallTimeInput: transitionTimeScaleByLabel[DEFAULT_VALUES.fallTimeUnit] || 1e-9,
};

const awgProfileSelect = $('awgProfileSelect');
const awgProfiles = Object.values(globalThis.ARBDRAW_AWG_PROFILES || {});
let selectedAwgProfile = null;

function profileById(id) {
  return awgProfiles.find((profile) => profile.id === id) || awgProfiles[0] || null;
}

function renderAwgProfiles() {
  if (!awgProfileSelect) return;
  awgProfileSelect.replaceChildren(
    ...awgProfiles.map((profile) => new Option(profile.name, profile.id)),
  );
  awgProfileSelect.value =
    globalThis.ARBDRAW_DEFAULT_AWG_PROFILE || awgProfiles[0]?.id || '';
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
    sampleRateUnit: 'MSa/s',
    sampleCount: state.samples,
    sampleCountUnit: 'pts',
    waveformType: state.type,
    nCycles: state.cycles,
    frequencyHz: state.frequency / frequencyUnitScale,
    frequencyUnit: $('frequencyUnitBtn').textContent,
    periodUnit: $('periodUnitBtn').textContent,
    tsResolutionUnit: $('tsResolutionUnitBtn').textContent,
    phaseDegrees: state.phase,
    dutyCyclePercent: state.duty,
    riseTimeSeconds: state.riseTime,
    riseTimeUnit: document.querySelector(
      '.transition-time-unit-button[data-input="riseTimeInput"]',
    ).textContent,
    fallTimeSeconds: state.fallTime,
    fallTimeUnit: document.querySelector(
      '.transition-time-unit-button[data-input="fallTimeInput"]',
    ).textContent,
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
}
$('amplitudeUnitBtn').textContent = DEFAULT_VALUES.amplitudeUnit;
$('frequencyUnitBtn').textContent = DEFAULT_VALUES.frequencyUnit;
$('periodUnitBtn').textContent = DEFAULT_VALUES.periodUnit;
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
  $('samplesEdit').value = state.samples;
  $('rateEdit').value = Number(state.sampleRate.toPrecision(10));
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

function commitTimingInput(kind) {
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
  if (kind === 'rate') {
    if (Math.abs(value - state.sampleRate) <= Math.max(1, state.sampleRate) * 1e-10) {
      renderTiming();
      return;
    }
    state.sampleRate = Math.max(0.000001, value);
    state.duration = state.samples / (state.sampleRate * 1000);
    renderTiming();
    pushHistory();
    draw();
    persistCurrentSettings();
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
    state.samples = Math.min(Math.max(2, samples), maximumSamples);
    renderTiming();
    pushHistory();
    generate();
    persistCurrentSettings();
  } else {
    const samples = Math.min(
      Math.max(2, Math.round(value)),
      Number.isFinite(selectedAwgProfile?.sampleDepth?.max)
        ? selectedAwgProfile.sampleDepth.max
        : Number.POSITIVE_INFINITY,
    );
    if (samples === state.samples) {
      renderTiming();
      return;
    }
    state.samples = samples;
    state.duration = state.samples / (state.sampleRate * 1000);
    renderTiming();
    generate();
  }
}
for (const kind of ['rate', 'samples', 'tsResolution']) {
  const input = $(
    kind === 'rate' ? 'rateEdit' : kind === 'samples' ? 'samplesEdit' : 'tsResolutionEdit',
  );
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      renderTiming();
      input.blur();
    }
  });
  input.addEventListener('blur', () => commitTimingInput(kind));
}
function propertiesDiffer() {
  const values = [
      inputVoltage('highInput'),
      inputVoltage('lowInput'),
      +$('cyclesInput').value,
      inputFrequency(),
      +$('phaseInput').value,
      +$('dutyInput').value,
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
      $('riseTimeInput'),
      $('fallTimeInput'),
    ].every(
      (input) => Number.isFinite(+input.value),
    ) &&
    Number.isInteger(+$('cyclesInput').value) &&
    +$('cyclesInput').value >= 1 &&
    inputFrequency() > 0 &&
    inputTransitionTime('riseTimeInput') >= 0 &&
    inputTransitionTime('fallTimeInput') >= 0
  );
}
function valueChanged(value, current) {
  return Math.abs(value - current) > Math.max(1, Math.abs(current)) * 1e-10;
}
function applyProperties() {
  if (!propertiesValid() || !propertiesDiffer()) return;
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
    valueChanged(+$('dutyInput').value, state.duty);
  syncInputs();
  if (waveformChanged) {
    generate();
    if (amplitudeChanged) refreshScopeTime();
    else refreshScopeVertical();
  } else {
    pushHistory();
    draw();
    if (!$('samplesView').classList.contains('hidden')) renderSamples();
  }
  persistCurrentSettings();
}
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
  if (state.type === 'dc') {
    state.high = m + a;
    state.low = m - a;
    generate('dc', false);
    refreshScopeVertical();
  }
};
$('offsetInput').addEventListener('change', () => {
  if (state.type === 'dc') pushHistory();
});
$('cyclesInput').addEventListener('blur', () => {
  const value = Number($('cyclesInput').value);
  $('cyclesInput').value = Number.isFinite(value) ? Math.max(1, Math.round(value)) : state.cycles;
});
document.querySelectorAll('.inspector input[type="number"]').forEach((input) => {
  input.addEventListener(
    'wheel',
    (event) => {
      if (input.disabled || event.deltaY === 0) return;
      event.preventDefault();
      if (event.deltaY < 0) input.stepUp();
      else input.stepDown();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (input.closest('.serial-section')) commitSerialProperties();
      else applyProperties();
    },
    { passive: false },
  );
});
document.querySelectorAll('.inspector input').forEach((input) => {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
  });
  input.addEventListener('blur', applyProperties);
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
  amplitudeUnitScale = scale;
  $('amplitudeUnitBtn').textContent = label;
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
  voltageUnitScales[inputId] = scale;
  document.querySelector(`.voltage-unit-button[data-input="${inputId}"]`).textContent = label;
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
  for (const id of ['frequency', 'period', 'tsResolution']) {
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
    frequencyUnitScale = scale;
    $('frequencyUnitBtn').textContent = label;

    const hertz = inputFrequency();
    if (Number.isFinite(hertz) && hertz > 0) {
      const periodUnit = displayUnitFor(1 / hertz, periodDisplayUnits);
      periodUnitScale = periodUnit.scale;
      $('periodUnitBtn').textContent = periodUnit.label;
      $('periodInput').value = displayPeriod(hertz);
    }
  } else {
    periodUnitScale = scale;
    $('periodUnitBtn').textContent = label;

    const hertz = inputPeriodFrequency();
    if (Number.isFinite(hertz) && hertz > 0) {
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
