// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Waveform filter settings, property controls, and post-processing.
const SMOOTHING_INITIAL_WINDOW = 5;
const SMOOTHING_MAX_WINDOW = 101;

function applyNoiseFilter(values, percentage) {
  const span = Math.abs(state.high - state.low) * (percentage / 100);
  return values.map((value) => value + (Math.random() * 2 - 1) * span);
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
  if (state.filters.smoothingEnabled)
    filtered = applySmoothingFilter(filtered, state.filters.smoothingWindowPoints);
  return filtered;
}

const filterControls = {
  noise: { checkbox: $('noiseFilterEnabled'), input: $('noiseFilterInput'), enabledKey: 'noiseEnabled', valueKey: 'noisePercent' },
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
  return { value };
}

for (const [kind, control] of Object.entries(filterControls)) {
  control.checkbox.addEventListener('change', () => {
    const next = nextFilterSettings();
    if (control.checkbox.checked) {
      const result = validFilterValue(kind, control.input.value);
      const value = result.error
        ? kind === 'noise' ? DEFAULT_VALUES.noisePercent : SMOOTHING_INITIAL_WINDOW
        : result.value;
      control.input.value = value;
      next[control.valueKey] = value;
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
    const value = result.value;
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
