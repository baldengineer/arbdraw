// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Independent signal records; editor history and navigation stay local to each.
let signalSessions = new WeakMap();
let signalCards = new Map();

function activeSignal() {
  return projectDocument.signals.find(signal => signal.id === projectDocument.activeSignalId);
}

function resetSignals() {
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  if (!projectDocument.signals) projectDocument = createSignalDocument([
    { id: 'signal-1', name: 'Signal 1', AWG: projectDocument.AWG, waveform: projectDocument.waveform },
  ], projectDocument.name);
  signalSessions = new WeakMap();
  signalCards = new Map();
  $('signalList').replaceChildren();
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
  finishSignalEdit();
  rememberSignalSession();
  projectDocument.activeSignalId = id;
  restoreSignalSession();
  return true;
}

function restoreSignalSession() {
  const session = signalSessions.get(activeSignal());
  // Restore AWG counts against the full record before selecting a segment.
  state.activeSegment = null;
  clearEditorSelection(false);
  restoreAwgSettingsFromDocument(projectDocument.AWG, { preserveWaveform: true });
  state.activeSegment = session?.activeSegment ?? null;
  state.history = session?.history || [];
  state.redo = session?.redo || [];
  Object.assign(editorViewport, session?.viewport || { start: 0, pointsPerScreen: null, total: null });
  setEditorMode(session?.mode || (hasArbitraryEdits() ? 'advanced' : 'basic'), { render: false });
  if (!state.data.length) generate();
  else if (!state.history.length) pushHistory();
  renderDocument();
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
  signalCards.get(signal.id)?.button.focus();
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
  signalCards.get(projectDocument.activeSignalId)?.button.focus();
  return true;
}

function refreshSignalJson() {
  if (!$('jsonView').classList.contains('hidden')) renderJson();
}

function renameSignal(name) {
  const value = String(name).trim().slice(0, 120);
  if (value) activeSignal().name = value;
  $('signalNameInput').value = activeSignal().name;
  refreshSignals();
  refreshSignalJson();
}

function drawSignalPreview(canvas, waveform) {
  const context = canvas.getContext('2d'), values = waveform.values;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!values.length) return;
  const low = waveform.lowVoltage, span = Math.max(0.000001, waveform.highVoltage - low);
  context.strokeStyle = '#7bffb2';
  context.lineWidth = 1.5;
  context.beginPath();
  for (let x = 0; x < canvas.width; x++) {
    const value = values[Math.round(x / (canvas.width - 1) * (values.length - 1))];
    const y = waveform.highVoltage === low ? canvas.height / 2
      : 3 + (1 - (value - low) / span) * (canvas.height - 6);
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function refreshSignals() {
  const list = $('signalList'), signals = projectDocument.signals;
  for (const [id, card] of signalCards) {
    if (!signals.some(signal => signal.id === id)) { card.button.remove(); signalCards.delete(id); }
  }
  for (const signal of signals) {
    let card = signalCards.get(signal.id);
    if (!card) {
      const button = document.createElement('button'), name = document.createElement('span'),
        preview = document.createElement('canvas'), detail = document.createElement('small');
      button.type = 'button';
      button.className = 'signal-card';
      button.onclick = () => activateSignal(signal.id);
      preview.width = 140;
      preview.height = 32;
      preview.setAttribute('aria-hidden', 'true');
      button.append(name, preview, detail);
      list.append(button);
      card = { button, name, preview, detail };
      signalCards.set(signal.id, card);
    }
    card.button.setAttribute('aria-pressed', String(signal === activeSignal()));
    card.name.textContent = signal.name;
    card.detail.textContent = `${signal.waveform.sampleCount.toLocaleString()} pts · ${signal.waveform.segments ? 'Sequence' : titles[signal.waveform.type]}`;
    drawSignalPreview(card.preview, signal.waveform);
  }
  if (document.activeElement !== $('signalNameInput')) $('signalNameInput').value = activeSignal().name;
  $('removeSignalBtn').disabled = signals.length === 1;
}

globalThis.ARBDRAW_SIGNALS = { active: activeSignal, reset: resetSignals, refresh: refreshSignals };
$('addSignalBtn').onclick = () => addSignal();
$('duplicateSignalBtn').onclick = () => addSignal(true);
$('removeSignalBtn').onclick = removeSignal;
$('signalNameInput').onchange = event => renameSignal(event.target.value);
$('signalNameInput').onkeydown = event => {
  if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); }
  if (event.key === 'Escape') { event.target.value = activeSignal().name; event.target.blur(); }
};
resetSignals();
