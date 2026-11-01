const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function harness(stored = {}, search = '', defaults = {}) {
  const storage = { value: JSON.stringify(stored) };
  const labels = { sampleCountUnitBtn: 'pts', sampleRateUnitBtn: 'Mpts/s', amplitudeUnitBtn: 'Vpp',
    frequencyUnitBtn: 'Hz', periodUnitBtn: 'ms', tsResolutionUnitBtn: 'ns' };
  const context = vm.createContext({ URLSearchParams,
    window: { location: { search } },
    localStorage: { getItem: () => storage.value, setItem: (_, value) => { storage.value = value; } },
    $: id => ({ textContent: labels[id], closest: () => ({ querySelector: () => ({ textContent: 'V' }) }) }),
    document: { querySelector: () => ({ textContent: 'ns' }) },
  });
  context.document.getElementById = context.$;
  vm.runInContext(read('js/awg-profiles.js') + read('js/defaults.js'), context);
  context.ARBDRAW_DEFAULTS = { ...context.ARBDRAW_DEFAULTS, ...defaults };
  vm.runInContext(read('js/core.js'), context);
  const properties = read('js/properties.js');
  vm.runInContext(properties.slice(0, properties.indexOf('const awgProfileSelect'))
    + properties.slice(properties.indexOf('function persistCurrentSettings()'), properties.indexOf('function displayAmplitude(')), context);
  const run = code => vm.runInContext(code, context);
  run('var selectedAwgProfile = ARBDRAW_AWG_PROFILES.audio;');
  return { context, storage, labels, run };
}

test('actual settings writer round trips every sample count/rate display unit', () => {
  for (const countUnit of ['pts', 'Kpts', 'Mpts']) for (const rateUnit of ['pts/s', 'Kpts/s', 'Mpts/s', 'Sa/s', 'kSa/s', 'MSa/s', 'GSa/s']) {
    const { run, storage, labels } = harness();
    labels.sampleCountUnitBtn = countUnit; labels.sampleRateUnitBtn = rateUnit;
    run(`state.samples = 1000; state.sampleRate = 0.048;
      sampleCountUnitScale = SAMPLE_COUNT_UNITS['${countUnit}'];
      sampleRateUnitScale = SAMPLE_RATE_UNITS['${rateUnit}']; persistCurrentSettings();`);
    const stored = JSON.parse(storage.value), reloaded = harness(stored);
    assert.equal(stored.settingsVersion, 1);
    assert.equal(reloaded.run('state.samples'), 1000);
    assert.ok(Math.abs(reloaded.run('state.sampleRate') - 0.048) < 1e-12);
    assert.equal(reloaded.run('DEFAULT_VALUES.sampleCountUnit'), countUnit);
  }
});

test('unversioned canonical timing settings migrate once, including the old kpts alias', () => {
  const first = harness({ sampleCount: 1000, sampleCountUnit: 'Mpts', sampleRateMSa: 0.048, sampleRateUnit: 'Kpts/s' });
  assert.equal(first.run('state.samples'), 1000);
  assert.equal(first.run('state.sampleRate'), 0.048);
  assert.equal(JSON.parse(first.storage.value).sampleCount, 0.001);
  const second = harness(JSON.parse(first.storage.value));
  assert.equal(second.run('state.samples'), 1000);
  assert.equal(second.run('state.sampleRate'), 0.048);
  const alias = harness({ sampleCount: 1000, sampleCountUnit: 'kpts' });
  assert.equal(alias.run('state.samples'), 1000);
  assert.equal(alias.run('DEFAULT_VALUES.sampleCountUnit'), 'Kpts');
});

test('defaults and URL quantities keep their display-unit contract; startup counts are bounded', () => {
  const defaults = harness({}, '', { sampleCount: 2, sampleCountUnit: 'Kpts', sampleRateMSa: 48, sampleRateUnit: 'Kpts/s' });
  assert.equal(defaults.run('state.samples'), 2000);
  assert.equal(defaults.run('state.sampleRate'), 0.048);
  const url = harness({}, '?sampleCount=3&sampleCountUnit=Kpts&sampleRateMSa=96&sampleRateUnit=Kpts/s');
  assert.equal(url.run('state.samples'), 3000);
  assert.equal(url.run('state.sampleRate'), 0.096);
  for (const [id, limit] of [['rigol-dg1022', 4096], ['other', 1000000], ['missing', 100000]]) {
    const h = harness({}, `?sampleCount=1e308&sampleCountUnit=Mpts&awgProfileId=${id}`);
    assert.equal(h.run('state.samples'), limit);
    assert.equal(h.run('state.data.length'), 0); // inspect bounds without allocating the buffer
  }
});
