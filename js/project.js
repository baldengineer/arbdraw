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
  $('symmetryInput').value = state.symmetry;
  $('rcTauInput').value = state.rcTau;
  $('dutyValue').textContent = state.duty + '%';
  $('noiseColorSelect').value = state.noiseColor;
  renderTransitionTimes();
  renderTiming();
  renderWaveformProperties(state.type);
  renderSerialProperties();
  renderFilterControls();
  draw();
  ARBDRAW_FIELDS.formatInputs();
  globalThis.updateAudioPlaybackButton?.();
  globalThis.ARBDRAW_SAMPLES?.refresh();
}
const defaultIncludeCsvTimestamps = globalThis.ARBDRAW_DEFAULTS?.includeCsvTimestamps !== false;
let includeCsvTimestampsPreference = DEFAULT_VALUES.includeCsvTimestamps;
function setIncludeCsvTimestampsPreference(value, save = true) {
  includeCsvTimestampsPreference = value !== false;
  $('includeCsvTimestamps').checked = includeCsvTimestampsPreference;
  if (save) persistSettings({ includeCsvTimestamps: includeCsvTimestampsPreference });
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
      Math.round(awgNumber('sampleCount', defaultsDocument.AWG.sampleCount)),
    ),
    sampleRateMSa = Math.max(
      0.000001,
      awgNumber('sampleRateMSa', defaultsDocument.AWG.sampleRateMSa),
    );
  const values =
    Array.isArray(source.values) &&
    source.values.length === sampleCount &&
    source.values.every(Number.isFinite)
      ? source.values.slice()
      : [];
  const declaredHighVoltage = number('highVoltage', defaults.highVoltage),
    declaredLowVoltage = number('lowVoltage', defaults.lowVoltage),
    sourceHighVoltage = Math.max(
      number('sourceHighVoltage', declaredHighVoltage),
      number('sourceLowVoltage', declaredLowVoltage),
    ),
    sourceLowVoltage = Math.min(
      number('sourceHighVoltage', declaredHighVoltage),
      number('sourceLowVoltage', declaredLowVoltage),
    ),
    durationMs = sampleCount / (sampleRateMSa * 1000),
    cycles = Math.max(1, Math.round(number('cycles', defaults.cycles))),
    frequencyHz = Math.max(0.000001, number('frequencyHz', defaults.frequencyHz)),
    filters = normalizeFilterSettings(source.filters),
    filtersActive = filters.enabled !== false &&
      ((filters.noiseEnabled && filters.noisePercent > 0) || filters.smoothingEnabled);
  let highVoltage = Math.max(declaredHighVoltage, declaredLowVoltage),
    lowVoltage = Math.min(declaredHighVoltage, declaredLowVoltage);
  if (filtersActive && values.length) {
    highVoltage = -Infinity;
    lowVoltage = Infinity;
    for (const value of values) {
      highVoltage = Math.max(highVoltage, value);
      lowVoltage = Math.min(lowVoltage, value);
    }
  }
  const parsed = {
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
      highVoltage,
      lowVoltage,
      frequencyHz: frequencyHz / cycles,
      periodSeconds: cycles / frequencyHz,
    },
    waveform: {
      type: Object.hasOwn(titles, source.type) ? source.type : 'sine',
      highVoltage,
      lowVoltage,
      sourceHighVoltage,
      sourceLowVoltage,
      durationMs,
      sampleRateMSa,
      frequencyHz,
      cycles,
      phaseDegrees: number('phaseDegrees', defaults.phaseDegrees),
      dutyCyclePercent: Math.min(
        99,
        Math.max(1, number('dutyCyclePercent', defaults.dutyCyclePercent)),
      ),
      symmetryPercent: Math.min(100, Math.max(0, number('symmetryPercent', 50))),
      rcTau: Math.max(0.000001, number('rcTau', defaults.rcTau)),
      riseTimeSeconds: Math.max(0, number('riseTimeSeconds', defaults.riseTimeSeconds)),
      fallTimeSeconds: Math.max(0, number('fallTimeSeconds', defaults.fallTimeSeconds)),
      noiseColor: source.noiseColor === 'pink' ? 'pink' : 'white',
      filters,
      serial: normalizeSerialSettings(source.serial, DEFAULT_VALUES),
      samplesEdited: values.length > 0 && source.samplesEdited === true,
      sampleCount,
      values,
    },
  };
  if (source.segments !== undefined) {
    if (!Array.isArray(source.segments) || source.segments.length < 2)
      throw new Error('A sequence must contain at least two segments.');
    const segments = source.segments.map((segment) => {
      if (!segment || segment.segments !== undefined || !Number.isInteger(segment.sampleCount)
        || segment.sampleCount < 2 || !Array.isArray(segment.values)
        || segment.values.length !== segment.sampleCount || !segment.values.every(Number.isFinite))
        throw new Error('Each sequence segment must contain its declared finite voltage samples.');
      const normalized = parseProject({
        schema: raw.schema, version: raw.version,
        AWG: { ...parsed.AWG, sampleCount: segment.sampleCount }, waveform: segment,
      }).waveform;
      normalized.frequencyHz = sampleRateMSa * 1e6 * normalized.cycles / normalized.sampleCount;
      return normalized;
    });
    if (segments.reduce((sum, segment) => sum + segment.sampleCount, 0) !== sampleCount)
      throw new Error('Sequence sample counts must add up to the AWG record length.');
    parsed.waveform.segments = segments;
    Object.assign(parsed.waveform, summarizeSegments(segments, sampleRateMSa));
    parsed.AWG.frequencyHz = parsed.waveform.frequencyHz;
    parsed.AWG.periodSeconds = 1 / parsed.AWG.frequencyHz;
    parsed.AWG.highVoltage = parsed.waveform.highVoltage;
    parsed.AWG.lowVoltage = parsed.waveform.lowVoltage;
    parsed.AWG.tsResolutionSeconds = 1 / (sampleRateMSa * 1e6);
  }
  return parsed;
}
function loadProject(raw) {
  const parsed = parseProject(raw), profile = profileById(parsed.AWG.profileId);
  if (parsed.waveform.segments) {
    if (!profile) throw new Error(`Unknown sequence AWG profile: ${parsed.AWG.profileId}. Choose a supported profile in the source project before importing.`);
    const limit = sampleLimitForProfile(profile);
    if (parsed.waveform.sampleCount > limit)
      throw new Error('This sequence exceeds its AWG profile’s sample limit.');
    parsed.AWG.profileId = profile.id;
  }
  projectDocument = parsed;
  state.activeSegment = null;
  clearEditorSelection(false);
  restoreAwgSettingsFromDocument(projectDocument.AWG);
  state.history = [];
  state.redo = [];
  renderDocument();
  if (!state.data.length) generate();
  else pushHistory();
  globalThis.ARBDRAW_EDITOR_MODES?.forOpenedProject();
  showToast('Project opened');
}

