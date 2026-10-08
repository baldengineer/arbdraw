// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Basic and Advanced are views of the same waveform document.
let editorMode = null;
let lastAdvancedTool = state.tool === 'pointer' ? 'pencil' : state.tool;

function hasActiveFilters() {
  const filters = state.filters || {};
  return filters.enabled !== false && (
    filters.noiseEnabled === true ||
    filters.lowPassEnabled === true ||
    filters.smoothingEnabled === true
  );
}

function hasAdvancedContent() {
  return state.samplesEdited === true || hasActiveFilters();
}

function refreshEditorModeNotice() {
  const hasPointEdits = state.samplesEdited === true;
  const hasFilters = hasActiveFilters();
  $('advancedContentNotice').hidden = editorMode !== 'basic' || (!hasPointEdits && !hasFilters);
  $('advancedContentText').textContent = hasPointEdits && hasFilters
    ? 'Point edits and filters are active.'
    : hasPointEdits
      ? 'This waveform has point edits.'
      : hasFilters
        ? 'Filters are active.'
        : '';
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
    closeFiltersMenu();
  } else {
    setEditorTool(lastAdvancedTool, false);
  }
  refreshEditorModeNotice();
  if (!$('samplesView').classList.contains('hidden')) renderSamples();
  draw();
}

globalThis.ARBDRAW_EDITOR_MODES = {
  isAdvanced: () => editorMode === 'advanced',
  refresh: refreshEditorModeNotice,
  forOpenedProject: () => setEditorMode(hasAdvancedContent() ? 'advanced' : 'basic'),
  forNewProject: () => setEditorMode('basic'),
};

$('basicModeBtn').onclick = () => setEditorMode('basic');
$('advancedModeBtn').onclick = () => setEditorMode('advanced');
$('editInAdvancedBtn').onclick = () => setEditorMode('advanced');
$('advancedSamplesBtn').onclick = () => setEditorMode('advanced');
setEditorMode('basic');
