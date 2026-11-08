const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const slice = (file, from, to) => {
  const source = read(file);
  return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
};

function harness() {
  const elements = new Map();
  const createElement = () => ({ value: '', children: [], attributes: {},
    classList: { contains: () => true },
    setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute() {},
    replaceChildren() { this.children = []; }, addEventListener() {},
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
    focus() { context.document.activeElement = this; }, blur() { context.document.activeElement = null; },
    getContext: () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }),
  });
  const element = id => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const context = vm.createContext({ $: element, TextEncoder, editorMode: 'advanced', editorViewport: {},
    document: { activeElement: null, getElementById: element, createElement }, window: { confirm: () => true },
    finishWaveformPreview() {}, currentEditorSelection: () => null, clearEditorSelection() {},
    refreshScope() {}, renderVoltageLevels() {}, renderFrequency() {}, renderTiming() {},
    renderSamples() {}, persistCurrentSettings() {}, updateFunctionSelect() {}, showToast() {},
    applyFilters: values => values, awgProfileSelect: element('awgProfileSelect'),
    setEditorMode(mode) { context.editorMode = mode; },
    hasArbitraryEdits: () => false,
    draw() { context.syncSequence(); context.ARBDRAW_SIGNALS?.refresh(); },
    renderDocument() { context.syncSequence(); context.renderAwgTiming(); context.ARBDRAW_SIGNALS?.refresh(); },
    renderAwgTiming() {
      vm.runInContext(`{ const output = recordState(); Object.assign(projectDocument.AWG, {
        profileId: selectedAwgProfile.id, sampleCount: output.samples, sampleRateMSa: output.sampleRate }); }`, context);
    },
  });
  const run = code => vm.runInContext(code, context);
  for (const file of ['js/awg-profiles.js', 'js/defaults.js', 'js/math-expression.js', 'js/core.js', 'js/waveform-shapes.js']) run(read(file));
  run(`function profileById(id) { return Object.values(ARBDRAW_AWG_PROFILES).find(p => p.id === id); }
    var selectedAwgProfile = profileById('audio');`);
  run(slice('js/serial-properties.js', 'function serialSettings()', 'function renderSerialProperties('));
  run(slice('js/waveform-editor.js', 'function normalizeEditorSelection(', 'function currentEditorSelection()')
    + slice('js/waveform-editor.js', 'function waveformGenerationRange(', 'function resizeCanvas(')
    + slice('js/waveform-editor.js', 'function undoWaveform()', "$('undoBtn').textContent"));
  run(read('js/sequence.js'));
  run(slice('js/properties.js', 'function restoreAwgSettingsFromDocument(', 'renderAwgProfiles();'));
  run(slice('js/project.js', 'function parseProject(', 'const projectNameInput ='));
  run(slice('js/project.js', 'function exportWaveformData(', 'function downloadCsv('));
  run(read('js/signals.js'));
  run('state.samples = 16; state.frequency = 1000; generate("sine"); renderAwgTiming();');
  return { context, run, element };
}

test('four signals keep samples, settings, edits, undo and redo independent', () => {
  const { run } = harness();
  run('state.data[2] = 1.23; state.samplesEdited = true; pushHistory();');
  const original = run('JSON.stringify(projectDocument.waveform)');
  run('addSignal(); generate("square"); addSignal(); generate("triangle"); addSignal(); generate("dc");');
  assert.equal(run('projectDocument.signals.length'), 4);
  const fourth = run('JSON.stringify(projectDocument.waveform)');
  run('activateSignal("signal-1");');
  assert.equal(run('JSON.stringify(projectDocument.waveform)'), original);
  run('undoWaveform();');
  assert.notEqual(run('state.data[2]'), 1.23);
  run('activateSignal("signal-4");');
  assert.equal(run('JSON.stringify(projectDocument.waveform)'), fourth);
  run('activateSignal("signal-1"); redoWaveform();');
  assert.equal(run('state.data[2]'), 1.23);
  assert.equal(run('state.samples'), 16);
});

test('duplicate copies sequence data deeply and switching restores segment counts and selection', () => {
  const { run } = harness();
  run('addSequenceSegment("square"); state.data[0] = 2.22; state.samplesEdited = true; pushHistory();');
  const original = run('JSON.stringify(projectDocument.waveform)');
  run('addSignal(true);');
  assert.equal(run('JSON.stringify(projectDocument.waveform)'), original);
  run('selectSequenceSegment(1); state.data[0] = 3.33; state.samplesEdited = true; pushHistory();');
  run('activateSignal("signal-1");');
  assert.equal(run('state.activeSegment'), 1);
  assert.equal(run('state.samples'), 8);
  assert.equal(run('recordState().samples'), 16);
  assert.equal(run('JSON.stringify(projectDocument.waveform)'), original);
  run('activateSignal("signal-2");');
  assert.equal(run('state.data[0]'), 3.33);
});

