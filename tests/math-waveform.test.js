const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync(require.resolve(`../js/${name}.js`), 'utf8');
const slice = (name, from, to) => {
  const source = read(name);
  return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
};

function harness() {
  const elements = new Map(), messages = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, listeners: {}, attributes: {},
      classList: { contains: () => true }, add() {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
      setAttribute(name, value) { this.attributes[name] = value; },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element, activeElement: null },
    window: { confirm: () => true }, Option: function() {},
    selectedAwgProfile: { sampleDepth: { max: 100000 } },
    currentEditorSelection: () => null, clearEditorSelection() {},
    draw() {}, renderSamples() {}, persistCurrentSettings() {},
    renderTiming() {}, renderTransitionTimes() {}, renderAwgTiming() {},
    refreshScopeTime() {}, refreshScopeVertical() {}, refreshScope() {},
    finishWaveformPreview() {}, setEditorMode() {}, updateFunctionSelect() {}, editorViewport: {},
    showToast(message) { messages.push(message); },
    renderDocument() { context.syncSequence(); context.ARBDRAW_MATH_PROPERTIES?.render(); },
    renderWaveformProperties(type) { context.ARBDRAW_MATH_PROPERTIES?.render(type); },
    ARBDRAW_FIELDS: { formatInputs() {} },
    amplitudeUnitScale: 1, frequencyUnitScale: 1, periodUnitScale: 1,
    voltageUnitScales: { highInput: 1, lowInput: 1, offsetInput: 1 },
    transitionTimeUnitScales: { riseTimeInput: 1, fallTimeInput: 1 },
    displayVoltageUnitFor: () => ({ scale: 1, label: 'V' }),
    displayUnitFor: () => ({ scale: 1, label: '' }),
    frequencyDisplayUnits: [], periodDisplayUnits: [], sampleCountUnitScale: 1,
    sampleRateUnitScale: 1, tsResolutionUnitScale: 1,
  });
  const run = code => vm.runInContext(code, context);
  for (const name of ['defaults', 'math-expression', 'core', 'waveform-shapes']) run(read(name));
  run(slice('waveform-editor', 'function normalizeEditorSelection(', 'function currentEditorSelection()')
    + slice('waveform-editor', 'function waveformGenerationRange(', 'function resizeCanvas(')
    + slice('waveform-editor', 'function undoWaveform()', "$('undoBtn').textContent")
    + slice('filters', 'function applyNoiseFilter(', 'const filterControls =')
    + slice('properties', 'function displayAmplitude(', 'function renderTransitionTimes(')
    + slice('properties', 'function renderFrequency()', 'const timingFieldControllers =')
    + slice('properties', 'function propertiesDiffer()', "document.querySelectorAll('[data-symmetry]')")
    + slice('project', 'function parseProject(', 'function loadProject('));
  run(read('sequence'));
  run(read('math-properties'));
  run(`state.samples = 8; state.cycles = 1; state.phase = 0; state.frequency = 1000;
    state.high = state.sourceHigh = 3; state.low = state.sourceLow = -1; generate('math');`);
  const renderInputs = () => {
    for (const [id, key] of Object.entries({ cyclesInput: 'cycles', phaseInput: 'phase',
      dutyInput: 'duty', symmetryInput: 'symmetry', rcTauInput: 'rcTau',
      riseTimeInput: 'riseTime', fallTimeInput: 'fallTime' })) element(id).value = run(`state.${key}`);
    context.renderVoltageLevels(); context.renderFrequency();
  };
  renderInputs();
  return { context, run, element, messages, renderInputs };
}

test('Math generation scales voltage, applies filters, and preserves a scoped selection', () => {
  const f = harness();
  assert.equal(f.run('state.data[2]'), 3);
  assert.equal(f.run('state.data[6]'), -1);
  f.run(`state.filters.clampEnabled = true; state.filters.clampMinV = 0;
    state.filters.clampMaxV = 2; generate();`);
  assert.equal(f.run('state.data[2]'), 2);
  assert.equal(f.run('state.data[6]'), 0);
  const before = f.run('JSON.stringify(state.data)');
  f.context.currentEditorSelection = () => ({ left: 2, right: 4 });
  f.element('mathExpressionInput').value = '-1';
  assert.equal(f.context.ARBDRAW_MATH_PROPERTIES.apply(), true);
  assert.deepEqual(Array.from(f.run('state.data')), JSON.parse(before).map((v, i) => i >= 2 && i <= 4 ? 0 : v));
  assert.equal(f.run('state.samplesEdited'), true);
});

test('expression drafts and invalid or canceled Apply leave samples and history unchanged', () => {
  const f = harness(), before = f.run('JSON.stringify({ projectDocument, history: state.history, redo: state.redo })');
  f.element('mathPreset').value = 'exp(-4*x)*sin(8*pi*x)';
  f.element('mathPreset').listeners.change();
  assert.equal(f.element('mathExpressionInput').value, 'exp(-4*x)*sin(8*pi*x)');
  assert.equal(f.run('JSON.stringify({ projectDocument, history: state.history, redo: state.redo })'), before);
  for (const expression of ['x.constructor', 'sin(', '1/(x-0.5)']) {
    f.element('mathExpressionInput').value = expression;
    assert.equal(f.context.ARBDRAW_MATH_PROPERTIES.apply(), false);
    assert.ok(f.element('mathExpressionError').textContent);
    assert.equal(f.run('JSON.stringify({ projectDocument, history: state.history, redo: state.redo })'), before);
  }
  f.run('state.samplesEdited = true;');
  f.context.window.confirm = () => false;
  f.element('mathExpressionInput').value = 'x';
  assert.equal(f.context.ARBDRAW_MATH_PROPERTIES.apply(), false);
  assert.equal(f.run('state.mathExpression'), 'sin(2*pi*x)');
});

