// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Explicit packet generation routes the two outputs atomically to signal IDs.
(() => {
  const fields = { busHz: 'i2cSpeed', addressBits: 'i2cAddressBits', address: 'i2cAddress',
    operation: 'i2cOperation', payload: 'i2cPayload', readPayload: 'i2cReadPayload',
    addressAck: 'i2cAddressAck', dataAck: 'i2cDataAck', finalReadNack: 'i2cFinalNack',
    stop: 'i2cStop', preIdle: 'i2cPreIdle', postIdle: 'i2cPostIdle', high: 'i2cHigh', low: 'i2cLow',
    samplesPerBit: 'i2cResolution', sdaSignalId: 'i2cSdaSignal', sclSignalId: 'i2cSclSignal' };
  const booleans = new Set(['addressAck', 'dataAck', 'finalReadNack', 'stop']);
  const numbers = new Set(['busHz', 'addressBits', 'preIdle', 'postIdle', 'high', 'low', 'samplesPerBit']);
  let draftOwner = null;
  const lockedControls = new Map();

  function error(message = '') { $('i2cError').textContent = message; }
  function fillSignalSelect(id, value) {
    const select = $(id), options = projectDocument.signals.map(signal => {
      const option = document.createElement('option'); option.value = signal.id; option.textContent = signal.name; return option;
    });
    const create = document.createElement('option'); create.value = ''; create.textContent = 'Create new signal';
    select.replaceChildren(...options, create);
    select.value = projectDocument.signals.some(signal => signal.id === value) ? value : '';
  }
  function updateVisibility() {
    const operation = $('i2cOperation').value;
    $('i2cPayloadField').hidden = operation === 'read';
    $('i2cReadPayloadField').hidden = operation === 'write';
    $('i2cDataAckField').hidden = operation === 'read';
    $('i2cFinalNackField').hidden = operation === 'write';
  }
  function render(type = state.type) {
    $('i2cProperties').hidden = type !== 'i2c';
    draftOwner = type === 'i2c' ? activeSignal().id : null;
    if (type === 'i2c') {
      const settings = { ...ARBDRAW_I2C.defaults,
        ...(state.type === 'i2c' ? projectDocument.waveform.i2c : {}) };
      if (!settings.sdaSignalId && !settings.sclSignalId)
        settings[settings.role === 'scl' ? 'sclSignalId' : 'sdaSignalId'] = activeSignal().id;
      for (const [key, id] of Object.entries(fields)) {
        if (key.endsWith('SignalId')) fillSignalSelect(id, settings[key]);
        else if (booleans.has(key)) $(id).checked = settings[key];
        else $(id).value = key === 'address' ? `0x${settings.address.toString(16).toUpperCase()}` : settings[key];
      }
      $('i2cProperties').open = true;
      $('i2cSummary').textContent = state.type === 'i2c'
        ? `${state.samples.toLocaleString()} samples · ${(state.cycles / state.frequency * 1e6).toPrecision(6)} µs per record · selected output ${settings.role.toUpperCase()}`
        : 'Choose two different outputs, then generate the packet.';
      error(); updateVisibility();
    }
    lockControls();
  }
  function lockControls() {
    const locked = state.type === 'i2c' || draftOwner === projectDocument.activeSignalId;
    if (!locked) {
      for (const [control, disabled] of lockedControls) control.disabled = disabled;
      lockedControls.clear();
      return;
    }
    const controls = [...document.querySelectorAll(
      '[data-property-panel="amplitude"] input, [data-property-panel="amplitude"] button, '
      + '[data-property-panel="timing"] input, [data-property-panel="timing"] button, '
      + '[data-property-panel="filters"] input')];
    for (const id of ['samplesEdit', 'addSegmentsBtn', 'defaultAllBtn']) if ($(id)) controls.push($(id));
    for (const control of controls) {
      if (!lockedControls.has(control)) lockedControls.set(control, control.disabled);
      control.disabled = true;
    }
  }
  function unlockControls() {
    for (const [control, disabled] of lockedControls) control.disabled = disabled;
    lockedControls.clear();
  }
  function open() {
    finishSignalEdit();
    if (sequenceSegments()) { showToast('Select a separate signal for I2C; packet outputs use complete records.'); return; }
    const createPacket = state.type !== 'i2c';
    renderWaveformProperties('i2c');
    // Like the other waveshapes, choosing I2C immediately produces a waveform.
    // Reopening an existing output only shows its settings and preserves edits.
    if (createPacket) {
      const generated = apply();
      if (!generated && !$('i2cError').textContent) renderDocument();
      return generated;
    }
    $('i2cSdaSignal').focus();
    return true;
  }
  function read() {
    const settings = {};
    for (const [key, id] of Object.entries(fields)) settings[key] = booleans.has(key) ? $(id).checked
      : numbers.has(key) ? (String($(id).value).trim() === '' ? NaN : Number($(id).value)) : $(id).value;
    return ARBDRAW_I2C.normalize(settings);
  }
  function outputFor(signal, packet, role) {
    const values = packet[role], waveform = cloneWaveform(signal.waveform);
    delete waveform.segments;
    Object.assign(waveform, { type: 'i2c', i2c: { ...packet.settings, role },
      highVoltage: packet.settings.high, lowVoltage: packet.settings.low,
      sourceHighVoltage: packet.settings.high, sourceLowVoltage: packet.settings.low,
      sampleCount: values.length, values: values.slice(), sampleRateMSa: packet.sampleRateHz / 1e6,
      frequencyHz: packet.frequencyHz, cycles: 1, durationMs: packet.durationSeconds * 1000,
      phaseDegrees: 0, riseTimeSeconds: 0, fallTimeSeconds: 0, samplesEdited: false,
      filters: normalizeFilterSettings({ enabled: false }) });
    return { signal, waveform, AWG: { ...signal.AWG, sampleCount: values.length,
      sampleRateMSa: packet.sampleRateHz / 1e6, frequencyHz: packet.frequencyHz,
      periodSeconds: packet.durationSeconds, tsResolutionSeconds: 1 / packet.sampleRateHz,
      highVoltage: packet.settings.high, lowVoltage: packet.settings.low } };
  }
  function apply() {
    try {
      const settings = read(), reserved = new Set(projectDocument.signals.map(signal => signal.id));
      const destinations = ['sda', 'scl'].map(role => {
        const id = settings[`${role}SignalId`];
        if (id) {
          const signal = projectDocument.signals.find(signal => signal.id === id);
          if (!signal) throw new Error(`Choose an existing ${role.toUpperCase()} signal or create a new one.`);
          return { signal, isNew: false };
        }
        let number = 1; while (reserved.has(`signal-${number}`)) number++;
        const newId = `signal-${number}`; reserved.add(newId);
        settings[`${role}SignalId`] = newId;
        return { signal: { id: newId, name: `I2C ${role.toUpperCase()}`,
          AWG: { ...activeSignal().AWG }, waveform: createDefaultDocument().waveform }, isNew: true };
      });
      if (destinations[0].signal === destinations[1].signal) throw new Error('SDA and SCL must use different signals.');
      const limit = Math.min(...destinations.map(({ signal }) => {
        const profile = profileById(signal.AWG.profileId);
        if (!profile) throw new Error(`Choose a supported profile for ${signal.name}.`);
        return sampleLimitForProfile(profile);
      }));
      const packet = ARBDRAW_I2C.generate(settings, limit);
      const oldSettings = projectDocument.waveform.i2c;
      const overwritten = destinations.filter(({ signal, isNew }) => !isNew &&
        (signal.waveform.samplesEdited || signal.waveform.segments ||
          (signal !== activeSignal() && ![oldSettings?.sdaSignalId, oldSettings?.sclSignalId].includes(signal.id))));
      if (overwritten.length && !window.confirm(`Generate I2C and replace the records in ${overwritten.map(item => item.signal.name).join(', ')}? Undo restores both outputs.`)) return false;
      const changes = destinations.map((destination, index) => ({
        ...outputFor(destination.signal, packet, index === 0 ? 'sda' : 'scl'), isNew: destination.isNew,
        name: /^(Signal \d+|I2C (SDA|SCL))$/.test(destination.signal.name)
          ? `I2C ${index === 0 ? 'SDA' : 'SCL'}` : destination.signal.name }));
      draftOwner = null;
      ARBDRAW_SIGNAL_TRANSACTIONS.commit(changes, settings.sdaSignalId);
      refreshScopeTime();
      render('i2c');
      $('i2cSummary').textContent = `${packet.sda.length.toLocaleString()} samples per signal · `
        + `${(packet.durationSeconds * 1e6).toPrecision(6)} µs · `
        + packet.transfers.slice(0, 16).map(byte => `${byte.value.toString(16).padStart(2, '0').toUpperCase()} ${byte.ack ? 'ACK' : 'NACK'}`).join(' · ')
        + (packet.transfers.length > 16 ? ' …' : '');
      return true;
    } catch (problem) { error(problem.message); return false; }
  }
  function regenerate(recordHistory = true) {
    try {
      if (!projectDocument.waveform.i2c || sequenceSegments()) return false;
      const packet = ARBDRAW_I2C.generate(projectDocument.waveform.i2c, sampleLimitForProfile(selectedAwgProfile));
      const output = outputFor(activeSignal(), packet, projectDocument.waveform.i2c.role);
      projectDocument.waveform = output.waveform; projectDocument.AWG = output.AWG;
      if (recordHistory) pushHistory();
      renderDocument();
      return true;
    } catch (problem) { showToast(problem.message); return false; }
  }
  globalThis.ARBDRAW_I2C_UI = { open, render, lockControls, unlockControls, apply, regenerate,
    reset() { draftOwner = null; for (const [control, disabled] of lockedControls) control.disabled = disabled; lockedControls.clear(); } };
  $('generateI2cBtn').onclick = apply;
  $('cancelI2cBtn').onclick = () => { draftOwner = null; renderDocument(); };
  $('i2cOperation').addEventListener('change', updateVisibility);
})();
