const assert = require('node:assert/strict');
const test = require('node:test');

require('../js/awg-profiles.js');

test('every AWG profile declares zero transition-time limits', () => {
  const profiles = Object.values(globalThis.ARBDRAW_AWG_PROFILES);
  assert.ok(profiles.length > 0);
  for (const profile of profiles) {
    assert.deepEqual(profile.transitionTimeSeconds, { min: 0, max: 0 });
  }
});
