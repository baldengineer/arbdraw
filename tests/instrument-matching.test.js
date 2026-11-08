const assert = require('node:assert/strict');
const test = require('node:test');
require('../js/awg-profiles.js');

const profiles = Object.values(ARBDRAW_AWG_PROFILES);
const adapters = profiles.filter(profile => profile.preferredBackend).map(profile => ({ id: profile.preferredBackend }));
const match = options => ARBDRAW_MATCH_INSTRUMENT({ adapters, ...options });

test('identification matches supported manufacturer/model fields exactly, ignoring case and surrounding whitespace', () => {
  for (const [identity, backend] of [
    [' RIGOL TECHNOLOGIES , DG1022 ,SN,FW\r\n', 'rigol-dg1022'],
    ['rigol,dg1022,SN,FW', 'rigol-dg1022'],
    ['OWON,XDG3102,SN,FW', 'owon-xdg3000'],
    ['Newark,MP750290,2025332,SCPI:99.0 FV:V2.7.0', 'owon-xdg3000'],
    ['Multicomp Pro,MP750290,SN,FW', 'owon-xdg3000'],
    ...['MSO22', 'MSO24', 'MSO22-EDU', 'MSO24-EDU'].map(model => [`TEKTRONIX,${model},SN,FW`, 'tekscope-mso2']),
    ...['MSO64', 'MSO66', 'MSO68', 'MSO64B', 'MSO66B', 'MSO68B'].map(model => [`TEKTRONIX,${model},SN,FW`, 'tekscope-mso6']),
  ]) {
    const result = match({ identity, resource: 'TCPIP0::scope::INSTR' });
    assert.equal(result.backend, backend, identity);
    assert.equal(result.status, 'matched');
    assert.match(result.reason, /\*IDN\?/);
  }
});

test('USB-only identification accepts decimal and hex VID/PID, optional board and interface numbers', () => {
  for (const resource of ['USB0::0x0400::0x09C4::SN::INSTR', 'usb::1024::2500::SN::0::instr', 'USB12::0X400::2500::SN::INSTR']) {
    const result = match({ resource });
    assert.equal(result.backend, 'rigol-dg1022');
    assert.match(result.reason, /USB VID\/PID/);
  }
  assert.equal(match({ resource: 'USB0::0x5345::0x1235::2025332::INSTR' }).backend, 'owon-xdg3000');
  const both = match({ identity: 'RIGOL,DG1022,SN,FW', resource: 'USB0::1024::2500::SN::INSTR' });
  assert.match(both.reason, /\*IDN\?.*and USB VID\/PID/);
});

test('unknown models, misleading substrings, and malformed resources never select a backend', () => {
  for (const identity of ['', 'DG1022', 'RIGOL,DG1022Z', 'Other,DG1022', 'Fake RIGOL,DG1022', 'TEKTRONIX,MSO24B', 'TEKTRONIX,MSO64B-extra']) {
    assert.equal(match({ identity }).backend, null, identity);
  }
  for (const resource of ['USB0::0x0400::0x09C4oops::SN::INSTR', 'TCPIP0::1024::2500::SN::INSTR',
    'USB0::1024::2500::SN::RAW', 'USB0::1024::2500::INSTR', 'USB0::0x10400::2500::SN::INSTR', 'USB0::0::0::SN::INSTR']) {
    assert.equal(match({ resource }).backend, null, resource);
  }
});

test('conflicting or unsupported identity does not inherit a backend from USB', () => {
  const resource = 'USB0::1024::2500::SN::INSTR';
  assert.equal(match({ resource, identity: 'TEKTRONIX,MSO24,SN,FW' }).status, 'ambiguous');
  assert.equal(match({ resource, identity: 'RIGOL,DG1022Z,SN,FW' }).backend, null);
});

test('missing installed adapters and ambiguous registrations cannot silently fall back', () => {
  const identity = 'RIGOL,DG1022,SN,FW';
  const unavailable = match({ identity, adapters: [{ id: 'default' }] });
  assert.equal(unavailable.backend, null);
  assert.equal(unavailable.status, 'unavailable');
  assert.match(unavailable.reason, /rigol-dg1022.*unavailable/);
  const duplicate = { ...ARBDRAW_AWG_PROFILES.rigolDg1022, preferredBackend: 'competing' };
  assert.equal(match({ identity, profiles: [...profiles, duplicate] }).status, 'ambiguous');
  assert.equal(match({ identity, profiles: [...profiles, ARBDRAW_AWG_PROFILES.rigolDg1022] }).backend, 'rigol-dg1022');
});

test('model identification disambiguates a shared USB pair', () => {
  const shared = { ...ARBDRAW_AWG_PROFILES.tekscopeMso2, vid: '0x0400', pid: '0x09C4' };
  const options = { resource: 'USB0::1024::2500::SN::INSTR', profiles: [...profiles, shared] };
  assert.equal(match(options).status, 'ambiguous');
  assert.equal(match({ ...options, identity: 'RIGOL,DG1022,SN,FW' }).backend, 'rigol-dg1022');
});
