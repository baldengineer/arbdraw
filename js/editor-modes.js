// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Basic uses a generated waveform with optional filters; Arbitrary allows point edits.
let editorMode = null;
let lastAdvancedTool = state.tool === 'pointer' ? 'pencil' : state.tool;

function hasArbitraryEdits() {
  return state.samplesEdited === true;
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
  if (editorMode !== 'advanced' || !hasArbitraryEdits()) {
    setEditorMode('basic');
    return;
  }
  $('basicModeConfirmDialog').showModal();
}

function convertToBasic() {
  $('basicModeConfirmDialog').close();
  clearEditorSelection(false);
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
  forOpenedProject: () => setEditorMode(hasArbitraryEdits() ? 'advanced' : 'basic'),
  forNewProject: () => setEditorMode('basic'),
};

$('basicModeBtn').onclick = requestBasicMode;
$('advancedModeBtn').onclick = () => setEditorMode('advanced');
$('confirmBasicModeBtn').onclick = convertToBasic;
$('advancedSamplesBtn').onclick = () => setEditorMode('advanced');
setEditorMode('basic');
