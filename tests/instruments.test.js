const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness({ storage = new Map(), preferredBackend = null,
  adapters = ['other', 'tekscope-mso2', 'tekscope-mso6'] } = {}) {
  const elements = new Map();
  const sends = [];
  const identifies = [];
  const $ = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '', checked: false, disabled: false, hidden: false, dataset: {}, options: [], listeners: {},
        classList: { toggle() {}, contains() { return false; } },
        addEventListener(type, listener) { this.listeners[type] = listener; },
        replaceChildren() { this.options = []; this.value = ''; },
        removeAttribute() {},
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
      return adapters.map((id) => ({ id }));
    }
    async identify(resource, options) {
      identifies.push({ resource, ...options });
      return { identity: 'Test instrument' };
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
  return { $, sends, identifies, context, storage, adapters, async connect() { await $('bridgeConnectBtn').listeners.click(); } };
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
  context.ARBDRAW_INSTRUMENTS.syncProfile();
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

function loadProfileChanges(fixture) {
  const { $, context } = fixture;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/awg-profiles.js'), 'utf8'), context);
  const profiles = context.ARBDRAW_AWG_PROFILES;
  Object.assign(context, {
    awgProfileSelect: $('awgProfileSelect'),
    profileById: id => Object.values(profiles).find(profile => profile.id === id),
    confirmWaveformReplacement: () => true,
    sampleLimitForProfile: () => 1000000,
    renderTiming() {}, generate() {}, persistCurrentSettings() {},
  });
  context.state.sampleRate = 1;
  context.state.samples = 2;
  const source = fs.readFileSync(path.join(__dirname, '../js/properties.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function applyAwgProfile('), source.indexOf('renderAwgProfiles();')), context);
  return profiles;
}

test('accepted profile changes synchronize open and closed dialogs and bridge requests', async () => {
  for (const open of [true, false]) {
    const f = createHarness({ preferredBackend: 'tekscope-mso2', adapters: ['rigol-dg1022', 'tekscope-mso2'] });
    const profiles = loadProfileChanges(f);
    await f.connect();
    f.$('bridgeDialog').open = open;
    assert.equal(f.context.applyAwgProfile(profiles.rigolDg1022), true);
    assert.equal(f.$('instrumentAdapter').value, 'rigol-dg1022');
    assert.equal(f.$('sendWaveformBtn').disabled, false);
    assert.equal(f.$('instrumentFileOptions').hidden, true);
    await f.$('identifyResourceBtn').listeners.click();
    await f.$('sendWaveformBtn').listeners.click();
    assert.equal(f.identifies[0].pyvisaOptions.query_delay, 5);
    assert.equal(f.sends[0].adapter, 'rigol-dg1022');
    assert.equal(f.sends[0].pyvisaOptions.query_delay, 5);
    f.context.applyAwgProfile(profiles.tekscopeMso2);
    await f.$('sendWaveformBtn').listeners.click();
    assert.equal(f.sends[1].adapter, 'tekscope-mso2');
    assert.equal(f.sends[1].options.channel, 1);
    assert.deepEqual(Object.keys(f.sends[1].pyvisaOptions), []);
  }
});

test('missing preferred adapter clears stale selection, keeps Identify, and blocks Send', async () => {
  const f = createHarness({ preferredBackend: 'tekscope-mso2' });
  const profiles = loadProfileChanges(f);
  await f.connect();
  f.context.applyAwgProfile(profiles.rigolDg1022);
  assert.equal(f.$('instrumentAdapter').value, '');
  assert.equal(f.$('sendWaveformBtn').disabled, true);
  assert.equal(f.$('identifyResourceBtn').disabled, false);
  assert.equal(f.$('instrumentFileOptions').hidden, true);
  assert.match(f.$('instrumentBackendHelp').textContent, /rigol-dg1022.*unavailable/);
  await f.$('sendWaveformBtn').listeners.click();
  assert.equal(f.sends.length, 0);
  await f.$('identifyResourceBtn').listeners.click();
  assert.equal(f.identifies[0].pyvisaOptions.query_delay, 5);
  assert.match(f.$('instrumentBackendHelp').textContent, /unavailable/);
});

