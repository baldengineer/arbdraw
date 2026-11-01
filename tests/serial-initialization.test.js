const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const slice = (file, from, to) => {
  const source = read(file);
  return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
};

function harness(defaultType = 'sine') {
  const elements = new Map(), options = ['sine', 'serial'].map((wave) => ({
    dataset: { wave }, querySelector: () => ({}), setAttribute() {},
  }));
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: '', checked: false, hidden: false,
      classList: { contains: () => true, remove() {} },
      addEventListener() {}, setAttribute() {}, querySelectorAll: () => options,
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    TextEncoder, document: { getElementById: element, activeElement: null },
    window: { confirm: () => true },
    currentEditorSelection: () => null, clearEditorSelection() {},
    applyFilters: (values) => values,
    renderVoltageLevels() {}, renderAwgTiming() {}, renderTiming() {},
    renderFrequency() {}, renderSamples() {}, draw() {},
    persistCurrentSettings() {}, updateFunctionSelect() {}, drawMini() {},
    renderWaveformProperties() {}, refreshScopeTime() {},
    resetPropertyPanels() {}, restoreAwgSettingsFromDocument() {},
    setIncludeCsvTimestampsPreference() {}, defaultIncludeCsvTimestamps: true,
    showToast() {}, finishWaveformPreview() {}, refreshScope() {},
    setEditorMode() {}, editorViewport: {},
    selectedAwgProfile: { sampleDepth: { max: 100000 } },
    renderDocument() { context.renderSerialProperties(); },
  });
  vm.runInContext(read('js/defaults.js'), context);
  // A short non-serial source reproduces the idle-only waveform on selection.
  vm.runInContext(`ARBDRAW_DEFAULTS.waveformType = '${defaultType}';
    ARBDRAW_DEFAULTS.frequencyHz = 1000; ARBDRAW_DEFAULTS.frequencyUnit = 'kHz';`, context);
  for (const file of ['js/core.js', 'js/waveform-shapes.js', 'js/serial-properties.js'])
    vm.runInContext(read(file), context);
  vm.runInContext(
    slice('js/waveform-editor.js', 'function normalizeEditorSelection(', 'function currentEditorSelection()')
    + slice('js/waveform-editor.js', 'function waveformGenerationRange(', 'function resizeCanvas(')
    + slice('js/waveform-editor.js', 'function undoWaveform()', "$('undoBtn').textContent")
    + slice('js/waveform-editor.js', 'let functionSelectTrigger', 'function setEditorTool(')
    + slice('js/project.js', "$('confirmNewBtn').onclick", "$('newBtn').onclick"), context);
  const run = (code) => vm.runInContext(code, context);
  return { context, run, element, selectSerial: () => options[1].onclick() };
}

function assertCompletePayload(f) {
  assert.equal(f.run('state.type'), 'serial');
  assert.ok(f.run('1 / state.frequency >= serialBitPattern().length / serialSettings().baud'));
  assert.equal(f.run('state.data.includes(state.sourceHigh) && state.data.includes(state.sourceLow)'), true);
  assert.equal(f.element('serialPayload').value, 'Hello World');
  assert.equal(Number(f.element('serialBaud').value), 57600);
  assert.equal(f.element('serialWordSize').value, '8');
  assert.equal(f.element('serialBinaryPattern').value, f.run("serialBitPattern().join('')"));
}

test('File New followed by selecting Serial generates the complete default payload immediately', () => {
  const f = harness();
  f.element('confirmNewBtn').onclick();
  const before = f.run('JSON.stringify(projectDocument.waveform)');
  f.selectSerial();
  assertCompletePayload(f);
  const generated = f.run('JSON.stringify(state.data)');
  f.run('commitSerialProperties({ target: { id: "serialPayload" } });');
  assert.equal(f.run('JSON.stringify(state.data)'), generated);
  f.run('undoWaveform(); undoWaveform();');
  assert.equal(f.run('JSON.stringify(projectDocument.waveform)'), before);
  f.run('redoWaveform();');
  assertCompletePayload(f);
});

test('File New initializes timing when Serial is already the default waveshape', () => {
  const f = harness('serial');
  f.element('confirmNewBtn').onclick();
  assertCompletePayload(f);
  assert.equal(f.run('state.history.length'), 1);
});

test('canceling Serial selection preserves waveform, timing, and history', () => {
  const f = harness();
  f.element('confirmNewBtn').onclick();
  f.run('state.samplesEdited = true; pushHistory();');
  const before = f.run('JSON.stringify({ projectDocument, history: state.history })');
  f.context.window.confirm = () => false;
  f.selectSerial();
  assert.equal(f.run('JSON.stringify({ projectDocument, history: state.history })'), before);
});

test('regenerating an initialized Serial waveform preserves deliberately adjusted timing', () => {
  const f = harness('serial');
  f.element('confirmNewBtn').onclick();
  f.run('state.frequency = 100; generate();');
  assert.equal(f.run('state.frequency'), 100);
});

test('serial generation preserves the shared sequence clock and allocated segment counts', () => {
  const f = harness();
  f.element('confirmNewBtn').onclick();
  vm.runInContext(read('js/sequence.js'), f.context);
  f.context.addSequenceSegment('serial');
  assert.deepEqual(Array.from(f.run('sequenceSegments().map(segment => segment.sampleCount)')), [500, 500]);
  assert.equal(f.run('projectDocument.waveform.sampleRateMSa'), 1000);
  const source = f.run('JSON.stringify(sequenceSegments()[0])');
  f.context.generate('serial');
  assert.equal(f.run('JSON.stringify(sequenceSegments()[0])'), source);
  assert.equal(f.run('state.samples'), 500);
  assert.equal(f.run('state.frequency'), 2000000);
});
