// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Project rendering, naming, import, export, and document validation.
function renderDocument() {
  document.querySelector('.document-name').value = projectDocument.name;
  document.querySelector('.document-name').readOnly = true;
  document.querySelector('.document-name').classList.remove('editing');
  $('highInput').value = displayVoltage('highInput', state.high);
  $('lowInput').value = displayVoltage('lowInput', state.low);
  $('offsetInput').value = displayVoltage('offsetInput', (state.high + state.low) / 2);
  $('amplitudeInput').value = displayAmplitude(state.high - state.low);
  $('cyclesInput').value = state.cycles;
  renderFrequency();
  $('phaseInput').value = state.phase;
  $('dutyInput').value = state.duty;
  $('dutyValue').textContent = state.duty + '%';
  renderTiming();
  document.querySelector('.preset.active')?.classList.remove('active');
  document.querySelector(`.preset[data-wave="${state.type}"]`)?.classList.add('active');
  updateDutyAvailability(state.type);
  updateCyclesAvailability(state.type);
  updateDcPropertyAvailability(state.type);
  renderSerialProperties();
  renderFilterMenu();
  updateFunctionSelect(state.type);
  draw();
}
function parseProject(raw) {
  if (!raw || raw.schema !== 'arbdraw.waveform' || raw.version !== 1 || !raw.waveform)
    throw new Error('This is not a supported ArbDraw project.');
  const source = raw.waveform,
    number = (key, fallback) =>
      Number.isFinite(Number(source[key])) ? Number(source[key]) : fallback,
    defaultsDocument = createDefaultDocument(),
    defaults = defaultsDocument.waveform,
    sourceAwg = raw.AWG && typeof raw.AWG === 'object' && !Array.isArray(raw.AWG) ? raw.AWG : {},
    awgNumber = (key, fallback) =>
      Number.isFinite(Number(sourceAwg[key])) ? Number(sourceAwg[key]) : fallback;
  const sampleCount = Math.max(
      2,
      Math.round(awgNumber('sampleCount', number('sampleCount', defaults.sampleCount))),
    ),
    sampleRateMSa = Math.max(
      0.000001,
      awgNumber('sampleRateMSa', number('sampleRateMSa', defaults.sampleRateMSa)),
    );
  const values =
    Array.isArray(source.values) &&
    source.values.length === sampleCount &&
    source.values.every(Number.isFinite)
      ? source.values.map(Number)
      : [];
  const importedType = source.type === 'free' ? 'custom' : source.type;
  const durationMs = sampleCount / (sampleRateMSa * 1000),
    cycles = Math.max(1, Math.round(number('cycles', defaults.cycles))),
    frequencyHz = Math.max(0.000001, number('frequencyHz', defaults.frequencyHz));
  return {
    schema: 'arbdraw.waveform',
    version: 1,
    name: String(raw.name || 'Imported waveform').slice(0, 120),
    AWG: {
      profileId:
        typeof sourceAwg.profileId === 'string'
          ? sourceAwg.profileId
          : defaultsDocument.AWG.profileId,
      sampleRateType: sourceAwg.sampleRateType === 'Variable' ? 'Variable' : 'Fixed',
      sampleRateMSa,
      sampleCount,
      tsResolutionSeconds:
        sampleCount > 1 ? durationMs / 1000 / (sampleCount - 1) : null,
      frequencyHz: frequencyHz * cycles,
      periodSeconds: 1 / (frequencyHz * cycles),
    },
    waveform: {
      type: titles[importedType] ? importedType : 'custom',
      highVoltage: number('highVoltage', defaults.highVoltage),
      lowVoltage: number('lowVoltage', defaults.lowVoltage),
      durationMs,
      sampleRateMSa,
      frequencyHz,
      cycles,
      phaseDegrees: number('phaseDegrees', defaults.phaseDegrees),
      dutyCyclePercent: Math.min(
        99,
        Math.max(1, number('dutyCyclePercent', defaults.dutyCyclePercent)),
      ),
      filters: normalizeFilterSettings(source.filters),
      serial: normalizeSerialSettings(source.serial, DEFAULT_VALUES),
      sampleCount,
      values,
    },
  };
}
function loadProject(raw) {
  projectDocument = parseProject(raw);
  restoreAwgSettingsFromDocument(projectDocument.AWG);
  state.history = [];
  state.redo = [];
  renderDocument();
  if (!state.data.length) generate();
  else pushHistory();
  showToast('Project opened');
}

