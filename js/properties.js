// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Property inputs, timing controls, defaults, and SI-unit selection.
const voltageScaleByLabel = { V: 1, mV: 0.001, µV: 0.000001 },
  amplitudeScaleByLabel = { Vpp: 1, mVpp: 0.001, µVpp: 0.000001 },
  frequencyScaleByLabel = { mHz: 0.001, Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 },
  periodScaleByLabel = { Ms: 1e6, s: 1, ms: 0.001, µs: 1e-6, ns: 1e-9 };
let amplitudeUnitScale = amplitudeScaleByLabel[DEFAULT_VALUES.amplitudeUnit];
const voltageUnitScales = {
  highInput: voltageScaleByLabel[DEFAULT_VALUES.highLevelUnit],
  lowInput: voltageScaleByLabel[DEFAULT_VALUES.lowLevelUnit],
  offsetInput: voltageScaleByLabel[DEFAULT_VALUES.offsetUnit],
};
let frequencyUnitScale = frequencyScaleByLabel[DEFAULT_VALUES.frequencyUnit],
  periodUnitScale = periodScaleByLabel[DEFAULT_VALUES.periodUnit];
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
$('amplitudeUnitBtn').textContent = DEFAULT_VALUES.amplitudeUnit;
$('frequencyUnitBtn').textContent = DEFAULT_VALUES.frequencyUnit;
$('periodUnitBtn').textContent = DEFAULT_VALUES.periodUnit;
$('noisePercentInput').max = DEFAULT_VALUES.noisePercentMax;
$('noisePercentInput').value = DEFAULT_VALUES.noisePercent;
document.querySelector('.voltage-unit-button[data-input="highInput"]').textContent =
  DEFAULT_VALUES.highLevelUnit;
document.querySelector('.voltage-unit-button[data-input="lowInput"]').textContent =
  DEFAULT_VALUES.lowLevelUnit;
document.querySelector('.voltage-unit-button[data-input="offsetInput"]').textContent =
  DEFAULT_VALUES.offsetUnit;