test('version 2 round trips every signal, including sequences, and restores active aliases', () => {
  const { run } = harness();
  run('addSequenceSegment("square"); addSignal(); generate("triangle"); addSignal(); generate("dc"); renderAwgTiming();');
  const before = run('projectDocument.signals.map(signal => JSON.stringify(signal.waveform.values))');
  run('var saved = JSON.parse(JSON.stringify(projectDocument)); loadProject(saved);');
  assert.equal(run('projectDocument.signals.length'), 3);
  assert.equal(run('projectDocument.activeSignalId'), 'signal-3');
  assert.equal(run('state.type'), 'dc');
  assert.deepEqual(Array.from(run('projectDocument.signals.map(signal => JSON.stringify(signal.waveform.values))')), Array.from(before));
  assert.equal(run('Object.hasOwn(saved, "waveform")'), false);
  run('activateSignal("signal-1");');
  assert.equal(run('projectDocument.waveform.segments.length'), 2);
});

test('invalid inactive signals reject the whole import before replacing the current project', () => {
  const { run } = harness();
  run('addSignal(); var saved = JSON.parse(JSON.stringify(projectDocument));');
  const before = run('JSON.stringify(projectDocument)');
  for (const mutation of [
    'saved.signals = []',
    'saved.signals[0].id = saved.signals[1].id',
    'saved.signals[0].waveform.values[0] = null',
    'saved.signals[0].AWG.sampleCount = 1000001',
    'saved.signals[0].AWG.profileId = "unknown"',
    'delete saved.signals[0].AWG',
    'saved.signals[0].AWG.sampleCount = 3.5',
  ]) {
    run(`saved = JSON.parse(JSON.stringify(projectDocument)); ${mutation};`);
    assert.throws(() => run('loadProject(saved)'));
    assert.equal(run('JSON.stringify(projectDocument)'), before);
  }
});

test('legacy single-waveform import becomes one signal and clears other signal sessions', () => {
  const { run } = harness();
  run('var legacy = JSON.parse(JSON.stringify(selectedSignalDocument())); addSignal(); loadProject(legacy);');
  assert.equal(run('projectDocument.signals.length'), 1);
  assert.equal(run('state.type'), 'sine');
  assert.equal(run('state.samples'), 16);
  assert.equal(run('state.history.length'), 1);
});

test('export and bridge payload use exactly the selected signal or selected segment', () => {
  const { run } = harness();
  run('addSequenceSegment("square"); addSignal(); generate("triangle");');
  assert.equal(run('exportWaveformData().type'), 'triangle');
  run('var payload = JSON.parse(JSON.stringify(selectedSignalDocument()));');
  assert.equal(run('payload.version'), 1);
  assert.equal(run('Object.hasOwn(payload, "signals")'), false);
  assert.equal(run('payload.waveform.type'), 'triangle');
  run('activateSignal("signal-1");');
  assert.equal(run('exportWaveformData().data.length'), 16);
  assert.equal(run('exportWaveformData(1).data.length'), 8);
  assert.equal(run('selectedSignalDocument().waveform.values.length'), 16);
});

test('rename treats names as text, removal can be canceled, and the last signal remains', () => {
  const { run, context } = harness();
  run('renameSignal(" <b>clock</b> "); addSignal();');
  assert.equal(run('projectDocument.signals[0].name'), '<b>clock</b>');
  context.window.confirm = () => false;
  assert.equal(run('removeSignal()'), false);
  assert.equal(run('projectDocument.signals.length'), 2);
  context.window.confirm = () => true;
  assert.equal(run('removeSignal()'), true);
  assert.equal(run('activeSignal().name'), '<b>clock</b>');
  assert.equal(run('removeSignal()'), false);
});

test('signal controls display every named preview and keep exactly one signal selected', () => {
  const { run, element } = harness();
  element('addSignalBtn').onclick();
  element('addSignalBtn').onclick();
  element('duplicateSignalBtn').onclick();
  const list = element('signalList');
  assert.equal(list.children.length, 4);
  assert.equal(list.children.filter(button => button.attributes['aria-pressed'] === 'true').length, 1);
  assert.equal(list.children[3].children[0].textContent, 'Signal 3 copy');
  list.children[0].onclick();
  element('signalNameInput').onchange({ target: { value: 'Clock' } });
  assert.equal(list.children[0].children[0].textContent, 'Clock');
  assert.equal(list.children[0].attributes['aria-pressed'], 'true');
  assert.equal(run('activeSignal().name'), 'Clock');
  element('removeSignalBtn').onclick();
  assert.equal(list.children.length, 3);
  run('projectDocument = createDefaultDocument(); resetSignals(); generate();');
  assert.equal(element('signalList').children.length, 1);
  assert.equal(element('removeSignalBtn').disabled, true);
});
