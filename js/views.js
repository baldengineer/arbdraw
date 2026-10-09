// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// View menu, sample table, JSON view, and sample-point editing.
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
        `<tr><td>${formatSampleTime(index)}</td><td><input class="sample-voltage" type="number" step="any" data-index="${index}" value="${Number(state.data[index] ?? 0).toPrecision(10)}" aria-label="Voltage at sample ${index + 1}"${globalThis.ARBDRAW_EDITOR_MODES?.isAdvanced() === false ? ' readonly' : ''}></td></tr>`,
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
const viewTabButtons = Object.fromEntries(
  ['editor', 'waveform', 'samples', 'json'].map((name) => [name, $(name + 'Tab')]),
);
viewPicker.className = 'view-picker';
viewPicker.removeAttribute('role');
viewPicker.removeAttribute('aria-label');
document.querySelector('#fileMenu').after(viewPicker);
const viewPickerButton = document.createElement('button');
viewPickerButton.id = 'viewPickerBtn';
viewPickerButton.className = 'ghost file-button view-picker-button menu-trigger';
viewPickerButton.type = 'button';
viewPickerButton.setAttribute('aria-haspopup', 'menu');
viewPickerButton.setAttribute('aria-expanded', 'false');
const viewPickerChevron = document.createElement('span');
viewPickerChevron.setAttribute('aria-hidden', 'true');
viewPickerChevron.textContent = '▾';
viewPickerButton.append('View ', viewPickerChevron);
const viewPickerMenu = ARBDRAW_MENU.create({ id: 'viewPickerMenu', label: 'View', className: 'file-menu view-picker-menu' });
viewPicker.replaceChildren(viewPickerButton, viewPickerMenu);
const viewSubmenus = new Map();
function closeViewSubmenus() {
  for (const { wrapper, trigger } of viewSubmenus.values()) {
    ARBDRAW_MENU.setOpen(wrapper, trigger, false);
  }
}
function closeViewPicker() {
  closeViewSubmenus();
  ARBDRAW_MENU.setOpen(viewPickerMenu, viewPickerButton, false);
}
viewPickerButton.onclick = (event) => {
  event.stopPropagation();
  closeFileMenu();
  closeEditMenu();
  const isOpen = ARBDRAW_MENU.setOpen(viewPickerMenu, viewPickerButton, !viewPickerMenu.classList.contains('open'));
  if (!isOpen) closeViewSubmenus();
  else renderViewPreferences();
};
function setEditorTab(tab) {
  for (const name of ['editor', 'waveform', 'samples', 'json']) {
    const active = name === tab;
    $(name + 'Tab').classList.toggle('active', active);
    $(name + 'Tab').setAttribute('aria-checked', String(active));
    $(name + 'View').classList.toggle('hidden', !active);
  }
  $('editorControls').classList.toggle('hidden', tab !== 'editor');
  $('viewerControls').classList.toggle('hidden', tab !== 'waveform');
  $('inspectorControls').disabled = tab === 'waveform';
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
  ARBDRAW_MENU.prepareItem(tab, 'menuitemradio');
  tab.removeAttribute('aria-selected');
  tab.setAttribute('aria-checked', String(name === 'editor'));
  viewPickerMenu.append(tab);
  tab.onclick = () => {
    setEditorTab(name);
    closeViewPicker();
  };
}
viewPickerMenu.append(ARBDRAW_MENU.separator());

function openViewSubmenu(name) {
  const item = viewSubmenus.get(name);
  if (!item) return;
  closeViewSubmenus();
  ARBDRAW_MENU.setOpen(item.wrapper, item.trigger, true);
}

function addViewSubmenu(name, label, choices, choose) {
  const wrapper = document.createElement('div');
  wrapper.className = 'view-submenu-item';
  const trigger = ARBDRAW_MENU.item({ id: `${name}ViewMenuBtn`, text: label });
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const submenu = ARBDRAW_MENU.create({ label, className: 'file-menu view-submenu' });
  for (const [value, title] of choices) {
    const option = ARBDRAW_MENU.item({ text: title, role: 'menuitemcheckbox', checked: false });
    option.dataset.viewChoice = name;
    option.dataset.value = value;
    option.onclick = () => {
      choose(value);
      closeViewPicker();
    };
    submenu.append(option);
  }
  wrapper.append(trigger, submenu);
  viewPickerMenu.append(wrapper);
  viewSubmenus.set(name, { wrapper, trigger, submenu });
  trigger.onclick = (event) => {
    event.stopPropagation();
    openViewSubmenu(name);
  };
  trigger.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') openViewSubmenu(name);
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      openViewSubmenu(name);
      submenu.querySelector('button')?.focus();
    }
  });
  submenu.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeViewSubmenus();
      trigger.focus();
    }
  });
}

addViewSubmenu('theme', 'Theme', [['dark', 'Dark'], ['light', 'Light'], ['contrast', 'Contrast']], (value) => setTheme(value));
addViewSubmenu('rendering', 'Rendering', [['vectors', 'Vectors'], ['dots', 'Dots']], (value) => setWaveformRenderMode(value));
function renderViewPreferences() {
  const selected = {
    theme: document.documentElement.dataset.theme || 'dark',
    rendering: state.waveformRenderMode,
  };
  viewPickerMenu.querySelectorAll('[data-view-choice]').forEach((option) => {
    option.setAttribute('aria-checked', String(selected[option.dataset.viewChoice] === option.dataset.value));
  });
}
globalThis.ARBDRAW_VIEW_MENU = { render: renderViewPreferences };
renderViewPreferences();
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
  if (globalThis.ARBDRAW_EDITOR_MODES?.isAdvanced() === false) return;
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
  state.samplesEdited = true;
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
