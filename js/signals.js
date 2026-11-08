// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Independent signal records; editor history and navigation stay local to each.
let signalSessions = new WeakMap();
let signalOptions = new Map();

function activeSignal() {
  return projectDocument.signals.find(signal => signal.id === projectDocument.activeSignalId);
}

function resetSignals() {
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  if (!projectDocument.signals) projectDocument = createSignalDocument([
    { id: 'signal-1', name: 'Signal 1', AWG: projectDocument.AWG, waveform: projectDocument.waveform },
  ], projectDocument.name);
  signalSessions = new WeakMap();
  signalOptions = new Map();
  $('signalSelect').replaceChildren();
}

function finishSignalEdit() {
  document.activeElement?.blur();
  finishWaveformPreview();
  globalThis.ARBDRAW_SEQUENCE?.sync();
  renderAwgTiming();
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
}

function rememberSignalSession() {
  signalSessions.set(activeSignal(), { history: state.history, redo: state.redo,
    activeSegment: state.activeSegment, mode: editorMode, viewport: { ...editorViewport } });
}

function activateSignal(id) {
  if (!projectDocument.signals.some(signal => signal.id === id)) return false;
  if (id === projectDocument.activeSignalId) return true;
  $('signalActions').open = false;
  finishSignalEdit();
  rememberSignalSession();
  const gridView = globalThis.ARBDRAW_SIGNAL_GRID?.captureView();
  projectDocument.activeSignalId = id;
  restoreSignalSession(gridView);
  return true;
}

function restoreSignalSession(gridView) {
  const session = signalSessions.get(activeSignal());
  // Restore AWG counts against the full record before selecting a segment.
  state.activeSegment = null;
  clearEditorSelection(false);
  restoreAwgSettingsFromDocument(projectDocument.AWG, { preserveWaveform: true });
  state.activeSegment = session?.activeSegment ?? null;
  state.history = session?.history || [];
  state.redo = session?.redo || [];
  Object.assign(editorViewport, session?.viewport || { start: 0, pointsPerScreen: null, total: null });
  if (gridView) globalThis.ARBDRAW_SIGNAL_GRID.restoreView(gridView);
  setEditorMode(session?.mode || (hasArbitraryEdits() ? 'advanced' : 'basic'), { render: false });
  if (!state.data.length) generate();
  else if (!state.history.length) pushHistory();
  renderDocument();
  globalThis.ARBDRAW_SIGNAL_GRID?.revealActive();
  refreshScope();
  refreshSignalJson();
}

function addSignal(duplicate = false) {
  finishSignalEdit();
  rememberSignalSession();
  let number = 1;
  while (projectDocument.signals.some(signal => signal.id === `signal-${number}`)) number++;
  const source = duplicate ? activeSignal() : createDefaultDocument();
  const signal = { id: `signal-${number}`,
    name: duplicate ? `${source.name} copy`.slice(0, 120) : `Signal ${number}`,
    AWG: { ...source.AWG }, waveform: cloneWaveform(source.waveform) };
  projectDocument.signals.push(signal);
  projectDocument.activeSignalId = signal.id;
  restoreSignalSession();
  $('signalSelect').focus();
}

function removeSignal() {
  if (projectDocument.signals.length === 1) return false;
  const signal = activeSignal();
  if (!window.confirm(`Remove “${signal.name}” and its samples? This cannot be undone.`)) return false;
  finishSignalEdit();
  const index = projectDocument.signals.indexOf(signal);
  projectDocument.signals.splice(index, 1);
  signalSessions.delete(signal);
  projectDocument.activeSignalId = projectDocument.signals[Math.min(index, projectDocument.signals.length - 1)].id;
  restoreSignalSession();
  $('signalSelect').focus();
  return true;
}

function refreshSignalJson() {
  if (!$('jsonView').classList.contains('hidden')) renderJson();
}

function renameSignal(name) {
  const value = String(name).trim().slice(0, 120);
  if (value) activeSignal().name = value;
  $('signalNameInput').value = activeSignal().name;
  draw();
  refreshSignalJson();
}

function refreshSignals() {
  const select = $('signalSelect'), signals = projectDocument.signals;
  for (const [id, option] of signalOptions) {
    if (!signals.some(signal => signal.id === id)) { option.remove(); signalOptions.delete(id); }
  }
  for (const signal of signals) {
    let option = signalOptions.get(signal.id);
    if (!option) {
      option = document.createElement('option');
      option.value = signal.id;
      select.append(option);
      signalOptions.set(signal.id, option);
    }
    option.textContent = signal.name;
  }
  select.value = projectDocument.activeSignalId;
  if (document.activeElement !== $('signalNameInput')) $('signalNameInput').value = activeSignal().name;
  $('removeSignalBtn').disabled = signals.length === 1;
  globalThis.ARBDRAW_SIGNAL_GRID?.refreshLayout();
}

globalThis.ARBDRAW_SIGNALS = { active: activeSignal, reset: resetSignals, refresh: refreshSignals };
$('signalSelect').onchange = event => activateSignal(event.target.value);
$('addSignalBtn').onclick = () => addSignal();
$('duplicateSignalBtn').onclick = () => { $('signalActions').open = false; addSignal(true); };
$('removeSignalBtn').onclick = () => { $('signalActions').open = false; removeSignal(); };
$('signalNameInput').onchange = event => renameSignal(event.target.value);
$('signalNameInput').onkeydown = event => {
  if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); }
  if (event.key === 'Escape') { event.target.value = activeSignal().name; event.target.blur(); }
};
resetSignals();
