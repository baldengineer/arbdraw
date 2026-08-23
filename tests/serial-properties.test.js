const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createSerialHarness() {
  const values = {
    serialProtocol: 'UART',
    serialBaud: '1000',
    serialWordSize: '8',
    serialBitOrder: 'LSB',
    serialParity: 'none',
    serialPreIdle: '1',
    serialPostIdle: '5',
    serialStopBits: '1',
    serialPayload: '0x00',
    serialBinaryPattern: '',
  };
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: values[id] ?? '',
        checked: id === 'serialStartBit',
        hidden: false,
        listeners: {},
        addEventListener(type, handler) {
          this.listeners[type] = handler;
        },
      });
    }
    return elements.get(id);
  };
  const serial = {
    protocol: 'UART',
    baud: 1000,
    wordSize: 8,
    bitOrder: 'LSB',
    invertData: false,
    parity: 'none',
    startBit: true,
    preIdleBits: 1,
    postIdleBits: 1,
    stopBits: 1,
    payload: '0x00',
    binaryPattern: '',
  };
  const calls = { renderFrequency: 0, generate: [] };
  const context = vm.createContext({
    TextEncoder,
    DEFAULT_VALUES: {},
    ARBDRAW_DEFAULTS: {},
    projectDocument: { waveform: { serial } },
    state: { type: 'serial', frequency: 1000 },
    $: element,
    normalizeSerialSettings: (source) => source,
    renderFrequency: () => calls.renderFrequency++,
    generate: (type) => calls.generate.push(type),
    pushHistory() {},
  });
  const source = fs.readFileSync(path.join(__dirname, '../js/serial-properties.js'), 'utf8');
  vm.runInContext(source, context);
  return { calls, context };
}

test('post-idle changes resize and regenerate the serial waveform', () => {
  const { calls, context } = createSerialHarness();

  context.$('serialPostIdle').listeners.input({ target: { id: 'serialPostIdle' } });

  assert.equal(context.projectDocument.waveform.serial.postIdleBits, 5);
  assert.equal(context.state.frequency, 62.5);
  assert.equal(calls.renderFrequency, 1);
  assert.deepEqual(calls.generate, ['serial']);
});
