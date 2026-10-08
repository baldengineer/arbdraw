// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Waveform filter settings, property controls, and post-processing.
const LOW_PASS_INITIAL_HZ = 1_000;
const SMOOTHING_INITIAL_WINDOW = 5;
const SMOOTHING_MAX_WINDOW = 101;

function applyNoiseFilter(values, percentage) {
  const span = Math.abs(state.high - state.low) * (percentage / 100);
  return values.map((value) => value + (Math.random() * 2 - 1) * span);
}

function applyLowPassFilter(values, cutoffHz) {
  const sampleRateHz = state.sampleRate * 1e6;
  if (!Number.isFinite(cutoffHz) || cutoffHz <= 0 || cutoffHz >= sampleRateHz / 2)
    return values;
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRateHz);
  const filtered = [values[0]];
  for (let index = 1; index < values.length; index++)
    filtered[index] = filtered[index - 1] + alpha * (values[index] - filtered[index - 1]);
  return filtered;
}

function applySmoothingFilter(values, windowPoints) {
  return ARBDRAW_WAVEFORM_SHAPES.smoothSamples(values, {
    windowPoints,
    low: Math.min(state.low, state.high),
    high: Math.max(state.low, state.high),
  });
}

function applyFilters(values) {
  if (!state.filters?.enabled) return values;
  let filtered = values;
  if (state.filters.noiseEnabled && state.filters.noisePercent > 0)
    filtered = applyNoiseFilter(filtered, state.filters.noisePercent);
  if (state.filters.lowPassEnabled && state.filters.lowPassCutoffHz)
    filtered = applyLowPassFilter(filtered, state.filters.lowPassCutoffHz);
  if (state.filters.smoothingEnabled)
    filtered = applySmoothingFilter(filtered, state.filters.smoothingWindowPoints);
  return filtered;
}

const filterControls = {
  noise: { checkbox: $('noiseFilterEnabled'), input: $('noiseFilterInput'), enabledKey: 'noiseEnabled', valueKey: 'noisePercent' },
  lowPass: { checkbox: $('lowPassFilterEnabled'), input: $('lowPassFilterInput'), enabledKey: 'lowPassEnabled', valueKey: 'lowPassCutoffHz' },
  smoothing: { checkbox: $('smoothingFilterEnabled'), input: $('smoothingFilterInput'), enabledKey: 'smoothingEnabled', valueKey: 'smoothingWindowPoints' },
};

function renderFilterControls() {
  const filters = state.filters || {};
  filterControls.noise.input.max = String(DEFAULT_VALUES.noisePercentMax);
  for (const control of Object.values(filterControls)) {
    const enabled = filters.enabled !== false && filters[control.enabledKey] === true;
    control.checkbox.checked = enabled;
    control.input.disabled = !enabled;
    control.input.setCustomValidity('');
    control.input.removeAttribute('aria-invalid');
  }
  filterControls.noise.input.value = Number.isFinite(filters.noisePercent)
    ? filters.noisePercent : DEFAULT_VALUES.noisePercent;
  filterControls.lowPass.input.value = Number.isFinite(filters.lowPassCutoffHz) && filters.lowPassCutoffHz > 0
    ? filters.lowPassCutoffHz / 1e3 : LOW_PASS_INITIAL_HZ / 1e3;
  filterControls.smoothing.input.value = Number.isFinite(filters.smoothingWindowPoints)
    ? filters.smoothingWindowPoints : SMOOTHING_INITIAL_WINDOW;
}

function regenerateWithFilters(nextFilters) {
  if (!confirmWaveformReplacement(false)) {
    renderFilterControls();
    return false;
  }
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  globalThis.updateAudioPlaybackButton?.();
  state.filters = nextFilters;
  generate(state.type, true, true, false, false);
  refreshScopeVertical();
  persistCurrentSettings();
  renderFilterControls();
  return true;
}

function nextFilterSettings() {
  const filters = { ...state.filters, enabled: true };
  for (const control of Object.values(filterControls))
    filters[control.enabledKey] = control.checkbox.checked;
  return filters;
}

function validFilterValue(kind, rawValue) {
  const value = Number(rawValue);
  if (rawValue === '' || !Number.isFinite(value) || value <= 0)
    return { error: 'Enter a value greater than zero.' };
  if (kind === 'noise' && value > DEFAULT_VALUES.noisePercentMax)
    return { error: `Use a value of at most ${DEFAULT_VALUES.noisePercentMax}%.` };
  if (kind === 'smoothing' && (!Number.isInteger(value) || value < 3 || value > SMOOTHING_MAX_WINDOW || value % 2 === 0))
    return { error: 'Use an odd whole number from 3 to 101.' };
  if (kind === 'lowPass' && !Number.isFinite(value * 1e3))
    return { error: 'Enter a smaller cutoff frequency.' };
  return { value };
}

for (const [kind, control] of Object.entries(filterControls)) {
  control.checkbox.addEventListener('change', () => {
    const next = nextFilterSettings();
    if (control.checkbox.checked) {
      const result = validFilterValue(kind, control.input.value);
      const value = result.error
        ? kind === 'noise' ? DEFAULT_VALUES.noisePercent
          : kind === 'lowPass' ? LOW_PASS_INITIAL_HZ / 1e3 : SMOOTHING_INITIAL_WINDOW
        : result.value;
      control.input.value = value;
      next[control.valueKey] = kind === 'lowPass' ? value * 1e3 : value;
    }
    regenerateWithFilters(next);
  });
  control.input.addEventListener('change', () => {
    const result = validFilterValue(kind, control.input.value);
    if (result.error) {
      control.input.setCustomValidity(result.error);
      control.input.setAttribute('aria-invalid', 'true');
      control.input.reportValidity();
      return;
    }
    control.input.setCustomValidity('');
    control.input.removeAttribute('aria-invalid');
    const next = nextFilterSettings();
    const value = kind === 'lowPass' ? result.value * 1e3 : result.value;
    if (next[control.valueKey] === value) return;
    next[control.valueKey] = value;
    regenerateWithFilters(next);
  });
  control.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') control.input.blur();
    if (event.key === 'Escape') {
      event.preventDefault();
      renderFilterControls();
      control.input.blur();
    }
  });
  control.input.addEventListener('input', () => {
    control.input.setCustomValidity('');
    control.input.removeAttribute('aria-invalid');
  });
}

renderFilterControls();
