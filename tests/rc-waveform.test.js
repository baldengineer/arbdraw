const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { rcVoltage } = require('../js/waveform-shapes.js');

test('RC curve follows the capacitor charging equation', () => {
  assert.equal(rcVoltage({ phase: 0, low: -2, high: 6, tau: 5 }), -2);
  assert.ok(Math.abs(rcVoltage({ phase: 0.2, low: -2, high: 6, tau: 5 }) - (6 - 8 / Math.E)) < 1e-12);
  assert.ok(Math.abs(rcVoltage({ phase: 1 - Number.EPSILON, low: -2, high: 6, tau: 5 }) - (6 - 8 * Math.exp(-5))) < 1e-12);
});

function projectContext() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../js/defaults.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../js/core.js'), 'utf8'), context);
  const source = fs.readFileSync(require.resolve('../js/project.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function parseProject('), source.indexOf('function loadProject(')), context);
  return context;
}

test('RC tau defaults, normalizes, and survives project JSON round trips', () => {
  const context = projectContext();
  assert.equal(context.createDefaultDocument().waveform.rcTau, 5);
  assert.equal(context.normalizeDefaults({ waveformType: 'rc', rcTau: 2.5 }).waveformType, 'rc');
  assert.equal(context.normalizeDefaults({ rcTau: -1 }).rcTau, 0.000001);

  const doc = context.createDefaultDocument();
  doc.waveform.type = 'rc';
  doc.waveform.rcTau = 3.5;
  const imported = context.parseProject(JSON.parse(JSON.stringify(doc))).waveform;
  assert.equal(imported.type, 'rc');
  assert.equal(imported.rcTau, 3.5);

  delete doc.waveform.rcTau;
  assert.equal(context.parseProject(doc).waveform.rcTau, 5);
});
