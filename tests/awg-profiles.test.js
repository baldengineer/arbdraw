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

  assert.deepEqual(profile.pyvisaOptions, {});
  assert.ok(Object.isFrozen(profile.pyvisaOptions));
  assert.match(source, /\/\/ read_termination: '\\n'/);
  assert.match(source, /\/\/ write_termination: '\\n'/);
  assert.match(source, /\/\/ query_delay: 5/);
  assert.match(source, /\/\/ send_end: true/);
  assert.match(instruments, /selectedAwgProfile\?\.pyvisaOptions/);
  assert.match(instruments, /bridgeClient\.identify\([\s\S]*pyvisaOptions:/);
  assert.match(instruments, /bridgeClient\.sendWaveform\([\s\S]*pyvisaOptions:/);
});
