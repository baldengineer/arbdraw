const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

require('../js/awg-profiles.js');

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
  assert.match(instruments, /bridgeClient\.identify\([\s\S]*pyvisaOptions:/);
  assert.match(instruments, /bridgeClient\.sendWaveform\([\s\S]*pyvisaOptions:/);
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
  assert.match(instruments, /adapterSelect\.value = preferred/);
  assert.match(core, /profile\.legacyIds\?\.includes\(preferred\)/);
  assert.match(properties, /profile\.legacyIds\?\.includes\(id\)/);
});