const projectNameInput = document.querySelector('.document-name');
ARBDRAW_FIELDS.applyDefinition(projectNameInput, {
  ...(ARBDRAW_FIELD_DEFINITIONS.project?.projectName || {}),
  id: 'projectName',
});
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
  setIncludeCsvTimestampsPreference(defaultIncludeCsvTimestamps);
  resetPropertyPanels();
  projectDocument = createDefaultDocument();
  state.activeSegment = null;
  clearEditorSelection(false);
  restoreAwgSettingsFromDocument(projectDocument.AWG);
  state.history = [];
  state.redo = [];
  renderDocument();
  generate();
  globalThis.ARBDRAW_EDITOR_MODES?.forNewProject();
  showToast('New project created');
};
$('newBtn').onclick = () => {
  closeFileMenu();
  $('newConfirm').hidden = false;
};
$('cancelNewBtn').onclick = () => {
  $('newConfirm').hidden = true;
};
const exportButton = ARBDRAW_MENU.item({
  id: 'exportBtn',
  className: 'ghost',
  text: 'Export Waveform',
});
$('newBtn').textContent = 'New Project';
$('openBtn').textContent = 'Open JSON Waveform';
$('saveBtn').textContent = 'Save JSON Waveform';
exportButton.title = 'CSV, SVG, or WAV';
exportButton.setAttribute('aria-haspopup', 'menu');
exportButton.setAttribute('aria-expanded', 'false');
const exportMenuAnchor = document.createElement('div');
exportMenuAnchor.className = 'view-submenu-item export-submenu-item';
const exportMenu = ARBDRAW_MENU.create({
  id: 'exportScopeMenu', label: 'Export Waveform', className: 'file-menu view-submenu export-submenu',
});
const exportRecordButton = ARBDRAW_MENU.item({
  id: 'exportFullRecordBtn', text: 'Full Record', onClick: () => openExportDialog(),
});
const exportSegmentButton = ARBDRAW_MENU.item({
  id: 'exportSegmentBtn', text: 'Segment', onClick: () => openExportDialog(state.activeSegment),
});
exportMenu.append(exportRecordButton, exportSegmentButton);
exportMenuAnchor.append(exportButton, exportMenu);
$('saveBtn').after(exportMenuAnchor);
$('saveBtn').title = 'JSON';
$('openBtn').title = 'JSON';
function projectNameFromFilename(filename) {
  return (
    String(filename)
      .trim()
      .replace(/(?:(?:\.arbdraw\.json)|(?:\.arbdraw)|(?:\.json)|(?:\.csv)|(?:\.svg)|(?:\.wav))+$/i, '')
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
  globalThis.ARBDRAW_SEQUENCE?.sync();
  renderAwgTiming();
  const json = JSON.stringify(projectDocument, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), filename);
  $('saveDialog').close();
  showToast('Project JSON downloaded');
};
function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  try {
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
function buildCsvRows({ values, durationSeconds, metadata = [], includeHeader, includeTimestamps }) {
  const sampleCount = values.length,
    csvValue = (value) => {
      const text = String(value ?? '');
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    },
    columnHeader = includeTimestamps ? 'Time (s),Voltage (V)' : 'Voltage (V)',
    rows = includeHeader
      ? [...metadata.map(([key, value]) => `${csvValue(key)},${csvValue(value)}`), '', columnHeader]
      : [];
  for (let index = 0; index < sampleCount; index++) {
    if (includeTimestamps) {
      const timeSeconds = (index / Math.max(1, sampleCount - 1)) * durationSeconds;
      rows.push(`${timeSeconds},${values[index]}`);
    } else rows.push(String(values[index]));
  }
  return rows;
}
function exportWaveformData(segmentIndex = null) {
  if (segmentIndex === null)
    return globalThis.ARBDRAW_SEQUENCE?.hasSegments() ? { ...recordState(), fullSequence: true } : state;
  const segment = projectDocument.waveform.segments?.[segmentIndex];
  if (!Number.isInteger(segmentIndex) || !segment) throw new Error('Select a segment to export.');
  return waveformOutput(segment, projectDocument.waveform.sampleRateMSa);
}
function downloadCsv(includeHeader, filename, includeTimestamps = true, output = exportWaveformData()) {
  const values = output.data.map((value) => Number(value ?? 0));
  // Iterate instead of spreading samples into Math.min/max: large records exceed
  // the browser's function-argument limit.
  let voltageMin = Infinity, voltageMax = -Infinity;
  for (const value of values) {
    voltageMin = Math.min(voltageMin, value);
    voltageMax = Math.max(voltageMax, value);
  }
  if (!values.length) voltageMin = voltageMax = 0;
  const sampleCount = values.length,
    durationSeconds = globalThis.ARBDRAW_SEQUENCE?.hasSegments()
      ? (sampleCount - 1) / (output.sampleRate * 1e6) : output.duration / 1000,
    timeMax = sampleCount > 1 ? durationSeconds : 0,
    metadata = [
      ['Waveform name', document.querySelector('.document-name').value.trim() || 'Untitled waveform'],
      ['Generated', new Date().toISOString()],
      ['Waveform type', output.fullSequence ? 'Sequence' : titles[output.type] || output.type],
      ['High level (V)', output.high],
      ['Low level (V)', output.low],
      ['Amplitude (Vpp)', output.high - output.low],
      ['Offset (V)', (output.high + output.low) / 2],
      ['Frequency (Hz)', output.frequency],
      ['Period (s)', 1 / output.frequency],
      ['Cycles', output.cycles],
      ['Phase (degrees)', output.phase],
      ['Duty cycle (%)', output.duty],
      ['Symmetry (%)', output.symmetry],
      ['Rise time (s)', output.riseTime],
      ['Fall time (s)', output.fallTime],
      ['Noise color', output.noiseColor],
      ['Sample rate (MSa/s)', output.sampleRate],
      ['Sample count', sampleCount],
      ['Time min (s)', 0],
      ['Time max (s)', timeMax],
      ['Voltage min (V)', voltageMin],
      ['Voltage max (V)', voltageMax],
    ],
    rows = buildCsvRows({ values, durationSeconds, metadata, includeHeader, includeTimestamps });
  const blob = new Blob([rows.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, filename);
  showToast(`Waveform exported as ${includeHeader ? 'CSV with header' : 'CSV'}`);
}
function downloadSvg(filename, output = exportWaveformData()) {
  const svg = ARBDRAW_SVG_EXPORT.waveformSvg({
    values: output.data,
    name: projectDocument.name,
    includeAxes: $('includeSvgAxes').checked,
    durationSeconds: globalThis.ARBDRAW_SEQUENCE?.hasSegments()
      ? (output.samples - 1) / (output.sampleRate * 1e6) : output.duration / 1000,
  });
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
  showToast('Waveform exported as SVG');
}
function downloadWav(filename, output = exportWaveformData()) {
  const buffer = ARBDRAW_WAV_EXPORT.waveformWav({
    values: output.data,
    sampleRateHz: output.sampleRate * 1e6,
  });
  downloadBlob(new Blob([buffer], { type: 'audio/wav' }), filename);
  showToast('Waveform exported as WAV');
}
let exportTarget = null;
function updateExportFormat() {
  const format = $('exportFormatSelect').value,
    csv = format === 'csv',
    svg = format === 'svg';
  $('exportFilenameInput').value = $('exportFilenameInput').value.replace(/\.(csv|svg|wav)$/i, `.${format}`);
  $('csvHeadersOption').hidden = !csv;
  $('csvTimestampsOption').hidden = !csv;
  $('svgAxesOption').hidden = !svg;
  $('svgExportDescription').hidden = !svg;
  $('wavExportDescription').hidden = format !== 'wav';
  $('wavExportDescription').textContent =
    `Mono, 16-bit PCM at ${((exportTarget?.output || state).sampleRate * 1e6).toLocaleString()} Hz, normalized to full scale. WAV export supports 8–384 kHz; select the Audio profile for 48 kHz.`;
  $('exportError').textContent = '';
  $('confirmExportBtn').textContent = `Export ${format.toUpperCase()}`;
}
$('exportFormatSelect').addEventListener('change', updateExportFormat);
$('includeCsvTimestamps').addEventListener('change', () => {
  setIncludeCsvTimestampsPreference($('includeCsvTimestamps').checked);
});
function openExportDialog(segmentIndex = null) {
  const output = exportWaveformData(segmentIndex),
    label = segmentIndex === null ? 'Full Record' : `Segment ${segmentIndex + 1}`;
  exportTarget = { output, label };
  closeFileMenu();
  const projectName = projectNameFromFilename(document.querySelector('.document-name').value);
  $('exportScopeTitle').textContent = `Export ${label}`;
  $('exportScopeDescription').textContent = `${label} · ${output.data.length.toLocaleString()} samples. Choose the file format and filename.`;
  $('exportFormatSelect').value = 'csv';
  $('exportFilenameInput').value = projectName + (segmentIndex === null ? '' : `-segment-${segmentIndex + 1}`) + '.csv';
  updateExportFormat();
  $('updateProjectNameOnExport').checked = segmentIndex === null;
  $('includeCsvHeaders').checked = false;
  setIncludeCsvTimestampsPreference(includeCsvTimestampsPreference, false);
  $('exportDialog').showModal();
  $('exportFilenameInput').focus();
  $('exportFilenameInput').select();
}

function refreshExportScopeMenu() {
  const selected = Number.isInteger(state.activeSegment)
    && Boolean(projectDocument.waveform.segments?.[state.activeSegment]);
  exportSegmentButton.hidden = !selected;
  exportSegmentButton.disabled = !selected;
  exportSegmentButton.textContent = selected ? `Segment ${state.activeSegment + 1}` : 'Segment';
}
function setExportScopeMenuOpen(open) {
  refreshExportScopeMenu();
  ARBDRAW_MENU.setOpen(exportMenuAnchor, exportButton, open);
}
$('exportBtn').onclick = (event) => {
  event.stopPropagation();
  setExportScopeMenuOpen(true);
};
exportButton.addEventListener('pointerenter', (event) => {
  if (event.pointerType === 'mouse') setExportScopeMenuOpen(true);
});
exportButton.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    setExportScopeMenuOpen(true);
    exportRecordButton.focus();
  }
});
exportMenu.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    setExportScopeMenuOpen(false);
    exportButton.focus();
  }
});
$('confirmExportBtn').onclick = () => {
  const format = $('exportFormatSelect').value;
  let filename = $('exportFilenameInput').value.trim() || `Untitled waveform.${format}`;
  if (!filename.toLowerCase().endsWith(`.${format}`)) filename += `.${format}`;
  const savedName = projectNameFromFilename(filename);
  try {
    if (format === 'svg') downloadSvg(filename, exportTarget.output);
    else if (format === 'wav') downloadWav(filename, exportTarget.output);
    else
      downloadCsv(
        $('includeCsvHeaders').checked,
        filename,
        $('includeCsvTimestamps').checked,
        exportTarget.output,
      );
  } catch (error) {
    $('exportError').textContent = error.message;
    return;
  }
  if ($('updateProjectNameOnExport').checked) {
    projectDocument.name = savedName;
    document.querySelector('.document-name').value = savedName;
  }
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
const editButton = document.createElement('button');
editButton.id = 'editBtn';
editButton.className = 'ghost file-button menu-trigger';
editButton.type = 'button';
editButton.setAttribute('aria-haspopup', 'menu');
editButton.setAttribute('aria-expanded', 'false');
editButton.textContent = 'Edit';
const editMenu = ARBDRAW_MENU.create({ id: 'editMenu', label: 'Edit', className: 'file-menu edit-menu' });
const editMenuAnchor = document.createElement('span');
editMenuAnchor.className = 'edit-menu-anchor';
editMenuAnchor.append(editButton, editMenu);
fileMenu.after(editMenuAnchor);
editMenu.append($('undoBtn'), $('redoBtn'));
for (const action of [$('undoBtn'), $('redoBtn')]) {
  action.classList.replace('icon-btn', 'ghost');
  ARBDRAW_MENU.prepareItem(action);
}
function closeEditMenu() {
  ARBDRAW_MENU.setOpen(editMenu, editButton, false);
}
function closeFileMenu() {
  setExportScopeMenuOpen(false);
  ARBDRAW_MENU.setOpen(fileMenu, fileButton, false);
}
fileButton.onclick = (event) => {
  event.stopPropagation();
  closeEditMenu();
  closeViewPicker();
  setExportScopeMenuOpen(false);
  ARBDRAW_MENU.setOpen(fileMenu, fileButton, !fileMenu.classList.contains('open'));
};
editButton.onclick = (event) => {
  event.stopPropagation();
  closeFileMenu();
  closeViewPicker();
  ARBDRAW_MENU.setOpen(editMenu, editButton, !editMenu.classList.contains('open'));
};
$('undoBtn').addEventListener('click', closeEditMenu);
$('redoBtn').addEventListener('click', closeEditMenu);
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest?.('#fileMenu,#fileBtn')) closeFileMenu();
  if (!event.target.closest?.('#editMenu,#editBtn')) closeEditMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeFileMenu();
    closeEditMenu();
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