function renderTiming() {
  state.sampleRate = state.samples / state.duration / 1000;
  $('samplesEdit').value = state.samples;
  $('rateEdit').value = Number(state.sampleRate.toPrecision(10));
  const duration = formatDurationParts(state.duration);
  $('durationEdit').value = duration.value;
  $('durationUnit').textContent = duration.unit;
}
function renderFrequency() {
  $('frequencyInput').value = displayFrequency(state.frequency);
  $('periodInput').value = displayPeriod(state.frequency);
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
function formatDurationParts(value) {
  if (value < 0.001) return { value: (value * 1e6).toFixed(2), unit: 'ns' };
  if (value < 1) return { value: (value * 1000).toFixed(3), unit: 'µs' };
  if (value < 1000) return { value: value.toFixed(3), unit: 'ms' };
  return { value: (value / 1000).toFixed(3), unit: 's' };
}
function syncInputs() {
  state.high = inputVoltage('highInput');
  state.low = inputVoltage('lowInput');
  if (state.high < state.low) [state.high, state.low] = [state.low, state.high];
  state.cycles = Math.max(1, Math.round(+$('cyclesInput').value));
  state.frequency = Math.max(0.000001, inputFrequency());
  state.phase = +$('phaseInput').value;
  state.duty = +$('dutyInput').value;
  $('highInput').value = displayVoltage('highInput', state.high);
  $('lowInput').value = displayVoltage('lowInput', state.low);
  $('amplitudeInput').value = displayAmplitude(state.high - state.low);
  $('offsetInput').value = displayVoltage('offsetInput', (state.high + state.low) / 2);
  $('cyclesInput').value = state.cycles;
  $('dutyValue').textContent = state.duty + '%';
  renderFrequency();
  renderTiming();
}

function commitTimingInput(kind) {
  const input = kind === 'rate' ? $('rateEdit') : $('samplesEdit'),
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
  } else {
    const samples = Math.max(2, Math.round(value));
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
for (const kind of ['rate', 'samples']) {
  const input = $(kind === 'rate' ? 'rateEdit' : 'samplesEdit');
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
function nextLower125(value) {
  if (!Number.isFinite(value) || value <= 0) return value;
  const exponent = Math.floor(Math.log10(value)),
    power = 10 ** exponent,
    normalized = value / power,
    epsilon = 1e-12;
  for (const step of [5, 2, 1]) if (step < normalized - epsilon) return step * power;
  return (5 * power) / 10;
}
function samplesForOneCycle(rateMSa, frequencyHz) {
  return Math.max(2, Math.ceil((rateMSa * 1e6) / frequencyHz));
}
$('oneCycleBtn').onclick = () => {
  let rate = state.sampleRate,
    samples = samplesForOneCycle(rate, state.frequency),
    steps = 0;
  while (samples > state.samples && steps++ < 100) {
    rate = nextLower125(rate);
    samples = samplesForOneCycle(rate, state.frequency);
  }
  if (
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isFinite(samples) ||
    (rate === state.sampleRate && samples === state.samples)
  )
    return;
  state.sampleRate = rate;
  state.samples = samples;
  state.duration = state.samples / (state.sampleRate * 1000);
  renderTiming();
  generate();
  refreshScopeTime();
};
function propertiesDiffer() {
  const values = [
      inputVoltage('highInput'),
      inputVoltage('lowInput'),
      +$('cyclesInput').value,
      inputFrequency(),
      +$('phaseInput').value,
      +$('dutyInput').value,
    ],
    current = [state.high, state.low, state.cycles, state.frequency, state.phase, state.duty];
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
    ].every(
      (input) => Number.isFinite(+input.value),
    ) &&
    Number.isInteger(+$('cyclesInput').value) &&
    +$('cyclesInput').value >= 1 &&
    inputFrequency() > 0
  );
}
function valueChanged(value, current) {
  return Math.abs(value - current) > Math.max(1, Math.abs(current)) * 1e-10;
}
function applyProperties() {
  if (!propertiesValid() || !propertiesDiffer()) return;
  const frequencyChanged = valueChanged(inputFrequency(), state.frequency);
  const amplitudeChanged =
    valueChanged(inputVoltage('highInput'), state.high) ||
    valueChanged(inputVoltage('lowInput'), state.low);
  const waveformChanged =
    amplitudeChanged ||
    (state.type === 'serial' && frequencyChanged) ||
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
$('addNoiseBtn').onclick = () => {
  const input = $('noisePercentInput'),
    percentage = Number(input.value);
  if (!Number.isFinite(percentage)) {
    input.value = 10;
    return;
  }
  input.value = Math.min(DEFAULT_VALUES.noisePercentMax, Math.max(0, percentage));
  addNoise(Number(input.value));
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
};
function setPropertyInputDefault(input) {
  const key = propertyDefaultMap[input.id];
  if (!key) return;
  input.value =
    input.id === 'periodInput'
      ? displayPeriod(DEFAULT_VALUES.frequencyHz)
      : input.id === 'frequencyInput'
        ? displayFrequency(DEFAULT_VALUES.frequencyHz)
        : input.id === 'amplitudeInput'
          ? displayAmplitude(DEFAULT_VALUES.amplitudeVpp)
          : voltageUnitScales[input.id]
            ? displayVoltage(input.id, DEFAULT_VALUES[key])
            : DEFAULT_VALUES[key];
  input.dispatchEvent(new Event('input', { bubbles: true }));
  applyProperties();
}
$('defaultAllBtn').onclick = () => {
  $('highInput').value = displayVoltage('highInput', DEFAULT_VALUES.highLevelV);
  $('lowInput').value = displayVoltage('lowInput', DEFAULT_VALUES.lowLevelV);
  $('offsetInput').value = displayVoltage('offsetInput', DEFAULT_VALUES.offsetV);
  $('amplitudeInput').value = displayAmplitude(DEFAULT_VALUES.amplitudeVpp);
  $('cyclesInput').value = DEFAULT_VALUES.nCycles;
  $('frequencyInput').value = displayFrequency(DEFAULT_VALUES.frequencyHz);
  $('periodInput').value = displayPeriod(DEFAULT_VALUES.frequencyHz);
  $('phaseInput').value = DEFAULT_VALUES.phaseDegrees;
  $('dutyInput').value = DEFAULT_VALUES.dutyCyclePercent;
  $('dutyValue').textContent = DEFAULT_VALUES.dutyCyclePercent + '%';
  $('noisePercentInput').value = DEFAULT_VALUES.noisePercent;
  applyProperties();
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
  for (const id of ['frequency', 'period']) {
    $(id + 'UnitMenu').classList.remove('open');
    $(id + 'UnitBtn').setAttribute('aria-expanded', 'false');
  }
}
function openTimingUnitMenu(kind) {
  const button = $(kind + 'UnitBtn'),
    menu = $(kind + 'UnitMenu'),
    rect = button.getBoundingClientRect(),
    scale = kind === 'frequency' ? frequencyUnitScale : periodUnitScale;
  menu.style.left = Math.min(rect.left, innerWidth - 100) + 'px';
  menu.style.top = rect.bottom + 4 + 'px';
  menu.classList.add('open');
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
