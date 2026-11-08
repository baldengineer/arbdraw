const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

require('../js/awg-profiles.js');

function profileChangeHarness({ type = 'sine', edited = true, count = 4 } = {}) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', classList: { contains: () => false },
      removeAttribute(name) { delete this[name]; },
    });
    return elements.get(id);
  };
  const calls = { confirmations: 0, generated: 0, persisted: 0, synced: 0, stopped: 0, toasts: [] };
  const state = {
    type, samplesEdited: edited, data: Array.from({ length: count }, (_, i) => i % 4 - 1.5),
    samples: count, sampleRate: 1, duration: count / 1000,
    high: 1.5, low: -1.5, frequency: 100, cycles: 2,
    selection: { left: 1, right: 3 }, viewport: { start: 0, end: 3 }, tool: 'pencil',
    filters: { enabled: true, smoothingEnabled: true }, history: [{ values: [1, 2] }], redo: [{ values: [3, 4] }],
  };
  const context = vm.createContext({
    $, state, awgProfileSelect: $('awgProfileSelect'),
    selectedAwgProfile: globalThis.ARBDRAW_AWG_PROFILES.other,
    ARBDRAW_INSTRUMENTS: { syncProfile() { calls.synced++; } },
    ARBDRAW_AUDIO_PLAYBACK: { stop() { calls.stopped++; } },
    confirmWaveformReplacement() { calls.confirmations++; return true; },
    generate() { calls.generated++; state.data = Array(state.samples).fill(0); state.samplesEdited = false; },
    renderTiming() {}, draw() {}, renderSamples() {},
    persistCurrentSettings() { calls.persisted++; },
    showToast(message) { calls.toasts.push(message); },
  });
  const core = fs.readFileSync(path.join(__dirname, '../js/core.js'), 'utf8');
  vm.runInContext(core.slice(0, core.indexOf('function normalizeDefaults(')), context);
  const properties = fs.readFileSync(path.join(__dirname, '../js/properties.js'), 'utf8');
  vm.runInContext(properties.slice(properties.indexOf('function applyAwgProfile('),
    properties.indexOf('function restoreAwgSettingsFromDocument(')), context);
  return { context, state, calls, $ };
}

test('profile changes preserve arbitrary samples and editor state without a replacement prompt', () => {
  for (const options of [{ type: 'custom', edited: false }, { type: 'sine', edited: true }]) {
    const { context, state, calls, $ } = profileChangeHarness(options);
    const before = { ...state };
    for (const profile of [globalThis.ARBDRAW_AWG_PROFILES.rigolDg1022,
      globalThis.ARBDRAW_AWG_PROFILES.audio, globalThis.ARBDRAW_AWG_PROFILES.other]) {
      $('awgProfileSelect').value = profile.id;
      assert.equal(context.applyAwgProfile(profile), true);
      assert.equal(context.selectedAwgProfile, profile);
      for (const key of Object.keys(before).filter(key => !['sampleRate', 'duration'].includes(key)))
        assert.equal(state[key], before[key], `${key} survives ${profile.id}`);
    }
    assert.equal(state.sampleRate, 0.048);
    assert.equal(state.duration, state.samples / 48);
    assert.equal(calls.confirmations, 0);
    assert.equal(calls.generated, 0);
    assert.equal(calls.persisted, 3);
    assert.equal(calls.synced, 3);
    assert.equal(calls.stopped, 3);
    assert.deepEqual(calls.toasts, []);
  }
});

test('an incompatible profile is rejected before changing arbitrary data or backend', () => {
  const { context, state, calls, $ } = profileChangeHarness({ count: 4097 });
  const before = { ...state };
  $('awgProfileSelect').value = 'rigol-dg1022';
  assert.equal(context.applyAwgProfile(globalThis.ARBDRAW_AWG_PROFILES.rigolDg1022), false);
  assert.deepEqual(state, before);
  assert.equal(context.selectedAwgProfile.id, 'other');
  assert.equal($('awgProfileSelect').value, 'other');
  assert.equal(calls.synced, 0);
  assert.equal(calls.persisted, 0);
  assert.equal(calls.generated, 0);
  assert.equal(calls.confirmations, 0);
  assert.match(calls.toasts[0], /4096.*4097.*unchanged/);
});

