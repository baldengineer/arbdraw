// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Serial waveform metadata controls.
function serialSettings() {
  if (!projectDocument.waveform.serial) {
    projectDocument.waveform.serial = normalizeSerialSettings();
  }
  return projectDocument.waveform.serial;
}

function serialPayloadValues(payload) {
  const value = String(payload);
  const trimmedValue = value.trim();

  if (!/^0x/i.test(trimmedValue)) {
    return [...new TextEncoder().encode(value)];
  }

  const tokens = trimmedValue.split(/[\s,]+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => /^0x[\da-f]+$/i.test(token))) {
    return tokens.map((token) => Number.parseInt(token.slice(2), 16));
  }

  if (/^0x[\da-f]+$/i.test(trimmedValue)) {
    let hex = trimmedValue.slice(2);
    if (hex.length % 2) hex = `0${hex}`;
    return hex.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16));
  }

  return [...new TextEncoder().encode(value)];
}

function serialParityBit(bits, parity) {
  const oddOnes = bits.reduce((sum, bit) => sum + bit, 0) % 2;
  return parity === 'even' ? oddOnes : oddOnes ? 0 : 1;
}

function serialBitPattern() {
  const serial = serialSettings();
  if (/^[01]+$/.test(serial.binaryPattern)) {
    return [...serial.binaryPattern].map(Number);
  }
  const mask = 2 ** serial.wordSize - 1;
  const words = serialPayloadValues(serial.payload).map((value) => value & mask);
  const pattern = Array(serial.preIdleBits).fill(1);
  const startBits = serial.startBit ? [0] : [];

  if (serial.protocol === 'I2C') {
    pattern.push(...startBits);
    for (const word of words) {
      const dataBits = Array.from({ length: serial.wordSize }, (_, index) =>
        serial.bitOrder === 'LSB'
          ? (word >> index) & 1
          : (word >> (serial.wordSize - index - 1)) & 1,
      );
      pattern.push(...dataBits.map((bit) => serial.invertData ? 1 - bit : bit));
      pattern.push(0);
    }
    pattern.push(...Array(serial.stopBits).fill(1));
    pattern.push(...Array(serial.postIdleBits).fill(1));
    return pattern.length ? pattern : [0];
  }

  for (const word of words) {
    pattern.push(...startBits);
    const logicalDataBits = Array.from(
      { length: serial.wordSize },
      (_, index) =>
        serial.bitOrder === 'LSB'
          ? (word >> index) & 1
          : (word >> (serial.wordSize - index - 1)) & 1,
    );
    const dataBits = logicalDataBits.map((bit) => serial.invertData ? 1 - bit : bit);
    pattern.push(...dataBits);
    if (serial.parity !== 'none') {
      pattern.push(serialParityBit(logicalDataBits, serial.parity));
    }
    pattern.push(...Array(serial.stopBits).fill(1));
  }

  pattern.push(...Array(serial.postIdleBits).fill(1));

  return pattern.length ? pattern : [0];
}

function updateSerialPropertiesVisibility(type = state.type) {
  $('serialProperties').hidden = type !== 'serial';
}

function ensureSerialPeriodCoversPayload() {
  const bits = serialBitPattern(),
    baud = serialSettings().baud,
    requiredPeriodSeconds = Math.max(1, bits.length) / baud,
    roundedPeriodSeconds = Math.ceil(requiredPeriodSeconds * 1e6) / 1e6,
    requiredFrequency = 1 / roundedPeriodSeconds;
  if (state.frequency > requiredFrequency) {
    state.frequency = requiredFrequency;
    renderFrequency();
  }
}

function renderSerialProperties() {
  const serial = serialSettings();
  $('serialProtocol').value = serial.protocol;
  $('serialBaud').value = serial.baud;
  $('serialWordSize').value = String(serial.wordSize);
  $('serialBitOrder').value = serial.bitOrder;
  $('serialInvertData').checked = serial.invertData;
  $('serialParity').value = serial.parity;
  $('serialStartBit').checked = serial.startBit;
  $('serialPreIdle').value = serial.preIdleBits;
  $('serialPostIdle').value = serial.postIdleBits;
  $('serialStopBits').value = String(serial.stopBits);
  $('serialPayload').value = serial.payload;
  $('serialBinaryPattern').value = serialBitPattern().join('');
  $('serialBinaryControl').hidden = globalThis.ARBDRAW_DEFAULTS?.serial_debug !== true;
  updateSerialPropertiesVisibility();
}

function commitSerialProperties(event) {
  const editingBinary = event?.target?.id === 'serialBinaryPattern';
  const binaryPattern = editingBinary
    ? $('serialBinaryPattern').value.replace(/[^01]/g, '')
    : '';
  projectDocument.waveform.serial = normalizeSerialSettings({
    protocol: $('serialProtocol').value,
    baud: Number($('serialBaud').value),
    wordSize: Number($('serialWordSize').value),
    bitOrder: $('serialBitOrder').value,
    invertData: $('serialInvertData').checked,
    parity: $('serialParity').value,
    startBit: $('serialStartBit').checked,
    preIdleBits: Number($('serialPreIdle').value),
    postIdleBits: Number($('serialPostIdle').value),
    stopBits: Number($('serialStopBits').value),
    payload: $('serialPayload').value,
    binaryPattern,
  });
  if (event?.target?.id === 'serialPayload') ensureSerialPeriodCoversPayload();
  renderSerialProperties();
  if (state.type === 'serial') generate('serial');
  else pushHistory();
}

for (const id of [
  'serialProtocol',
  'serialBaud',
  'serialWordSize',
  'serialBitOrder',
  'serialInvertData',
  'serialParity',
  'serialStartBit',
  'serialPreIdle',
  'serialPostIdle',
  'serialStopBits',
  'serialPayload',
  'serialBinaryPattern',
]) {
  $(id).addEventListener(id === 'serialPayload' ? 'input' : 'change', commitSerialProperties);
}
