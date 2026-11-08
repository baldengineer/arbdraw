const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
require('../js/bridge-client.js');

function createHarness({ storage = new Map(), preferredBackend = null,
  adapters = ['other', 'tekscope-mso2', 'tekscope-mso6'], handlers = {} } = {}) {
  const elements = new Map();
  const sends = [];
  const identifies = [];
  const clients = [], requests = [], toasts = [], timers = new Map();
  let nextTimer = 0;
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
  class BridgeClient extends ArbDrawBridge.BridgeClient {
    constructor(baseUrl) { super(baseUrl); clients.push(this); }
    async health() {
      requests.push({ client: this, method: 'health' });
      return handlers.health ? handlers.health(this) : { api_version: 'v1' };
    }
    async listResources() {
      requests.push({ client: this, method: 'resources' });
      return handlers.resources ? handlers.resources(this) : ['TCPIP0::scope::INSTR'];
    }
    async listAdapters() {
      requests.push({ client: this, method: 'adapters' });
      if (handlers.adapters) return handlers.adapters(this);
      return adapters.map((id) => ({ id }));
    }
    async identify(resource, options) {
      identifies.push({ resource, ...options });
      if (handlers.identify) return handlers.identify(this);
      return { identity: 'Test instrument' };
    }
    async sendWaveform(resource, waveform, options) {
      sends.push({ resource, waveform, ...options });
      if (handlers.send) return handlers.send(this);
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
    setInterval(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); },
    closeFileMenu() {}, showToast(message) { toasts.push(message); },
  });
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInContext(read('js/defaults.js'), context);
  const core = read('js/core.js');
  vm.runInContext(core.slice(0, core.indexOf('function resetStoredSettings')), context);
  vm.runInContext('const DEFAULT_VALUES = normalizeDefaults({ ...ARBDRAW_DEFAULTS, ...readStoredSettings() });', context);
  vm.runInContext(read('js/instruments.js'), context);
  return { $, sends, identifies, context, storage, adapters, handlers, clients, requests, toasts, timers,
    async connect() { await $('bridgeConnectBtn').listeners.click(); },
    disconnect() { $('bridgeDisconnectBtn').listeners.click(); },
    editUrl(url) { $('bridgeUrlInput').value = url; $('bridgeUrlInput').listeners.input(); },
    async tick() { for (const callback of [...timers.values()]) await callback(); },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('opening is disconnected; URL edits leave the active connection unchanged until Connect', async () => {
  const f = createHarness();
  f.context.openSendToAwgDialog();
  assert.equal(f.$('bridgeStatus').dataset.status, 'disconnected');
  assert.equal(f.clients.length, 0);
  assert.equal(f.timers.size, 0);
  await f.connect();
  const active = f.clients[0].baseUrl;
  assert.equal(f.$('bridgeStatus').dataset.status, 'online');
  assert.equal(f.$('bridgeDisconnectBtn').disabled, false);
  f.editUrl('http://localhost:9999/');
  assert.match(f.$('bridgeConnectionHelp').textContent, /URL edited; select Connect/);
  assert.ok(f.$('bridgeConnectionHelp').textContent.includes(active));
  f.handlers.identify = client => ({ identity: client.baseUrl });
  await f.$('identifyResourceBtn').listeners.click();
  assert.ok(f.$('bridgeResult').textContent.includes(active));
  await f.connect();
  assert.equal(f.clients[1].baseUrl, 'http://localhost:9999');
  assert.equal(f.storage.get('arbdraw-bridge-url'), 'http://localhost:9999');
  assert.doesNotMatch(f.$('bridgeConnectionHelp').textContent, /URL edited/);
  assert.equal(f.timers.size, 1);
  f.disconnect();
  assert.equal(f.$('bridgeStatus').dataset.status, 'disconnected');
  assert.equal(f.$('bridgeDisconnectBtn').disabled, true);
  assert.equal(f.$('bridgeInstrumentControls').disabled, true);
  assert.equal(f.$('visaResourceInput').value, '');
  assert.equal(f.$('instrumentAdapter').options.length, 1);
  assert.equal(f.timers.size, 0);
  for (const id of ['refreshResourcesBtn', 'identifyResourceBtn', 'sendWaveformBtn']) {
    assert.equal(f.$(id).disabled, true);
    await f.$(id).listeners.click();
  }
  assert.equal(f.identifies.length, 1);
  assert.equal(f.sends.length, 0);
  const requestCount = f.requests.length;
  await f.tick();
  f.context.openSendToAwgDialog();
  assert.equal(f.requests.length, requestCount);
});

test('connection failures clear the previous session, report failure, and allow retry', async () => {
  for (const stage of ['invalid', 'protocol', 'health', 'adapters', 'resources']) {
    const f = createHarness();
    await f.connect();
    if (stage === 'invalid') f.editUrl('not a URL');
    else if (stage === 'protocol') f.editUrl('ftp://localhost');
    else f.handlers[stage] = () => { throw new Error(`Failed ${stage}`); };
    await f.connect();
    assert.equal(f.$('bridgeStatus').dataset.status, 'failed', stage);
    assert.equal(f.$('bridgeConnectBtn').disabled, false);
    assert.equal(f.$('bridgeDisconnectBtn').disabled, true);
    assert.equal(f.$('identifyResourceBtn').disabled, true);
    assert.equal(f.$('sendWaveformBtn').disabled, true);
    assert.equal(f.$('visaResourceInput').value, '');
    assert.equal(f.$('instrumentAdapter').options.length, 1);
    assert.match(f.$('bridgeResult').textContent, /✖ /);
    assert.equal(f.timers.size, 0);
    delete f.handlers[stage];
    f.editUrl('http://localhost:8876');
    await f.connect();
    assert.equal(f.$('bridgeStatus').dataset.status, 'online');
  }
});

test('URL edits made while connecting remain a draft after connection succeeds', async () => {
  const health = deferred();
  const f = createHarness({ handlers: { health: () => health.promise } });
  const connecting = f.connect();
  assert.equal(f.$('bridgeStatus').dataset.status, 'connecting');
  assert.equal(f.$('bridgeInstrumentControls').disabled, true);
  assert.equal(f.$('bridgeDisconnectBtn').disabled, false);
  f.editUrl('http://localhost:9999');
  health.resolve({ api_version: 'v1' });
  await connecting;
  assert.equal(f.$('bridgeUrlInput').value, 'http://localhost:9999');
  assert.match(f.$('bridgeConnectionHelp').textContent, /URL edited/);
  assert.equal(f.storage.get('arbdraw-bridge-url'), f.clients[0].baseUrl);
});

test('disconnect during any connection stage ignores late success and failure after reconnect', async () => {
  for (const stage of ['health', 'adapters', 'resources']) {
    for (const fail of [false, true]) {
      const pending = deferred(), started = deferred();
      const f = createHarness({ handlers: { [stage]: () => { started.resolve(); return pending.promise; } } });
      const oldConnection = f.connect();
      await started.promise;
      f.disconnect();
      delete f.handlers[stage];
      f.editUrl('http://localhost:9999');
      await f.connect();
      const result = f.$('bridgeResult').textContent;
      if (fail) pending.reject(new Error('Old connection failed'));
      else pending.resolve(stage === 'health' ? { api_version: 'obsolete' } : []);
      await oldConnection;
      assert.equal(f.$('bridgeStatus').textContent, 'Connected · API v1');
      assert.equal(f.$('bridgeResult').textContent, result);
      assert.equal(f.$('visaResourceInput').value, 'TCPIP0::scope::INSTR');
      assert.equal(f.storage.get('arbdraw-bridge-url'), 'http://localhost:9999');
      assert.equal(f.timers.size, 1);
      const oldRequests = f.requests.filter(request => request.client === f.clients[0]);
      assert.equal(oldRequests.length, ['health', 'adapters', 'resources'].indexOf(stage) + 1);
    }
  }
});

test('late instrument results and errors cannot overwrite a reconnect or release its busy state', async () => {
  for (const [id, method, response] of [
    ['refreshResourcesBtn', 'resources', ['OLD::INSTR']],
    ['identifyResourceBtn', 'identify', { identity: 'Old instrument' }],
    ['sendWaveformBtn', 'send', { message: 'Old waveform sent' }],
  ]) {
    for (const fail of [false, true]) {
      const f = createHarness({ preferredBackend: 'tekscope-mso2' });
      await f.connect();
      const pending = deferred();
      f.handlers[method] = () => pending.promise;
      const action = f.$(id).listeners.click();
      f.disconnect();
      delete f.handlers[method];
      const newHealth = deferred();
      f.handlers.health = () => newHealth.promise;
      const reconnect = f.connect();
      if (fail) pending.reject(Object.assign(new Error('Old request failed'), { code: 'bridge_timeout' }));
      else pending.resolve(response);
      await action;
      assert.equal(f.$('bridgeStatus').dataset.status, 'connecting');
      assert.equal(f.$('bridgeConnectBtn').disabled, true);
      assert.equal(f.$('bridgeResult').textContent, '');
      assert.deepEqual(f.toasts, []);
      newHealth.resolve({ api_version: 'v1' });
      await reconnect;
      assert.equal(f.$('bridgeStatus').dataset.status, 'online');
      assert.equal(f.$('visaResourceInput').value, 'TCPIP0::scope::INSTR');
    }
  }
});

test('keepalive only runs while connected and open; failure requires explicit reconnect', async () => {
  const f = createHarness();
  await f.connect();
  const count = f.requests.length;
  await f.tick();
  assert.equal(f.requests.length, count);
  f.context.openSendToAwgDialog();
  await f.tick();
  assert.equal(f.requests.length, count + 1);
  f.handlers.health = () => { throw new Error('Bridge unavailable'); };
  await f.tick();
  assert.equal(f.$('bridgeStatus').dataset.status, 'failed');
  assert.equal(f.$('identifyResourceBtn').disabled, true);
  assert.equal(f.timers.size, 0);
  delete f.handlers.health;
  await f.tick();
  assert.equal(f.$('bridgeStatus').dataset.status, 'failed');
  await f.connect();
  assert.equal(f.$('bridgeStatus').dataset.status, 'online');
});

test('old keepalive cannot revive a disconnected session or clear a new pending health check', async () => {
  for (const fail of [false, true]) {
    const f = createHarness();
    await f.connect();
    f.context.openSendToAwgDialog();
    const oldHealth = deferred();
    f.handlers.health = () => oldHealth.promise;
    const oldCheck = f.tick();
    f.disconnect();
    delete f.handlers.health;
    await f.connect();
    const newHealth = deferred();
    f.handlers.health = () => newHealth.promise;
    const newCheck = f.tick();
    const requestCount = f.requests.length;
    if (fail) oldHealth.reject(new Error('Old health failure'));
    else oldHealth.resolve({ api_version: 'obsolete' });
    await oldCheck;
    await f.tick();
    assert.equal(f.requests.length, requestCount);
    assert.equal(f.$('bridgeStatus').textContent, 'Connected · API v1');
    f.disconnect();
    newHealth.resolve({ api_version: 'obsolete' });
    await newCheck;
    assert.equal(f.$('bridgeStatus').dataset.status, 'disconnected');
    assert.equal(f.timers.size, 0);
  }
});

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
