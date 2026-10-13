const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness({ storage = new Map(), preferredBackend = null } = {}) {
  const elements = new Map();
  const sends = [];
  const $ = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '', checked: false, disabled: false, hidden: false, dataset: {}, options: [], listeners: {},
        classList: { toggle() {}, contains() { return false; } },
        addEventListener(type, listener) { this.listeners[type] = listener; },
        replaceChildren() { this.options = []; },
        add(option) { this.options.push(option); if (!this.value) this.value = option.value; },
        append() {}, focus() {}, showModal() { this.open = true; },
      });
    }
    return elements.get(id);
  };
  $('instrumentChannel').value = '2';
  $('instrumentEnableOutput').checked = true;
  class BridgeClient {
    constructor(baseUrl) { this.baseUrl = baseUrl; }
    async health() { return { api_version: 'v1' }; }
    async listResources() { return ['TCPIP0::scope::INSTR']; }
    async listAdapters() {
      return ['other', 'tekscope-mso2', 'tekscope-mso6'].map((id) => ({ id }));
    }
    async sendWaveform(resource, waveform, options) {
      sends.push({ resource, waveform, ...options });
      return { message: 'sent' };
    }
  }
  const context = vm.createContext({
    $, Option: function(text, value) { this.text = text; this.value = value; },
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { storage.set(key, value); } },
    document: { addEventListener() {}, createElement() { return { classList: {} }; } },
    ArbDrawBridge: { BridgeClient, normalizeVisaResource(value) { return value.trim(); } },
    ARBDRAW_MENU: { item() { return { dataset: {} }; }, setOpen() {} },
    selectedAwgProfile: { preferredBackend },
    projectDocument: { name: 'Test waveform' }, state: { data: [0, 1] },
    setInterval() {}, closeFileMenu() {}, showToast() {},
  });
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInContext(read('js/defaults.js'), context);
  const core = read('js/core.js');
  vm.runInContext(core.slice(0, core.indexOf('function resetStoredSettings')), context);
  vm.runInContext('const DEFAULT_VALUES = normalizeDefaults({ ...ARBDRAW_DEFAULTS, ...readStoredSettings() });', context);
  vm.runInContext(read('js/instruments.js'), context);
  return { $, sends, context, storage, async connect() { await $('bridgeConnectBtn').listeners.click(); } };
}

test('both TekScope backends force channel 1 and expose file settings', async () => {
  for (const backend of ['tekscope-mso2', 'tekscope-mso6']) {
    const { $, connect } = createHarness({ preferredBackend: backend });
    await connect();
    assert.equal($('instrumentChannel').value, '1');
    assert.equal($('instrumentChannel').disabled, true);
    assert.equal($('instrumentFileOptions').hidden, false);
    assert.equal($('instrumentDirectory').value, 'C:/baldee/');
    assert.equal($('instrumentOverwrite').checked, false);
    $('instrumentAdapter').value = 'other';
    $('instrumentAdapter').listeners.change();
    assert.equal($('instrumentChannel').disabled, false);
    assert.equal($('instrumentFileOptions').hidden, true);
    $('instrumentChannel').value = '2';
    $('instrumentAdapter').value = backend;
    $('instrumentAdapter').listeners.change();
    assert.equal($('instrumentChannel').value, '1');
    assert.equal($('instrumentChannel').disabled, true);
  }
});

test('profile changes also apply single-channel controls', async () => {
  const { $, connect, context } = createHarness();
  await connect();
  context.selectedAwgProfile.preferredBackend = 'tekscope-mso6';
  $('awgProfileSelect').listeners.change();
  assert.equal($('instrumentAdapter').value, 'tekscope-mso6');
  assert.equal($('instrumentChannel').value, '1');
  assert.equal($('instrumentChannel').disabled, true);
});

test('path and overwrite are saved locally and restored in a fresh UI', async () => {
  const storage = new Map([['arbdraw-settings', JSON.stringify({ includeCsvTimestamps: false })]]);
  const first = createHarness({ storage });
  first.$('instrumentDirectory').value = 'C:/my waveforms/';
  first.$('instrumentDirectory').listeners.input();
  first.$('instrumentOverwrite').checked = true;
  first.$('instrumentOverwrite').listeners.change();
  const saved = JSON.parse(storage.get('arbdraw-settings'));
  assert.equal(saved.tekScopeDirectory, 'C:/my waveforms/');
  assert.equal(saved.tekScopeOverwrite, true);
  assert.equal(saved.includeCsvTimestamps, false);
  const second = createHarness({ storage });
  assert.equal(second.$('instrumentDirectory').value, 'C:/my waveforms/');
  assert.equal(second.$('instrumentOverwrite').checked, true);
  second.$('instrumentOverwrite').checked = false;
  second.$('instrumentOverwrite').listeners.change();
  assert.equal(createHarness({ storage }).$('instrumentOverwrite').checked, false);
});

test('TekScope sends include file options and other adapters keep their channel options', async () => {
  for (const backend of ['tekscope-mso2', 'tekscope-mso6']) {
    const { $, sends, connect } = createHarness({ preferredBackend: backend });
    await connect();
    $('instrumentDirectory').value = 'C:/custom/';
    $('instrumentOverwrite').checked = true;
    await $('sendWaveformBtn').listeners.click();
    assert.deepEqual(JSON.parse(JSON.stringify(sends[0].options)), {
      channel: 1, enable_output: true, directory: 'C:/custom/', overwrite: true,
    });
    $('instrumentAdapter').value = 'other';
    $('instrumentAdapter').listeners.change();
    $('instrumentChannel').value = '2';
    await $('sendWaveformBtn').listeners.click();
    assert.deepEqual(JSON.parse(JSON.stringify(sends[1].options)), { channel: 2, enable_output: true });
  }
});
