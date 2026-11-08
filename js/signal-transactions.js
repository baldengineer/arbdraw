// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Multi-output source updates must undo/redo all affected signals together.
(() => {
  let entries = new WeakMap();
  const copySession = session => ({ ...session, history: [...session.history], redo: [...session.redo] });
  function sessionFor(signal) {
    return signalSessions.get(signal) || { history: [cloneWaveform(signal.waveform)], redo: [], activeSegment: null, mode: 'basic' };
  }
  function commit(changes, selectedId) {
    finishSignalEdit();
    rememberSignalSession();
    const owner = activeSignal();
    // Keep an undo anchor even when both destinations are newly created signals.
    if (!changes.some(change => change.signal === owner))
      changes = [...changes, { signal: owner, waveform: owner.waveform, AWG: owner.AWG }];
    const transaction = { project: projectDocument, beforeActive: owner.id, afterActive: selectedId, records: [] };
    for (const change of changes) {
      const { signal, isNew = false } = change;
      const beforeSession = isNew ? null : copySession(sessionFor(signal));
      const entry = cloneWaveform(change.waveform);
      const afterSession = { history: [...(beforeSession?.history || []).slice(-29), entry], redo: [],
        activeSegment: null, mode: 'basic', viewport: { start: 0, pointsPerScreen: null, total: null } };
      transaction.records.push({ signal, isNew, entry, beforeSession, afterSession,
        before: isNew ? null : { waveform: cloneWaveform(signal.waveform), AWG: { ...signal.AWG } },
        after: { waveform: cloneWaveform(change.waveform), AWG: { ...change.AWG } } });
      entries.set(entry, transaction);
    }
    apply(transaction, false);
  }
  function apply(transaction, undo) {
    globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
    // Keep the active aliases valid while newly created outputs are removed.
    if (undo) projectDocument.activeSignalId = transaction.beforeActive;
    for (const record of transaction.records) {
      const { signal } = record;
      if (undo && record.isNew) {
        projectDocument.signals.splice(projectDocument.signals.indexOf(signal), 1);
        signalSessions.delete(signal);
        continue;
      }
      if (!projectDocument.signals.includes(signal)) projectDocument.signals.push(signal);
      const snapshot = undo ? record.before : record.after;
      signal.waveform = cloneWaveform(snapshot.waveform);
      signal.AWG = { ...snapshot.AWG };
      const session = copySession(undo ? record.beforeSession : record.afterSession);
      if (undo) session.redo.push(record.entry);
      signalSessions.set(signal, session);
    }
    projectDocument.activeSignalId = undo ? transaction.beforeActive : transaction.afterActive;
    restoreSignalSession();
  }
  function travel(undo) {
    const entry = (undo ? state.history : state.redo).at(-1), transaction = entries.get(entry);
    if (!transaction || transaction.project !== projectDocument) return false;
    finishSignalEdit(); rememberSignalSession();
    const valid = transaction.records.every(record => {
      const current = projectDocument.signals.find(signal => signal.id === record.signal.id);
      if (!undo && record.isNew) return !current;
      if (current !== record.signal) return false;
      const session = sessionFor(current);
      return (undo ? session.history : session.redo).at(-1) === record.entry
        && JSON.stringify(current.waveform) === JSON.stringify((undo ? record.after : record.before).waveform);
    });
    if (!valid) {
      showToast('This packet changed multiple signals. Undo newer edits on its other signals first; removed or replaced signals prevent restoring the packet.');
      return true;
    }
    apply(transaction, undo);
    return true;
  }
  globalThis.ARBDRAW_SIGNAL_TRANSACTIONS = { commit, undo: () => travel(true), redo: () => travel(false),
    reset: () => { entries = new WeakMap(); } };
})();
