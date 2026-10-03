// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Choose which equivalent waveform properties appear in the inspector.
function setPropertyMode(kind, mode) {
  document.querySelectorAll(`[data-${kind}-mode]`).forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset[`${kind}Mode`] === mode));
  });
  document.querySelectorAll(`[data-${kind}-field]`).forEach((field) => {
    field.hidden = field.dataset[`${kind}Field`] !== mode;
  });
  if (kind === 'amplitude') {
    $('highInput').value = displayVoltage('highInput', state.high);
    $('lowInput').value = displayVoltage('lowInput', state.low);
    $('amplitudeInput').value = displayAmplitude(state.high - state.low);
    $('offsetInput').value = displayVoltage('offsetInput', (state.high + state.low) / 2);
  } else {
    renderFrequency();
  }
}
for (const kind of ['amplitude', 'timing']) {
  document.querySelectorAll(`[data-${kind}-mode]`).forEach((button) => {
    button.addEventListener('click', () => setPropertyMode(kind, button.dataset[`${kind}Mode`]));
  });
}
