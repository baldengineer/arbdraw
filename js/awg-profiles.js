// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Known arbitrary-waveform-generator capabilities and preferred upload backends.

globalThis.ARBDRAW_AWG_PROFILES = Object.freeze({
  owonXdg3000: Object.freeze({
    id: 'owon-xdg3000',
    name: 'OWON / Multicomp XDG-3000',
    vid: null,
    pid: null,
    sampleRateType: 'Fixed',
    sampleRateMSa: 1250,
    sampleDepth: Object.freeze({ default: 1000, max: 1_000_000 }),
    preferredBackend: 'owon-xdg3000',
  }),
  rigolDg1022: Object.freeze({
    id: 'rigol-dg1022',
    name: 'RIGOL DG1022',
    vid: '0x0400',
    pid: '0x09C4',
    sampleRateType: 'Fixed',
    sampleRateMSa: 100,
    sampleDepth: Object.freeze({ default: 1000, max: 4096 }),
    preferredBackend: 'rigol-dg1022',
  }),
  tekscopeFiles: Object.freeze({
    id: 'tekscope-files',
    name: 'TekScope (files)',
    vid: null,
    pid: null,
    sampleRateType: 'Fixed',
    sampleRateMSa: null,
    sampleDepth: Object.freeze({ default: 1000, max: null }),
    preferredBackend: 'file',
  }),
  other: Object.freeze({
    id: 'other',
    name: 'Other',
    vid: null,
    pid: null,
    sampleRateType: 'Fixed',
    sampleRateMSa: null,
    sampleDepth: Object.freeze({ default: null, max: null }),
    preferredBackend: null,
  }),
});

globalThis.ARBDRAW_DEFAULT_AWG_PROFILE = 'owon-xdg3000';