test('Apply is undoable and project JSON restores expressions and authoritative sample edits', () => {
  const f = harness();
  f.element('mathExpressionInput').value = '1-8*(x-0.5)^2';
  f.context.ARBDRAW_MATH_PROPERTIES.apply();
  const applied = f.run('JSON.stringify(projectDocument.waveform)');
  f.run('undoWaveform();');
  assert.equal(f.run('state.mathExpression'), 'sin(2*pi*x)');
  assert.equal(f.element('mathExpressionInput').value, 'sin(2*pi*x)');
  f.run('redoWaveform();');
  assert.equal(f.run('JSON.stringify(projectDocument.waveform)'), applied);
  f.run(`state.data[3] = 0.12345; state.samplesEdited = true;
    projectDocument.AWG.sampleCount = state.samples;
    projectDocument = parseProject(JSON.parse(JSON.stringify(projectDocument)));`);
  assert.equal(f.run('state.type'), 'math');
  assert.equal(f.run('state.mathExpression'), '1-8*(x-0.5)^2');
  assert.equal(f.run('state.data[3]'), 0.12345);
  assert.equal(f.run('state.samplesEdited'), true);
  assert.throws(() => f.run(`const bad = JSON.parse(JSON.stringify(projectDocument));
    bad.waveform.mathExpression = 'alert(1)'; parseProject(bad);`), /Unknown/);
});

test('sample-count and phase changes that introduce singularities are rejected before mutation', () => {
  const f = harness();
  f.run(`state.samples = 5; state.mathExpression = '1/(x-0.5)'; generate();`);
  f.renderInputs();
  const before = f.run('JSON.stringify({ projectDocument, history: state.history })');
  f.element('samplesEdit').value = '6';
  f.context.commitTimingInput('samples');
  assert.equal(f.run('JSON.stringify({ projectDocument, history: state.history })'), before);
  f.element('phaseInput').value = '180';
  assert.equal(f.context.applyProperties(), false);
  assert.equal(f.run('JSON.stringify({ projectDocument, history: state.history })'), before);
  assert.equal(f.messages.length, 2);
});

test('segments retain independent expressions, and invalid redistribution leaves the sequence intact', () => {
  const f = harness();
  f.context.addSequenceSegment('math');
  f.element('mathExpressionInput').value = '2*x-1';
  f.context.ARBDRAW_MATH_PROPERTIES.apply();
  assert.deepEqual(Array.from(f.run('sequenceSegments().map(s => s.mathExpression)')), ['sin(2*pi*x)', '2*x-1']);
  f.run('syncSequence(); projectDocument.AWG.sampleCount = recordState().samples;');
  assert.deepEqual(Array.from(f.run('parseProject(JSON.parse(JSON.stringify(projectDocument))).waveform.segments.map(s => s.mathExpression)')),
    ['sin(2*pi*x)', '2*x-1']);
  const g = harness();
  g.run(`state.samples = 10; state.mathExpression = '1/(x-1/3)'; generate();`);
  g.context.addSequenceSegment('math'); // 5 + 5 is valid.
  const before = g.run('JSON.stringify({ projectDocument, history: state.history, active: state.activeSegment })');
  g.context.addSequenceSegment('sine'); // 4 + 3 + 3 hits x = 1/3.
  assert.equal(g.run('JSON.stringify({ projectDocument, history: state.history, active: state.activeSegment })'), before);
  assert.match(g.messages.at(-1), /not finite/);
});

test('a dormant expression invalid at the new timing can be corrected without losing the existing source', () => {
  const f = harness();
  f.run(`generate('sine'); state.mathExpression = '1/(x-0.5)';`);
  const values = f.run('JSON.stringify(state.data)');
  assert.equal(f.context.generate('math'), false);
  assert.equal(f.run('state.type'), 'sine');
  assert.equal(f.run('JSON.stringify(state.data)'), values);
  f.context.ARBDRAW_MATH_PROPERTIES.edit();
  f.element('mathExpressionInput').value = '2*x-1';
  assert.equal(f.context.ARBDRAW_MATH_PROPERTIES.apply(), true);
  assert.equal(f.run('state.type'), 'math');
  assert.equal(f.run('state.data[0]'), -1);
});

test('invalid stored Math settings fall back to a usable default at startup', () => {
  for (const mathExpression of ['alert(1)', '1/(x-0.5)']) {
    const context = vm.createContext({
      localStorage: { getItem: () => JSON.stringify({ settingsVersion: 1,
        waveformType: 'math', mathExpression, sampleCount: 8, sampleCountUnit: 'pts' }) },
    });
    for (const name of ['defaults', 'math-expression', 'core']) vm.runInContext(read(name), context);
    assert.equal(vm.runInContext('state.mathExpression', context), 'sin(2*pi*x)');
    assert.equal(vm.runInContext('ARBDRAW_MATH.samples(projectDocument.waveform).length', context), 8);
  }
});

test('switching to Basic rejects a source that cannot regenerate the full edited record', () => {
  const f = harness();
  f.run(`state.mathExpression = '1/(x-0.5)'; state.samplesEdited = true;`);
  const before = f.run('JSON.stringify({ projectDocument, history: state.history, redo: state.redo })');
  f.element('basicModeConfirmDialog').close = () => {};
  f.run(slice('editor-modes', 'function convertToBasic()', 'globalThis.ARBDRAW_EDITOR_MODES ='));
  f.context.convertToBasic();
  assert.equal(f.run('JSON.stringify({ projectDocument, history: state.history, redo: state.redo })'), before);
  assert.match(f.messages.at(-1), /not finite/);
});
