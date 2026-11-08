// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Sampled I2C bus-level packets (UM10204, Standard/Fast/Fast-mode Plus).
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ARBDRAW_I2C = api;
})(globalThis, function() {
  const defaults = Object.freeze({ busHz: 100000, addressBits: 7, address: 0x50,
    operation: 'write', payload: '00 A5', readPayload: '5A', addressAck: true,
    dataAck: true, finalReadNack: true, stop: true, preIdle: 1, postIdle: 1,
    high: 3.3, low: 0, samplesPerBit: 20, sdaSignalId: '', sclSignalId: '', role: 'sda' });
  function bytes(text) {
    if (typeof text !== 'string' || text.length > 3072) throw new Error('Use at most 256 hexadecimal payload bytes.');
    const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
    if (tokens.length > 256 || tokens.some(token => !/^(?:0x)?[0-9a-f]{1,2}$/i.test(token)))
      throw new Error('Enter hexadecimal bytes separated by spaces or commas, such as 00 A5 FF.');
    return tokens.map(token => parseInt(token.replace(/^0x/i, ''), 16));
  }
  function address(value, bits) {
    if (typeof value === 'string') {
      if (!/^(?:0x[0-9a-f]+|\d+)$/i.test(value.trim())) throw new Error('Use a decimal address or a 0x-prefixed hexadecimal address.');
      value = Number(value.trim());
    }
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** bits)
      throw new Error(`Address must be 0–${2 ** bits - 1} for ${bits}-bit addressing (without the R/W bit).`);
    return value;
  }
  function normalize(source = {}) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Invalid I2C packet settings.');
    const settings = { ...defaults, ...source };
    if (![100000, 400000, 1000000].includes(settings.busHz)) throw new Error('Choose 100 kbit/s, 400 kbit/s, or 1 Mbit/s.');
    if (![7, 10].includes(settings.addressBits)) throw new Error('Choose 7-bit or 10-bit addressing.');
    settings.address = address(settings.address, settings.addressBits);
    if (!['write', 'read', 'writeRead'].includes(settings.operation)) throw new Error('Choose Write, Read, or Write then Read.');
    bytes(settings.payload); bytes(settings.readPayload);
    if (settings.operation !== 'write' && !bytes(settings.readPayload).length)
      throw new Error('Enter at least one read-response byte.');
    for (const key of ['addressAck', 'dataAck', 'finalReadNack', 'stop'])
      if (typeof settings[key] !== 'boolean') throw new Error(`Invalid I2C ${key} setting.`);
    for (const key of ['preIdle', 'postIdle'])
      if (!Number.isInteger(settings[key]) || settings[key] < 1 || settings[key] > 1000)
        throw new Error('Idle time must be 1–1000 whole bit periods.');
    if (![20, 40, 80].includes(settings.samplesPerBit)) throw new Error('Choose 20, 40, or 80 samples per bit.');
    if (!Number.isFinite(settings.high) || !Number.isFinite(settings.low) || settings.high <= settings.low)
      throw new Error('Logic high must be greater than logic low, with both in volts.');
    if (!['sda', 'scl'].includes(settings.role)) throw new Error('Invalid I2C output role.');
    for (const key of ['sdaSignalId', 'sclSignalId'])
      if (typeof settings[key] !== 'string') throw new Error('Invalid I2C signal assignment.');
    if (settings.sdaSignalId && settings.sdaSignalId === settings.sclSignalId)
      throw new Error('SDA and SCL must use different signals.');
    // Only known scalar settings are persisted; payloads stay as user-entered hex.
    return Object.fromEntries(Object.keys(defaults).map(key => [key, settings[key]]));
  }
  function generate(source, maxSamples = 1000000) {
    const settings = normalize(source), sda = [], scl = [], events = [], transfers = [];
    const samplesPerBit = settings.samplesPerBit, unit = samplesPerBit / 20;
    // 55% low / 45% high meets tLOW at 400 kbit/s (>= 1.3 us).
    const lowTicks = 11 * unit, highTicks = 9 * unit;
    function hold(data, clock, ticks) {
      if (sda.length + ticks > maxSamples) throw new Error(`I2C packet exceeds the ${maxSamples.toLocaleString()}-point output limit. Reduce payload, idle time, or samples per bit.`);
      for (let i = 0; i < ticks; i++) { sda.push(data ? settings.high : settings.low); scl.push(clock ? settings.high : settings.low); }
    }
    function mark(kind) { events.push({ kind, index: sda.length }); }
    function start(repeated = false) {
      if (repeated) { hold(1, 0, lowTicks); hold(1, 1, samplesPerBit); }
      mark(repeated ? 'restart' : 'start'); hold(0, 1, samplesPerBit);
      hold(0, 0, unit);
    }
    function bit(value) {
      // Change SDA after the falling edge; hold through the entire high phase.
      hold(value, 0, lowTicks - unit);
      hold(value, 1, highTicks);
      hold(value, 0, unit);
    }
    function byte(value, ack, kind) {
      const index = sda.length;
      for (let bitIndex = 7; bitIndex >= 0; bitIndex--) bit((value >> bitIndex) & 1);
      bit(ack ? 0 : 1);
      transfers.push({ value, ack, kind, index });
      return ack;
    }
    function writeAddress() {
      if (!byte(settings.addressBits === 7 ? settings.address << 1 : 0xf0 | ((settings.address >> 7) & 6), settings.addressAck, 'address')) return false;
      return settings.addressBits === 10 ? byte(settings.address & 255, settings.addressAck, 'address') : true;
    }
    function readAddress() {
      return byte(settings.addressBits === 7 ? (settings.address << 1) | 1 : 0xf1 | ((settings.address >> 7) & 6), settings.addressAck, 'address');
    }
    hold(1, 1, settings.preIdle * samplesPerBit);
    start();
    let acknowledged = true, readPhase = false;
    if (settings.operation === 'read') {
      if (settings.addressBits === 10) { acknowledged = writeAddress(); if (acknowledged) start(true); }
      if (acknowledged) { acknowledged = readAddress(); readPhase = true; }
    } else {
      acknowledged = writeAddress();
      if (acknowledged) for (const value of bytes(settings.payload)) {
        acknowledged = byte(value, settings.dataAck, 'write');
        if (!acknowledged) break;
      }
      if (acknowledged && settings.operation === 'writeRead') {
        start(true); acknowledged = readAddress(); readPhase = true;
      }
    }
    if (acknowledged && readPhase) {
      const response = bytes(settings.readPayload);
      response.forEach((value, index) => byte(value,
        !(settings.finalReadNack && index === response.length - 1), 'read'));
    }
    if (settings.stop) {
      hold(0, 0, lowTicks); hold(0, 1, samplesPerBit);
      mark('stop'); hold(1, 1, settings.postIdle * samplesPerBit);
    } else {
      // End with SCL low: no accidental STOP, and a deliberate incomplete frame.
      hold(1, 0, settings.postIdle * samplesPerBit);
    }
    const sampleRateHz = settings.busHz * samplesPerBit;
    return { settings, sda, scl, events, transfers, sampleRateHz,
      durationSeconds: sda.length / sampleRateHz, frequencyHz: sampleRateHz / sda.length };
  }
  return { defaults, normalize, bytes, generate };
});
