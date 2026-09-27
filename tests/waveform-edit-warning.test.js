const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'waveform-editor.js'),
  'utf8',
);
const helpers = source.slice(
  source.indexOf('function normalizeEditorSelection('),
  source.indexOf('function currentEditorSelection()'),
) + source.slice(
  source.indexOf('function waveformGenerationRange('),
  source.indexOf('function generate('),
);

function warningContext({ edited, selection = null, confirmResult = true }) {
  let confirmationCount = 0;
  const context = {
    state: { samplesEdited: edited, samples: 8, data: Array(8).fill(0) },
    currentEditorSelection: () => selection,
    window: {
      confirm() {
        confirmationCount += 1;
        return confirmResult;
      },
    },
  };
  vm.runInNewContext(helpers, context);
  return { context, confirmationCount: () => confirmationCount };
}

test('generated waveform changes do not display a replacement warning', () => {
  const fixture = warningContext({ edited: false });
  assert.equal(fixture.context.waveformReplacementNeedsConfirmation(), false);
  assert.equal(fixture.context.confirmWaveformReplacement(), true);
  assert.equal(fixture.confirmationCount(), 0);
});

test('full-record regeneration warns when samples have been edited', () => {
  const fixture = warningContext({ edited: true, confirmResult: false });
  assert.equal(fixture.context.waveformReplacementNeedsConfirmation(), true);
  assert.equal(fixture.context.confirmWaveformReplacement(), false);
  assert.equal(fixture.confirmationCount(), 1);
});

test('selection-scoped regeneration does not warn or clear the edited state', () => {
  const fixture = warningContext({ edited: true, selection: { left: 2, right: 5 } });
  assert.equal(fixture.context.waveformReplacementNeedsConfirmation(), false);
  assert.equal(fixture.context.confirmWaveformReplacement(), true);
  assert.equal(fixture.confirmationCount(), 0);
});

test('direct and sample-table edits mark the waveform as edited', () => {
  const views = fs.readFileSync(path.join(__dirname, '..', 'js', 'views.js'), 'utf8');
  assert.match(source, /function editAt[\s\S]*state\.samplesEdited = true;/);
  assert.match(views, /function updateSampleVoltage[\s\S]*state\.samplesEdited = true;/);
});

test('destructive property and record-level changes use the replacement guard', () => {
  const properties = fs.readFileSync(path.join(__dirname, '..', 'js', 'properties.js'), 'utf8');
  const filters = fs.readFileSync(path.join(__dirname, '..', 'js', 'filters.js'), 'utf8');
  const serial = fs.readFileSync(path.join(__dirname, '..', 'js', 'serial-properties.js'), 'utf8');

  assert.match(properties, /waveformChanged && waveformReplacementNeedsConfirmation\(\)/);
  assert.match(properties, /function applyAwgProfile[\s\S]*confirmWaveformReplacement\(false\)/);
  assert.match(properties, /function commitTimingInput[\s\S]*waveformReplacementNeedsConfirmation\(false\)/);
  assert.match(filters, /function regenerateWithFilters[\s\S]*confirmWaveformReplacement\(false\)/);
  assert.match(serial, /function commitSerialProperties[\s\S]*waveformReplacementNeedsConfirmation\(\)/);
});