const projectNameInput = document.querySelector('.document-name');
let projectNameBeforeEdit = projectDocument.name;
function beginProjectNameEdit() {
  if (!projectNameInput.readOnly) return;
  projectNameBeforeEdit = projectDocument.name;
  projectNameInput.readOnly = false;
  projectNameInput.classList.add('editing');
  projectNameInput.focus();
  projectNameInput.select();
}
function commitProjectNameEdit(cancel = false) {
  if (projectNameInput.readOnly) return;
  const nextName = cancel ? projectNameBeforeEdit : projectNameInput.value.trim();
  projectDocument.name = nextName || 'Untitled project';
  projectNameInput.value = projectDocument.name;
  projectNameInput.readOnly = true;
  projectNameInput.classList.remove('editing');
}
projectNameInput.addEventListener('click', beginProjectNameEdit);
projectNameInput.addEventListener('blur', () => commitProjectNameEdit());
projectNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    projectNameInput.blur();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    commitProjectNameEdit(true);
    projectNameInput.blur();
  }
});
$('confirmNewBtn').onclick = () => {
  $('newConfirm').hidden = true;
  projectDocument = createDefaultDocument();
  restoreAwgSettingsFromDocument(projectDocument.AWG);
  state.history = [];
  state.redo = [];
  renderDocument();
  generate();
  showToast('New project created');
};
$('newBtn').onclick = () => {
  closeFileMenu();
  $('newConfirm').hidden = false;
};
$('cancelNewBtn').onclick = () => {
  $('newConfirm').hidden = true;
};
const exportButton = document.createElement('button');
$('newBtn').textContent = 'New Project';
$('openBtn').textContent = 'Open JSON Waveform';
$('saveBtn').textContent = 'Save JSON Waveform';
exportButton.id = 'exportBtn';
exportButton.className = 'ghost';
exportButton.type = 'button';
exportButton.setAttribute('aria-haspopup', 'menu');
exportButton.setAttribute('aria-expanded', 'false');
exportButton.title = 'CSV';
exportButton.textContent = 'Export Waveform';
$('saveBtn').after(exportButton);
$('saveBtn').title = 'JSON';
$('openBtn').title = 'JSON';
const exportMenu = document.createElement('div');
exportMenu.id = 'exportMenu';
exportMenu.className = 'context-menu';
exportMenu.setAttribute('role', 'menu');
exportMenu.setAttribute('aria-label', 'Export format');
['CSV', 'CSV with header'].forEach((label) => {
  const option = document.createElement('button');
  option.type = 'button';
  option.setAttribute('role', 'menuitem');
  option.textContent = label;
  option.onclick = () => downloadCsv(label === 'CSV with header');
  exportMenu.append(option);
});
document.body.append(exportMenu);
function projectNameFromFilename(filename) {
  return (
    String(filename)
      .trim()
      .replace(/(?:(?:\.arbdraw\.json)|(?:\.arbdraw)|(?:\.json)|(?:\.csv))+$/i, '')
      .trim() || 'Untitled waveform'
  );
}
$('saveBtn').onclick = () => {
  closeFileMenu();
  const projectName = projectNameFromFilename(document.querySelector('.document-name').value);
  $('saveFilenameInput').value = projectName + '.arbdraw.json';
  $('updateProjectNameOnSave').checked = true;
  $('saveDialog').showModal();
  $('saveFilenameInput').focus();
  $('saveFilenameInput').select();
};
$('confirmSaveBtn').onclick = () => {
  let filename = $('saveFilenameInput').value.trim() || 'Untitled waveform.arbdraw.json';
  if (!/\.arbdraw\.json$/i.test(filename)) filename += '.arbdraw.json';
  const savedName = projectNameFromFilename(filename);
  if ($('updateProjectNameOnSave').checked) {
    projectDocument.name = savedName;
    document.querySelector('.document-name').value = savedName;
  }
  const json = JSON.stringify(projectDocument, null, 2),
    blob = new Blob([json], { type: 'application/json' }),
    a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  $('saveDialog').close();
  showToast('Project JSON downloaded');
};
function downloadCsv(includeHeader, filename) {
  const values = state.data.map((value) => Number(value ?? 0)),
    sampleCount = values.length,
    durationSeconds = state.duration / 1000,
    timeMax = sampleCount > 1 ? durationSeconds : 0,
    voltageMin = sampleCount ? Math.min(...values) : 0,
    voltageMax = sampleCount ? Math.max(...values) : 0,
    csvValue = (value) => {
      const text = String(value ?? '');
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    },
    metadata = [
      ['Waveform name', document.querySelector('.document-name').value.trim() || 'Untitled waveform'],
      ['Generated', new Date().toISOString()],
      ['Waveform type', titles[state.type] || state.type],
      ['High level (V)', state.high],
      ['Low level (V)', state.low],
      ['Amplitude (Vpp)', state.high - state.low],
      ['Offset (V)', (state.high + state.low) / 2],
      ['Frequency (Hz)', state.frequency],
      ['Period (s)', 1 / state.frequency],
      ['Cycles', state.cycles],
      ['Phase (degrees)', state.phase],
      ['Duty cycle (%)', state.duty],
      ['Sample rate (MSa/s)', state.sampleRate],
      ['Sample count', sampleCount],
      ['Time min (s)', 0],
      ['Time max (s)', timeMax],
      ['Voltage min (V)', voltageMin],
      ['Voltage max (V)', voltageMax],
    ],
    rows = includeHeader
      ? [...metadata.map(([key, value]) => `${csvValue(key)},${csvValue(value)}`), '', 'Time (s),Voltage (V)']
      : [];
  for (let index = 0; index < state.data.length; index++) {
    const timeSeconds = (index / Math.max(1, sampleCount - 1)) * durationSeconds;
    rows.push(`${timeSeconds},${values[index]}`);
  }
  const blob = new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  closeExportMenu();
  showToast(`Waveform exported as ${includeHeader ? 'CSV with header' : 'CSV'}`);
}
function closeExportMenu() {
  $('exportMenu').classList.remove('open');
  $('exportBtn').setAttribute('aria-expanded', 'false');
}
$('exportBtn').onclick = (event) => {
  event.stopPropagation();
  closeFileMenu();
  const projectName = projectNameFromFilename(document.querySelector('.document-name').value);
  $('exportFilenameInput').value = projectName + '.csv';
  $('updateProjectNameOnExport').checked = true;
  $('includeCsvHeaders').checked = false;
  $('exportDialog').showModal();
  $('exportFilenameInput').focus();
  $('exportFilenameInput').select();
};
$('confirmExportBtn').onclick = () => {
  let filename = $('exportFilenameInput').value.trim() || 'Untitled waveform.csv';
  if (!/\.csv$/i.test(filename)) filename += '.csv';
  const savedName = projectNameFromFilename(filename);
  if ($('updateProjectNameOnExport').checked) {
    projectDocument.name = savedName;
    document.querySelector('.document-name').value = savedName;
  }
  downloadCsv($('includeCsvHeaders').checked, filename);
  $('exportDialog').close();
};
for (const [inputId, buttonId] of [
  ['saveFilenameInput', 'confirmSaveBtn'],
  ['exportFilenameInput', 'confirmExportBtn'],
]) {
  $(inputId).addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    $(buttonId).click();
  });
}
const fileButton = $('fileBtn');
const fileMenu = $('fileMenu');
function closeFileMenu() {
  fileMenu.classList.remove('open');
  fileButton.setAttribute('aria-expanded', 'false');
}
fileButton.onclick = (event) => {
  event.stopPropagation();
  const isOpen = fileMenu.classList.toggle('open');
  fileButton.setAttribute('aria-expanded', String(isOpen));
};
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest?.('#exportMenu,#exportBtn')) closeExportMenu();
  if (!event.target.closest?.('#fileMenu,#fileBtn')) closeFileMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeExportMenu();
    closeFileMenu();
  }
});
$('openBtn').onclick = () => {
  closeFileMenu();
  $('projectJsonInput').value = '';
  $('openError').textContent = '';
  $('projectFileInput').value = '';
  $('openDialog').showModal();
};
$('chooseProjectBtn').onclick = () => $('projectFileInput').click();
$('projectFileInput').onchange = async (event) => {
  const file = event.target.files[0];
  if (file) {
    $('projectJsonInput').value = await file.text();
    $('openError').textContent = '';
  }
};
$('importProjectBtn').onclick = () => {
  try {
    loadProject(JSON.parse($('projectJsonInput').value));
    $('openDialog').close();
  } catch (error) {
    $('openError').textContent =
      error instanceof SyntaxError ? 'The pasted text is not valid JSON.' : error.message;
  }
};
