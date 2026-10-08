// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Basic uses a generated waveform; Advanced can also contain point edits and filters.
let editorMode = null;
let lastAdvancedTool = state.tool === 'pointer' ? 'pencil' : state.tool;

function hasActiveFilters() {
  const filters = state.filters || {};
  return filters.enabled !== false && (
    filters.noiseEnabled === true ||
    filters.smoothingEnabled === true
  );
}

function hasAdvancedContent() {
  return state.samplesEdited === true || hasActiveFilters();
}

function refreshEditorModeHints() {
  $('sampleEditHint').hidden = editorMode !== 'basic';
}

function setEditorMode(requestedMode) {
  const nextMode = requestedMode === 'advanced' ? 'advanced' : 'basic';
  if (editorMode === 'advanced' && nextMode === 'basic' && state.tool !== 'pointer')
    lastAdvancedTool = state.tool;
  editorMode = nextMode;
  document.documentElement.dataset.editorMode = nextMode;
  $('basicModeBtn').setAttribute('aria-pressed', String(nextMode === 'basic'));
  $('advancedModeBtn').setAttribute('aria-pressed', String(nextMode === 'advanced'));
  $('editorModeDescription').textContent = nextMode === 'basic'
    ? 'Choose a waveshape and adjust its properties.'
    : 'Select points, draw edits, and apply filters.';
  $('functionSectionTitle').textContent = nextMode === 'basic' ? 'Function' : 'Waveform source';
  if (nextMode === 'basic') {
    clearEditorSelection(false);
    setEditorTool('pointer', false);
  } else {
    setEditorTool(lastAdvancedTool, false);
  }
  refreshEditorModeHints();
  if (!$('samplesView').classList.contains('hidden')) renderSamples();
  draw();
}

function requestBasicMode() {
  if (editorMode !== 'advanced' || !hasAdvancedContent()) {
    setEditorMode('basic');
    return;
  }
  $('basicModeConfirmDialog').showModal();
}

function convertToBasic() {
  $('basicModeConfirmDialog').close();
  clearEditorSelection(false);
  state.filters = normalizeFilterSettings();
  generate(state.type, false, false, false, false);
  state.history = [];
  state.redo = [];
  pushHistory();
  renderFilterControls();
  refreshScopeVertical();
  persistCurrentSettings();
  setEditorMode('basic');
}

globalThis.ARBDRAW_EDITOR_MODES = {
  isAdvanced: () => editorMode === 'advanced',
  refresh: refreshEditorModeHints,
  forOpenedProject: () => setEditorMode(hasAdvancedContent() ? 'advanced' : 'basic'),
  forNewProject: () => setEditorMode('basic'),
};

$('basicModeBtn').onclick = requestBasicMode;
$('advancedModeBtn').onclick = () => setEditorMode('advanced');
$('confirmBasicModeBtn').onclick = convertToBasic;
$('advancedSamplesBtn').onclick = () => setEditorMode('advanced');
setEditorMode('basic');