test('no installed adapters and Audio/Other profiles start in Identify-only mode', async () => {
  const noAdapters = createHarness({ preferredBackend: 'tekscope-mso2', adapters: [] });
  await noAdapters.connect();
  assert.equal(noAdapters.$('instrumentAdapter').value, '');
  assert.equal(noAdapters.$('instrumentAdapter').disabled, true);
  assert.equal(noAdapters.$('sendWaveformBtn').disabled, true);
  assert.equal(noAdapters.$('identifyResourceBtn').disabled, false);
  for (const id of ['audio', 'other']) {
    const f = createHarness({ preferredBackend: 'tekscope-mso2' });
    const profiles = loadProfileChanges(f);
    await f.connect();
    f.context.applyAwgProfile(profiles[id]);
    assert.equal(f.$('instrumentAdapter').value, '');
    assert.equal(f.$('sendWaveformBtn').disabled, true);
    assert.match(f.$('instrumentBackendHelp').textContent, /no preferred waveform backend/);
    f.$('instrumentAdapter').value = 'other';
    f.$('instrumentAdapter').listeners.change();
    assert.equal(f.$('sendWaveformBtn').disabled, false);
    await f.$('sendWaveformBtn').listeners.click();
    assert.equal(f.sends[0].adapter, 'other');
  }
});

test('manual overrides are explained and do not inherit another backend\'s VISA options', async () => {
  const f = createHarness({ adapters: ['rigol-dg1022', 'tekscope-mso2'] });
  const profiles = loadProfileChanges(f);
  f.context.applyAwgProfile(profiles.rigolDg1022);
  await f.connect();
  f.$('instrumentAdapter').value = 'tekscope-mso2';
  f.$('instrumentAdapter').listeners.change();
  assert.match(f.$('instrumentBackendHelp').textContent, /manually selected.*differs/);
  await f.$('identifyResourceBtn').listeners.click();
  await f.$('sendWaveformBtn').listeners.click();
  assert.equal(f.sends[0].adapter, 'tekscope-mso2');
  assert.deepEqual(Object.keys(f.sends[0].pyvisaOptions), []);
  assert.deepEqual(Object.keys(f.identifies[0].pyvisaOptions), []);
  f.context.openSendToAwgDialog();
  assert.equal(f.$('instrumentAdapter').value, 'tekscope-mso2');
});

test('restoring a saved profile synchronizes the backend, while canceled changes preserve it', async () => {
  const f = createHarness({ preferredBackend: 'tekscope-mso2' });
  const profiles = loadProfileChanges(f);
  await f.connect();
  f.context.restoreAwgSettingsFromDocument({ profileId: 'tekscope-mso6', sampleCount: 1000, sampleRateMSa: 250 });
  assert.equal(f.$('instrumentAdapter').value, 'tekscope-mso6');
  assert.equal(f.$('instrumentChannel').disabled, true);
  f.$('instrumentAdapter').value = 'other';
  f.$('instrumentAdapter').listeners.change();
  f.context.confirmWaveformReplacement = () => false;
  assert.equal(f.context.applyAwgProfile(profiles.rigolDg1022), false);
  assert.equal(f.context.selectedAwgProfile.id, 'tekscope-mso6');
  assert.equal(f.$('instrumentAdapter').value, 'other');
});

test('reconnecting refreshes adapter availability without retaining removed backends', async () => {
  const f = createHarness({ preferredBackend: 'tekscope-mso2' });
  await f.connect();
  f.adapters.splice(0, f.adapters.length, 'other');
  await f.connect();
  assert.equal(f.$('instrumentAdapter').value, '');
  assert.equal(f.$('sendWaveformBtn').disabled, true);
  f.adapters.push('tekscope-mso2');
  await f.connect();
  assert.equal(f.$('instrumentAdapter').value, 'tekscope-mso2');
  assert.equal(f.$('sendWaveformBtn').disabled, false);
});
