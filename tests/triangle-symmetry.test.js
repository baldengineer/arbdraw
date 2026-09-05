const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { triangleVoltage } = require('../js/waveform-shapes.js');
const sample = (phase, symmetryPercent) => triangleVoltage({ phase, symmetryPercent, low: -2, high: 6 });

test('triangle symmetry controls rise and fall durations and ramp endpoints', () => {
  assert.deepEqual([0, .25, .5, .75, 1].map(p => sample(p, 50)), [-2, 2, 6, 2, -2]);
  assert.deepEqual([0, .125, .25, .625, 1].map(p => sample(p, 25)), [-2, 2, 6, 2, -2]);
  assert.deepEqual([0, .25, .5, .75, 1].map(p => sample(p, 100)), [-2, 0, 2, 4, -2]);
  assert.deepEqual([0, .25, .5, .75, 1].map(p => sample(p, 0)), [6, 4, 2, 0, 6]);
  assert.equal(sample(-.25, 50), sample(.75, 50));
});

function projectContext() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../js/defaults.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(require.resolve('../js/core.js'), 'utf8'), context);
  const source = fs.readFileSync(require.resolve('../js/project.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function parseProject('), source.indexOf('function loadProject(')), context);
  return context;
}

test('symmetry defaults, saved JSON round trip, and legacy ramp migration', () => {
  const context = projectContext();
  assert.equal(context.createDefaultDocument().waveform.symmetryPercent, 50);
  assert.equal(context.normalizeDefaults({symmetryPercent: 75}).symmetryPercent, 75);
  assert.equal(context.normalizeDefaults({symmetryPercent: 200}).symmetryPercent, 100);
  assert.equal(context.normalizeDefaults({waveformType: 'ramp'}).waveformType, 'triangle');
  for (const symmetry of [0, 25, 50, 100]) {
    const doc = context.createDefaultDocument();
    doc.waveform.type = 'triangle';
    doc.waveform.symmetryPercent = symmetry;
    assert.equal(context.parseProject(JSON.parse(JSON.stringify(doc))).waveform.symmetryPercent, symmetry);
  }
  const doc = context.createDefaultDocument();
  delete doc.waveform.symmetryPercent;
  assert.equal(context.parseProject(doc).waveform.symmetryPercent, 50);
  doc.waveform.type = 'ramp';
  doc.AWG.sampleCount = doc.waveform.sampleCount = 3;
  doc.waveform.values = [-.5, 0, .5];
  const migrated = context.parseProject(doc).waveform;
  assert.equal(migrated.type, 'triangle');
  assert.equal(migrated.symmetryPercent, 100);
  assert.deepEqual(Array.from(migrated.values), doc.waveform.values);
});
