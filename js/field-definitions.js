// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Human-editable definitions for common ArbDraw fields.
// Field definitions live-update by default; set liveUpdate: false for an
// explicit-submit control.

const ARBDRAW_FIELD_DEFINITIONS = {
  inspector: {
    highInput: {
      kind: 'number',
      label: 'High level',
      title: 'Used by some AWGs to configure output',
      constraints: {},
    },
    lowInput: {
      kind: 'number',
      label: 'Low level',
      title: 'Used by some AWGs to configure output',
      constraints: {},
    },
    amplitudeInput: {
      kind: 'number',
      label: 'Amplitude',
      title: 'Used by some AWGs to configure output',
      constraints: { min: 0 },
    },
    offsetInput: {
      kind: 'number',
      label: 'Offset',
      title: 'Sets the waveform\'s DC level',
      constraints: {},
    },
    cyclesInput: {
      kind: 'number',
      label: 'N Cycles',
      title: 'Repeats within the period setting',
      constraints: { min: 1, integer: true },
    },
    frequencyInput: {
      kind: 'number',
      label: 'Frequency',
      title: 'Set this frequency or period on the Arb',
      constraints: { min: 1e-6 },
    },
    periodInput: {
      kind: 'number',
      label: 'Period',
      title: 'Set this frequency or period on the Arb',
      constraints: { min: 1e-12 },
    },
    phaseInput: {
      kind: 'number',
      label: 'Phase',
      constraints: {},
    },
    symmetryInput: {
      kind: 'number',
      label: 'Triangle symmetry',
      title: '0% falling ramp,\n50% triangle,\n100% rising ramp.',
      constraints: { min: 0, max: 100 },
    },
    rcTauInput: {
      kind: 'number',
      label: 'RC time constants per cycle',
      title: 'Number of RC time constants in one cycle. τ = R × C.',
      constraints: { min: 1e-6 },
    },
    riseTimeInput: {
      kind: 'number',
      label: 'Rise time',
      title: '0 for fastest',
      constraints: { min: 0 },
    },
    fallTimeInput: {
      kind: 'number',
      label: 'Fall time',
      title: '0 for fastest',
      constraints: { min: 0 },
    },
  },

  filterValue: {
    kind: 'number',
    label: 'Filter value',
    liveUpdate: false,
    behavior: 'manual',
    constraints: { min: 0 },
  },

  timing: {
    rateEdit: {
      kind: 'number',
      label: 'Sample rate',
      title: 'Determines sample point resolution',
    },
    samplesEdit: {
      kind: 'number',
      label: 'Samples',
      title: 'Waveform sample buffer size',
    },
    tsResolutionEdit: {
      kind: 'number',
      label: 'TS resolution',
      title: 'Inverse of sample rate.\nTS means timestamps.\nSome AWGs ignore this value.',
    },
    awgFrequencyEdit: {
      kind: 'text',
      label: 'AWG frequency',
      title: 'Set AWG frequency to this value',
      readonly: true,
    },
    awgPeriodEdit: {
      kind: 'text',
      label: 'AWG period',
      title: 'Set AWG period to this value',
      readonly: true,
    },
  },

  scope: {
    scopeVoltsDiv: {
      kind: 'number',
      label: 'Vertical scale',
      title: 'Vertical scale in volts per division',
    },
    scopeVerticalPosition: {
      kind: 'number',
      label: 'Vertical position',
      title: 'Vertical position of the waveform',
    },
    scopeTimeDiv: {
      kind: 'number',
      label: 'Time per division',
      title: 'Time per horizontal division',
    },
  },

  project: {
    projectName: {
      kind: 'text',
      label: 'Project name',
      title: 'Click to rename project',
      readonly: true,
    },
  },

  serial: {
    serialProtocol: {
      kind: 'select',
      label: 'Protocol',
      title: 'Select the serial protocol.\nI2C is not implemented.',
      behavior: 'commitOnChange',
    },
    serialBaud: {
      kind: 'number',
      label: 'Baud',
      constraints: { min: 1, integer: true },
      behavior: 'commitOnExit',
    },
    serialPreIdle: {
      kind: 'number',
      label: 'Pre Idle',
      constraints: { min: 0, integer: true },
      behavior: 'commitOnExit',
    },
    serialPostIdle: {
      kind: 'number',
      label: 'Post Idle',
      constraints: { min: 0, integer: true },
      behavior: 'commitOnExit',
    },
    serialPayload: {
      kind: 'text',
      label: 'Payload',
      title: 'Enter a hexadecimal payload such as 0xAA or a text string.\nThe period resizes to fit the complete payload.',
      behavior: 'commitOnExit',
    },
    serialBinaryPattern: {
      kind: 'text',
      label: 'Binary pattern',
      behavior: 'commitOnExit',
    },
  },
};

globalThis.ARBDRAW_FIELD_DEFINITIONS = ARBDRAW_FIELD_DEFINITIONS;
