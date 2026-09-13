// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Editor tabs, sample table, JSON view, and sample-point editing.
function formatSampleTime(index) {
  const seconds = ((index / (state.samples - 1)) * waveformDurationMs()) / 1000;
  return seconds === 0 ? '0' : seconds.toExponential(9);
}
let sampleRenderToken = 0;
function renderSamples() {
  const token = ++sampleRenderToken,
    total = state.samples,
    chunkSize = 400,
    body = $('samplesTableBody'),
    loading = $('samplesLoading');
  let index = 0;
  $('tableCount').textContent = total.toLocaleString() + ' points';
  body.innerHTML = '';
  loading.classList.remove('done');
  $('samplesProgress').textContent = '0 of ' + total.toLocaleString();
  function appendChunk() {
    if (token !== sampleRenderToken) return;
    const end = Math.min(index + chunkSize, total),
      rows = [];
    for (; index < end; index++)
      rows.push(
        `<tr><td>${formatSampleTime(index)}</td><td><input class="sample-voltage" type="number" step="any" data-index="${index}" value="${Number(state.data[index] ?? 0).toPrecision(10)}" aria-label="Voltage at sample ${index + 1}"></td></tr>`,
      );
    body.insertAdjacentHTML('beforeend', rows.join(''));
    $('samplesProgress').textContent = index.toLocaleString() + ' of ' + total.toLocaleString();
    if (index < total) requestAnimationFrame(appendChunk);
    else loading.classList.add('done');
  }
  requestAnimationFrame(appendChunk);
}
function renderJson() {
  const text = JSON.stringify(projectDocument, null, 2),
    lines = text.split('\n').length,
    bytes = new TextEncoder().encode(text).byteLength;
  $('jsonOutput').textContent = text;
  $('jsonStats').textContent = `${lines.toLocaleString()} lines · ${bytes.toLocaleString()} bytes`;
}
const viewPicker = document.querySelector('.view-tabs');
const viewLabels = { editor: 'Editor', waveform: 'Viewer', samples: 'Samples', json: 'JSON' };
const viewTabButtons = Object.fromEntries(
  ['editor', 'waveform', 'samples', 'json'].map((name) => [name, $(name + 'Tab')]),
);
viewPicker.className = 'view-picker';
viewPicker.setAttribute('role', 'group');
viewPicker.setAttribute('aria-label', 'Project view');
const viewPickerButton = document.createElement('button');
viewPickerButton.id = 'viewPickerBtn';
viewPickerButton.className = 'view-picker-button';
viewPickerButton.type = 'button';
viewPickerButton.setAttribute('aria-haspopup', 'menu');
viewPickerButton.setAttribute('aria-expanded', 'false');
const viewPickerLabel = document.createElement('span');
viewPickerLabel.className = 'view-picker-label';
const viewPickerChevron = document.createElement('span');
viewPickerChevron.setAttribute('aria-hidden', 'true');
viewPickerChevron.textContent = '▾';
viewPickerButton.append(viewPickerLabel, viewPickerChevron);
const viewPickerMenu = document.createElement('div');
viewPickerMenu.id = 'viewPickerMenu';
viewPickerMenu.className = 'context-menu view-picker-menu';
viewPickerMenu.setAttribute('role', 'menu');
viewPickerMenu.setAttribute('aria-label', 'Project view');
viewPicker.replaceChildren(viewPickerButton, viewPickerMenu);
viewPickerLabel.textContent = 'Editor';
function closeViewPicker() {
  viewPickerMenu.classList.remove('open');
  viewPickerButton.setAttribute('aria-expanded', 'false');
}
viewPickerButton.onclick = (event) => {
  event.stopPropagation();
  const isOpen = viewPickerMenu.classList.toggle('open');
  viewPickerButton.setAttribute('aria-expanded', String(isOpen));
};
function setEditorTab(tab) {
  for (const name of ['editor', 'waveform', 'samples', 'json']) {
    const active = name === tab;
    $(name + 'Tab').classList.toggle('active', active);
    $(name + 'Tab').setAttribute('aria-checked', String(active));
    $(name + 'View').classList.toggle('hidden', !active);
  }
  viewPickerLabel.textContent = viewLabels[tab];
  $('editorControls').classList.toggle('hidden', tab !== 'editor');
  $('viewerControls').classList.toggle('hidden', tab !== 'waveform');
  if (tab === 'samples') requestAnimationFrame(renderSamples);
  else sampleRenderToken++;
  if (tab === 'editor') resize();
  if (tab === 'waveform')
    requestAnimationFrame(() => {
      resizeCanvas(scopeCanvas, drawScope);
      refreshScope();
    });
  if (tab === 'json') renderJson();
}
$('viewerControls').append(document.querySelector('.scope-controls'));
for (const name of ['editor', 'waveform', 'samples', 'json']) {
  const tab = viewTabButtons[name];
  if (!tab) continue;
  tab.setAttribute('role', 'menuitemradio');
  tab.removeAttribute('aria-selected');
  tab.setAttribute('aria-checked', String(name === 'editor'));
  viewPickerMenu.append(tab);
  tab.onclick = () => {
    setEditorTab(name);
    closeViewPicker();
  };
}
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest?.('#viewPickerMenu,#viewPickerBtn')) closeViewPicker();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeViewPicker();
});
$('copyJsonBtn').onclick = async () => {
  const text = JSON.stringify(projectDocument, null, 2);
  try {
    if (navigator.clipboard && isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    showToast('Project JSON copied');
  } catch {
    showToast('Could not access the clipboard');
  }
};
function updateSampleVoltage(input, recordHistory = false) {
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  globalThis.updateAudioPlaybackButton?.();
  const index = +input.dataset.index,
    value = Number(input.value);
  if (!Number.isFinite(value)) return;
  state.data[index] = value;
  state.high = Math.max(state.high, value);
  state.low = Math.min(state.low, value);
  $('highInput').value = displayVoltage('highInput', state.high);
  $('lowInput').value = displayVoltage('lowInput', state.low);
  $('amplitudeInput').value = displayAmplitude(state.high - state.low);
  $('offsetInput').value = displayVoltage('offsetInput', (state.high + state.low) / 2);
  markCustom();
  if (recordHistory) pushHistory();
  draw();
}
$('samplesTableBody').addEventListener('input', (event) => {
  const input = event.target.closest('.sample-voltage');
  if (input) updateSampleVoltage(input);
});
$('samplesTableBody').addEventListener('change', (event) => {
  const input = event.target.closest('.sample-voltage');
  if (input) updateSampleVoltage(input, true);
});
