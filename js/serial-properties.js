// Serial waveform metadata controls.
function serialSettings() {
  if (!projectDocument.waveform.serial) {
    projectDocument.waveform.serial = normalizeSerialSettings();
  }
  return projectDocument.waveform.serial;
}

function serialPayloadValues(payload) {
  const text = String(payload).trim();
  if (!text) return [0];

  const tokens = text.split(/[\s,]+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => /^(?:0x[\da-f]+|0b[01]+|\d+)$/i.test(token))) {
    return tokens.map((token) => {
      if (/^0x/i.test(token)) return Number.parseInt(token.slice(2), 16);
      if (/^0b/i.test(token)) return Number.parseInt(token.slice(2), 2);
      return Number.parseInt(token, 10);
    });
  }

  if (/^0x[\da-f]+$/i.test(text)) {
    let hex = text.slice(2);
    if (hex.length % 2) hex = `0${hex}`;
    return hex.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16));
  }
  if (/^0b[01]+$/i.test(text)) return [Number.parseInt(text.slice(2), 2)];
  if (/^\d+$/.test(text)) return [Number.parseInt(text, 10)];
  return [...new TextEncoder().encode(text)];
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
  $(id).addEventListener('change', commitSerialProperties);
}
