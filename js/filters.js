// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Waveform filter settings, menu controls, and post-processing.
const LOW_PASS_INITIAL_HZ = 1_000;
const FILTER_MENU_ENABLED = new URLSearchParams(window.location.search).get('lpf') === '1';

const lowPassFilterButton = $('lowPassFilterBtn');
lowPassFilterButton.hidden = !FILTER_MENU_ENABLED;
lowPassFilterButton.style.display = FILTER_MENU_ENABLED ? '' : 'none';

const filtersMenuAnchor = document.createElement('span');
filtersMenuAnchor.className = 'filters-menu-anchor';
$('filtersBtn').before(filtersMenuAnchor);
filtersMenuAnchor.append($('filtersBtn'), $('filtersMenu'));

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

function applyFilters(values) {
  if (!state.filters?.enabled) return values;
  let filtered = values;
  if (state.filters.noiseEnabled && state.filters.noisePercent > 0)
    filtered = applyNoiseFilter(filtered, state.filters.noisePercent);
  if (state.filters.lowPassEnabled && state.filters.lowPassCutoffHz)
    filtered = applyLowPassFilter(filtered, state.filters.lowPassCutoffHz);
  return filtered;
}

function closeFiltersMenu() {
  $('filtersMenu').classList.remove('open');
  $('filtersBtn').setAttribute('aria-expanded', 'false');
}

function renderFilterMenu() {
  const noisePercent = Number.isFinite(state.filters?.noisePercent)
    ? state.filters.noisePercent
    : DEFAULT_VALUES.noisePercent;
  $('noiseFilterBtn').setAttribute('aria-checked', String(state.filters?.noiseEnabled === true));
  $('lowPassFilterBtn').setAttribute(
    'aria-checked',
    String(state.filters?.lowPassEnabled === true),
  );
  $('noiseFilterValue').textContent = `${Number(noisePercent.toPrecision(6))}%`;
  $('noiseFilterDefaultValue').textContent = `${Number(DEFAULT_VALUES.noisePercent.toPrecision(6))}%`;
}

function regenerateWithFilters() {
  if (state.type === 'custom') {
    state.data = applyFilters([...state.data]);
    pushHistory();
    draw();
    if (!$('samplesView').classList.contains('hidden')) renderSamples();
  } else generate(state.type);
  refreshScopeVertical();
  persistCurrentSettings();
}

function openFilterDialog(kind) {
  closeFiltersMenu();
  const dialog = $('filterDialog'),
    title = $('filterDialogTitle'),
    description = $('filterDialogDescription'),
    input = $('filterDialogInput'),
    unit = $('filterDialogUnit');
  if (kind === 'noise') {
    title.textContent = 'Add Noise';
    description.textContent = 'Set the amount of random vertical noise to add.';
    input.value = Number.isFinite(state.filters.noisePercent)
      ? state.filters.noisePercent
      : DEFAULT_VALUES.noisePercent;
    input.min = 0;
    input.max = DEFAULT_VALUES.noisePercentMax;
    input.step = 'any';
    input.setAttribute('aria-label', 'Noise percentage');
    unit.textContent = '%';
  } else {
    title.textContent = 'Low-Pass Filter';
    description.textContent = 'Set the low-pass filter cut-off frequency.';
    input.value = state.filters.lowPassCutoffHz
      ? state.filters.lowPassCutoffHz / 1e3
      : LOW_PASS_INITIAL_HZ / 1e3;
    input.min = 0.000001;
    input.removeAttribute('max');
    input.step = 'any';
    input.setAttribute('aria-label', 'Cut-off frequency in kHz');
    unit.textContent = 'kHz';
  }
  dialog.dataset.filter = kind;
  dialog.showModal();
  input.focus();
  input.select();
}

$('filtersBtn').onclick = (event) => {
  event.stopPropagation();
  const menu = $('filtersMenu'),
    isOpen = menu.classList.toggle('open');
  $('filtersBtn').setAttribute('aria-expanded', String(isOpen));
  renderFilterMenu();
};
$('enableFiltersBtn').onclick = () => {
  state.filters.enabled = true;
  state.filters.noiseEnabled = true;
  state.filters.lowPassEnabled = true;
  if (!state.filters.noisePercent) state.filters.noisePercent = DEFAULT_VALUES.noisePercent;
  if (!state.filters.lowPassCutoffHz) state.filters.lowPassCutoffHz = LOW_PASS_INITIAL_HZ;
  renderFilterMenu();
  regenerateWithFilters();
};
$('disableFiltersBtn').onclick = () => {
  state.filters.enabled = false;
  state.filters.noiseEnabled = false;
  state.filters.lowPassEnabled = false;
  renderFilterMenu();
  regenerateWithFilters();
};
$('noiseFilterBtn').onclick = () => {
  if (state.filters.noiseEnabled) {
    state.filters.noiseEnabled = false;
    renderFilterMenu();
    closeFiltersMenu();
    regenerateWithFilters();
  } else openFilterDialog('noise');
};
$('changeNoiseFilterBtn').onclick = () => openFilterDialog('noise');
$('defaultNoiseFilterBtn').onclick = () => {
  state.filters.noisePercent = DEFAULT_VALUES.noisePercent;
  state.filters.noiseEnabled = true;
  renderFilterMenu();
  closeFiltersMenu();
  regenerateWithFilters();
};
$('lowPassFilterBtn').onclick = () => {
  if (state.filters.lowPassEnabled) {
    state.filters.lowPassEnabled = false;
    renderFilterMenu();
    closeFiltersMenu();
    regenerateWithFilters();
  } else openFilterDialog('lowPass');
};
$('applyFilterDialogBtn').onclick = () => {
  const dialog = $('filterDialog'),
    value = Number($('filterDialogInput').value);
  if (!Number.isFinite(value) || value <= 0) return;
  if (dialog.dataset.filter === 'noise') {
    state.filters.noisePercent = Math.min(DEFAULT_VALUES.noisePercentMax, value);
    state.filters.noiseEnabled = true;
  } else {
    state.filters.lowPassCutoffHz = value * 1e3;
    state.filters.lowPassEnabled = true;
  }
  renderFilterMenu();
  dialog.close();
  regenerateWithFilters();
};
$('filterDialogInput').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  $('applyFilterDialogBtn').click();
});

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest?.('#filtersMenu,#filtersBtn')) closeFiltersMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeFiltersMenu();
});
