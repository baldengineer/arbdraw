// Serial waveform metadata controls.
function serialSettings() {
  if (!projectDocument.waveform.serial) {
    projectDocument.waveform.serial = normalizeSerialSettings();
  }
  return projectDocument.waveform.serial;
}

function updateSerialPropertiesVisibility(type = state.type) {
  $('serialProperties').hidden = type !== 'serial';
}

function renderSerialProperties() {
  const serial = serialSettings();
  $('serialProtocol').value = serial.protocol;
  $('serialWordSize').value = String(serial.wordSize);
  $('serialParity').value = serial.parity;
  $('serialStartBit').checked = serial.startBit;
  $('serialStopBit').checked = serial.stopBit;
  $('serialPayload').value = serial.payload;
  updateSerialPropertiesVisibility();
}

function commitSerialProperties() {
  projectDocument.waveform.serial = normalizeSerialSettings({
    protocol: $('serialProtocol').value,
    wordSize: Number($('serialWordSize').value),
    parity: $('serialParity').value,
    startBit: $('serialStartBit').checked,
    stopBit: $('serialStopBit').checked,
    payload: $('serialPayload').value,
  });
  pushHistory();
}

for (const id of [
  'serialProtocol',
  'serialWordSize',
  'serialParity',
  'serialStartBit',
  'serialStopBit',
  'serialPayload',
]) {
  $(id).addEventListener('change', commitSerialProperties);
}