test('arbitrary waveforms at the profile limit are preserved', () => {
  const { context, state } = profileChangeHarness({ count: 4096 });
  const data = state.data;
  assert.equal(context.applyAwgProfile(globalThis.ARBDRAW_AWG_PROFILES.rigolDg1022), true);
  assert.equal(state.data, data);
  assert.equal(state.samples, 4096);
});

test('unedited built-in waveforms retain profile defaults and regeneration', () => {
  const { context, state, calls } = profileChangeHarness({ edited: false });
  assert.equal(context.applyAwgProfile(globalThis.ARBDRAW_AWG_PROFILES.rigolDg1022), true);
  assert.equal(state.samples, 1000);
  assert.equal(state.sampleRate, 100);
  assert.equal(calls.generated, 1);
});

test('every AWG profile declares zero transition-time limits', () => {
  const profiles = Object.values(globalThis.ARBDRAW_AWG_PROFILES);
  assert.ok(profiles.length > 0);
  for (const profile of profiles) {
    assert.deepEqual(profile.transitionTimeSeconds, { min: 0, max: 0 });
  }
});

test('Rigol profile provides documented PyVISA option hooks', () => {
  const profile = globalThis.ARBDRAW_AWG_PROFILES.rigolDg1022;
  const source = fs.readFileSync(path.join(__dirname, '../js/awg-profiles.js'), 'utf8');
  const instruments = fs.readFileSync(path.join(__dirname, '../js/instruments.js'), 'utf8');

  assert.deepEqual(profile.pyvisaOptions, { query_delay: 5 });
  assert.ok(Object.isFrozen(profile.pyvisaOptions));
  assert.match(source, /\/\/ read_termination: '\\n'/);
  assert.match(source, /\/\/ write_termination: '\\n'/);
  assert.match(source, /^\s+query_delay: 5,/m);
  assert.match(source, /\/\/ send_end: true/);
  assert.match(instruments, /selectedAwgProfile\?\.pyvisaOptions/);
  assert.match(instruments, /client\.identify\([\s\S]*pyvisaOptions:/);
  assert.match(instruments, /client\.sendWaveform\([\s\S]*pyvisaOptions:/);
});

test('TekScope profiles select model-specific adapters and arb depths', () => {
  const mso2 = globalThis.ARBDRAW_AWG_PROFILES.tekscopeMso2;
  const mso6 = globalThis.ARBDRAW_AWG_PROFILES.tekscopeMso6;
  const core = fs.readFileSync(path.join(__dirname, '../js/core.js'), 'utf8');
  const instruments = fs.readFileSync(path.join(__dirname, '../js/instruments.js'), 'utf8');
  const properties = fs.readFileSync(path.join(__dirname, '../js/properties.js'), 'utf8');
  assert.equal(mso2.id, 'tekscope-mso2');
  assert.deepEqual(mso2.legacyIds, ['tekscope-files']);
  assert.equal(mso2.preferredBackend, 'tekscope-mso2');
  assert.deepEqual(mso2.sampleDepth, { default: 100, max: 128_000 });
  assert.equal(mso6.id, 'tekscope-mso6');
  assert.equal(mso6.preferredBackend, 'tekscope-mso6');
  assert.equal(mso6.sampleRateType, 'Variable');
  assert.equal(mso6.sampleRateMSa, 250);
  assert.deepEqual(mso6.sampleDepth, { default: 1000, max: 131_072 });
  assert.deepEqual(mso6.frequencyHz, { min: 0.1, max: 25_000_000 });
  assert.deepEqual(mso6.amplitudeVppByLoad, {
    HIGHZ: { min: 0.02, max: 5 },
    FIFTY: { min: 0.01, max: 2.5 },
  });
  assert.deepEqual(mso6.offsetVoltageByLoad, {
    HIGHZ: { min: -2.5, max: 2.5 },
    FIFTY: { min: -1.25, max: 1.25 },
  });
  assert.match(instruments, /selectedAwgProfile\?\.preferredBackend/);
  assert.match(core, /profile\.legacyIds\?\.includes\(preferred\)/);
  assert.match(properties, /profile\.legacyIds\?\.includes\(id\)/);
});
