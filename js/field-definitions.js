// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Human-editable definitions for common ArbDraw fields.

const ARBDRAW_FIELD_DEFINITIONS = {
  inspector: {
    highInput: { kind: 'number', label: 'High level', constraints: {} },
    lowInput: { kind: 'number', label: 'Low level', constraints: {} },
    amplitudeInput: { kind: 'number', label: 'Amplitude', constraints: { min: 0 } },
    offsetInput: { kind: 'number', label: 'Offset', constraints: {} },
    cyclesInput: { kind: 'number', label: 'N Cycles', constraints: { min: 1, integer: true } },
    frequencyInput: { kind: 'number', label: 'Frequency', constraints: { min: 1e-6 } },
    periodInput: { kind: 'number', label: 'Period', constraints: { min: 1e-12 } },
    phaseInput: { kind: 'number', label: 'Phase', constraints: {} },
    symmetryInput: { kind: 'number', label: 'Triangle symmetry', constraints: { min: 0, max: 100 } },
    riseTimeInput: { kind: 'number', label: 'Rise time', constraints: { min: 0 } },
    fallTimeInput: { kind: 'number', label: 'Fall time', constraints: { min: 0 } },
  },
  filterValue: { kind: 'number', label: 'Filter value', behavior: 'manual', constraints: { min: 0 } },
  serial: {
    serialBaud: { kind: 'number', label: 'Baud', constraints: { min: 1, integer: true }, behavior: 'commitOnExit' },
    serialPreIdle: { kind: 'number', label: 'Pre Idle', constraints: { min: 0, integer: true }, behavior: 'commitOnExit' },
    serialPostIdle: { kind: 'number', label: 'Post Idle', constraints: { min: 0, integer: true }, behavior: 'commitOnExit' },
    serialPayload: { kind: 'text', label: 'Payload', behavior: 'commitOnExit' },
    serialBinaryPattern: { kind: 'text', label: 'Binary pattern', behavior: 'commitOnExit' },
  },
};

globalThis.ARBDRAW_FIELD_DEFINITIONS = ARBDRAW_FIELD_DEFINITIONS;
