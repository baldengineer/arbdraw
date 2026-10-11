const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('AWG high and low controls mirror the waveform voltage levels', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  for (const id of ['awgHighEdit', 'awgLowEdit'])
    assert.match(html, new RegExp(`id="${id}"[^>]*readonly`));

  const source = fs.readFileSync(path.join(__dirname, '../js/properties.js'), 'utf8');
  const displayHelpers = source.slice(
    source.indexOf('const frequencyDisplayUnits'),
    source.indexOf('function selectTimingUnit'),
  );
  const renderAwgTiming = source.slice(
    source.indexOf('function renderAwgTiming'),
    source.indexOf('function syncInputs'),
  );
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '' });
    return elements.get(id);
  };
  const context = vm.createContext({
    $: element,
    state: {
      high: 0.5,
      low: -0.25,
      frequency: 1000,
      cycles: 2,
      sampleRate: 1,
      samples: 1000,
      duration: 1,
    },
    projectDocument: { AWG: {} },
    selectedAwgProfile: { id: 'test', sampleRateType: 'Fixed' },
    ARBDRAW_FIELDS: { formatInputs() {} },
  });
  vm.runInContext(`${displayHelpers}\n${renderAwgTiming}\nrenderAwgTiming();`, context);

  assert.equal(element('awgHighEdit').value, 500);
  assert.equal(element('awgHighUnit').textContent, 'mV');
  assert.equal(element('awgLowEdit').value, -250);
  assert.equal(element('awgLowUnit').textContent, 'mV');
  assert.equal(context.projectDocument.AWG.highVoltage, 0.5);
  assert.equal(context.projectDocument.AWG.lowVoltage, -0.25);
});
