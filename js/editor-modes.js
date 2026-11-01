// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Basic uses a generated waveform with optional filters; Arbitrary allows point edits.
let editorMode = null;
let lastAdvancedTool = state.tool === 'pointer' ? 'pencil' : state.tool;
const EDITOR_MODE_URL_PARAMETER = 'mode';

function editorModeFromUrl() {
  const value = new URLSearchParams(globalThis.location?.search || '')
    .get(EDITOR_MODE_URL_PARAMETER);
  return value === 'arbitrary' ? 'advanced' : 'basic';
}

function syncEditorModeUrl(mode) {
  if (!globalThis.history?.replaceState || !globalThis.location) return;
  const params = new URLSearchParams(globalThis.location.search || ''),
    requestedValue = mode === 'advanced' ? 'arbitrary' : null;
  if (params.get(EDITOR_MODE_URL_PARAMETER) === requestedValue) return;
  if (requestedValue) params.set(EDITOR_MODE_URL_PARAMETER, requestedValue);
  else params.delete(EDITOR_MODE_URL_PARAMETER);
  const search = params.toString(),
    nextUrl = `${globalThis.location.pathname || ''}${search ? `?${search}` : ''}${globalThis.location.hash || ''}`;
  globalThis.history.replaceState(globalThis.history.state, '', nextUrl);
}

function hasArbitraryEdits() {
  return state.samplesEdited === true || Boolean(globalThis.ARBDRAW_SEQUENCE?.hasSegments());
}

function refreshEditorModeHints() {
  $('sampleEditHint').hidden = editorMode !== 'basic';
}

function setEditorMode(requestedMode, { render = true } = {}) {
  const nextMode = requestedMode === 'advanced' ? 'advanced' : 'basic';
  if (editorMode === 'advanced' && nextMode === 'basic' && state.tool !== 'pointer')
    lastAdvancedTool = state.tool;
  editorMode = nextMode;
  document.documentElement.dataset.editorMode = nextMode;
  syncEditorModeUrl(nextMode);
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
  if (render) {
    if (!$('samplesView').classList.contains('hidden')) renderSamples();
    draw();
  }
}

function handleEditorModeShortcut(event) {
  const interactive = event.target?.matches?.(
    'input, textarea, select, button, a, [contenteditable="true"]',
  );
  if (
    event.key !== ' ' ||
    interactive ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.repeat
  )
    return false;
  event.preventDefault();
  setEditorMode('advanced');
  return true;
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
  const hadSequence = globalThis.ARBDRAW_SEQUENCE?.hasSegments();
  globalThis.ARBDRAW_SEQUENCE?.leave();
  if (hadSequence) renderDocument();
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
  isAdvanced: () => editorMode === 'advanced' && !globalThis.ARBDRAW_SEQUENCE?.isOverview(),
  refresh: refreshEditorModeHints,
  forOpenedProject: () => setEditorMode(hasArbitraryEdits() ? 'advanced' : 'basic'),
  forNewProject: () => setEditorMode('basic'),
};

$('basicModeBtn').onclick = requestBasicMode;
$('advancedModeBtn').onclick = () => setEditorMode('advanced');
$('confirmBasicModeBtn').onclick = convertToBasic;
$('advancedSamplesBtn').onclick = () => setEditorMode('advanced');
document.addEventListener('keydown', handleEditorModeShortcut);
setEditorMode(editorModeFromUrl());
