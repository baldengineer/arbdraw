// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Known arbitrary-waveform-generator capabilities and preferred upload backends.
// Zero transition-time limits are placeholders and represent ideal step edges.

globalThis.ARBDRAW_AWG_PROFILES = Object.freeze({
  owonXdg3000: Object.freeze({
    id: 'owon-xdg3000',
    name: 'OWON / Multicomp XDG-3000',
    vid: '0x5345',
    pid: '0x1235',
    identification: Object.freeze([
      { manufacturer: /^OWON$/i, model: /^XDG3\d{3}$/i },
      { manufacturer: /^(Newark|Multicomp|Multicomp Pro)$/i, model: /^MP750290$/i },
    ]),
    sampleRateType: 'Fixed',
    sampleRateMSa: 1250,
    sampleDepth: Object.freeze({ default: 1000, max: 1_000_000 }),
    transitionTimeSeconds: Object.freeze({ min: 0, max: 0 }),
    preferredBackend: 'owon-xdg3000',
  }),
  rigolDg1022: Object.freeze({
    id: 'rigol-dg1022',
    name: 'RIGOL DG1022',
    vid: '0x0400',
    pid: '0x09C4',
    identification: Object.freeze([
      { manufacturer: /^RIGOL(?: TECHNOLOGIES)?$/i, model: /^DG1022$/i },
    ]),
    sampleRateType: 'Fixed',
    sampleRateMSa: 100,
    sampleDepth: Object.freeze({ default: 1000, max: 4096 }),
    transitionTimeSeconds: Object.freeze({ min: 0, max: 0 }),
    preferredBackend: 'rigol-dg1022',
    pyvisaOptions: Object.freeze({
      // read_termination: '\n',
      // write_termination: '\n',
      query_delay: 5,
      // send_end: true,
    }),
  }),
  tekscopeMso2: Object.freeze({
    id: 'tekscope-mso2',
    legacyIds: Object.freeze(['tekscope-files']),
    name: 'TekScope MSO2 (files)',
    identification: Object.freeze([
      { manufacturer: /^TEKTRONIX$/i, model: /^MSO2[24](?:-EDU)?$/i },
    ]),
    vid: null,
    pid: null,
    sampleRateType: 'Fixed',
    sampleRateMSa: null,
    sampleDepth: Object.freeze({ default: 100, max: 128_000 }),
    transitionTimeSeconds: Object.freeze({ min: 0, max: 0 }),
    preferredBackend: 'tekscope-mso2',
  }),
  tekscopeMso6: Object.freeze({
    id: 'tekscope-mso6',
    name: 'TekScope MSO6 (files)',
    identification: Object.freeze([
      { manufacturer: /^TEKTRONIX$/i, model: /^MSO6[468]B?$/i },
    ]),
    vid: null,
    pid: null,
    sampleRateType: 'Variable',
    sampleRateMSa: 250,
    sampleDepth: Object.freeze({ default: 1000, max: 131_072 }),
    frequencyHz: Object.freeze({ min: 0.1, max: 25_000_000 }),
    amplitudeVppByLoad: Object.freeze({
      HIGHZ: Object.freeze({ min: 0.02, max: 5 }),
      FIFTY: Object.freeze({ min: 0.01, max: 2.5 }),
    }),
    offsetVoltageByLoad: Object.freeze({
      HIGHZ: Object.freeze({ min: -2.5, max: 2.5 }),
      FIFTY: Object.freeze({ min: -1.25, max: 1.25 }),
    }),
    transitionTimeSeconds: Object.freeze({ min: 0, max: 0 }),
    preferredBackend: 'tekscope-mso6',
  }),
  audio: Object.freeze({
    id: 'audio',
    name: 'Audio',
    vid: null,
    pid: null,
    sampleRateType: 'Fixed',
    sampleRateMSa: 0.048,
    sampleDepth: Object.freeze({ default: 1000, max: 100_000 }),
    transitionTimeSeconds: Object.freeze({ min: 0, max: 0 }),
    preferredBackend: null,
  }),
  other: Object.freeze({
    id: 'other',
    name: 'Other',
    vid: null,
    pid: null,
    sampleRateType: 'Fixed',
    sampleRateMSa: null,
    sampleDepth: Object.freeze({ default: null, max: null }),
    transitionTimeSeconds: Object.freeze({ min: 0, max: 0 }),
    preferredBackend: null,
  }),
});

globalThis.ARBDRAW_DEFAULT_AWG_PROFILE = 'audio';

// Match profile metadata only; adapters still validate identity and transport
// before transferring. Never infer a command set from a manufacturer alone.
globalThis.ARBDRAW_MATCH_INSTRUMENT = function matchInstrument({
  identity = '', resource = '', adapters = [], profiles = Object.values(ARBDRAW_AWG_PROFILES),
} = {}) {
  const [manufacturer = '', model = ''] = String(identity).trim().split(',').map(field => field.trim());
  const usb = /^USB\d*::(0x[\da-f]+|\d+)::(0x[\da-f]+|\d+)::[^:]+(?:::\d+)?::INSTR$/i.exec(resource.trim());
  const usbId = value => /^(0x[\da-f]+|\d+)$/i.test(String(value)) &&
    Number(value) >= 0 && Number(value) <= 0xffff ? Number(value) : null;
  const known = profiles.filter(profile => profile.preferredBackend);
  const idnMatches = known.filter(profile => profile.identification?.some(rule =>
    rule.manufacturer.test(manufacturer) && rule.model.test(model)));
  const usbMatches = usb && usbId(usb[1]) !== null && usbId(usb[2]) !== null
    ? known.filter(profile => usbId(profile.vid) === usbId(usb[1]) && usbId(profile.pid) === usbId(usb[2])) : [];
  const noMatch = (status, reason) => ({ status, backend: null, profile: null, reason });
  let matches = idnMatches.length ? idnMatches : usbMatches;
  if (idnMatches.length && usbMatches.length) {
    matches = idnMatches.filter(profile => usbMatches.some(other => other.preferredBackend === profile.preferredBackend));
    if (!matches.length) return noMatch('ambiguous', 'Conflicting *IDN? and USB VID/PID matches; select a backend manually.');
  } else if (manufacturer && model && !idnMatches.length && usbMatches.length) {
    return noMatch('unknown', 'The *IDN? manufacturer/model is unsupported despite a known USB VID/PID; select a backend manually.');
  }
  const backends = [...new Set(matches.map(profile => profile.preferredBackend))];
  if (!backends.length) return noMatch('unknown', 'No known instrument match. Identify and generic VISA/SCPI remain available.');
  if (backends.length > 1) return noMatch('ambiguous', `Ambiguous instrument match (${backends.join(', ')}); select a backend manually.`);
  const backend = backends[0];
  const signals = [];
  if (idnMatches.length) signals.push(`*IDN? ${manufacturer}, ${model}`);
  if (usbMatches.length) signals.push(`USB VID/PID ${usb[1]}/${usb[2]}`);
  const reason = signals.join(' and ');
  if (!adapters.some(adapter => adapter.id === backend)) {
    return noMatch('unavailable', `Matched ${reason}, but backend "${backend}" is unavailable. Install its adapter or select an installed backend.`);
  }
  return { status: 'matched', backend, profile: matches.length === 1 ? matches[0] : null, reason };
};
