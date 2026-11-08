const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const read = name => fs.readFileSync(require.resolve(`../js/${name}.js`), 'utf8');
const slice = (name, from, to) => {
  const source = read(name);
  return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
};

function harness() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', listeners: {}, classList: { contains: () => true },
      addEventListener(name, handler) { this.listeners[name] = handler; },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element, activeElement: null },
    selectedAwgProfile: null, updateFunctionSelect() {},
    currentEditorSelection: () => null,
    applyFilters: values => values,
    draw() {}, renderSamples() {}, persistCurrentSettings() {},
    renderTiming() {}, renderTransitionTimes() {},
    refreshScopeTime() {}, refreshScopeVertical() {},
    ARBDRAW_FIELDS: { formatInputs() {} },
    amplitudeUnitScale: 1, frequencyUnitScale: 1, periodUnitScale: 1,
    voltageUnitScales: { highInput: 1, lowInput: 1, offsetInput: 1 },
    transitionTimeUnitScales: { riseTimeInput: 1, fallTimeInput: 1 },
    displayVoltageUnitFor: () => ({ scale: 1, label: 'V' }),
    displayUnitFor: () => ({ scale: 1, label: '' }),
    frequencyDisplayUnits: [], periodDisplayUnits: [],
  });
  for (const name of ['defaults', 'core', 'waveform-shapes']) vm.runInContext(read(name), context);
  const run = code => vm.runInContext(code, context);
  run(slice('waveform-editor', 'function normalizeEditorSelection(', 'function currentEditorSelection()')
    + slice('waveform-editor', 'function waveformGenerationRange(', 'function resizeCanvas(')
    + slice('properties', 'function displayAmplitude(', 'function renderTransitionTimes(')
    + slice('properties', 'function renderFrequency()', 'function commitTimingInput(')
    + slice('properties', 'function propertiesDiffer()', "document.querySelectorAll('[data-symmetry]')")
    + slice('properties', "$('frequencyInput').addEventListener('input'", "$('amplitudeInput').oninput"));
  run(`state.samples = 1000; state.cycles = 100; state.phase = 0;
    state.frequency = 1000; state.high = state.sourceHigh = 0.5;
    state.low = state.sourceLow = -0.5; state.duty = 50;
    state.riseTime = state.fallTime = 0; generate('sine');`);
  for (const [id, key] of Object.entries({ cyclesInput: 'cycles', phaseInput: 'phase',
    dutyInput: 'duty', symmetryInput: 'symmetry', rcTauInput: 'rcTau',
    riseTimeInput: 'riseTime', fallTimeInput: 'fallTime' })) element(id).value = run(`state.${key}`);
  context.renderFrequency();
  return { context, run, element, values: () => Array.from(run('state.data')) };
}

function assertRepeats(values, pointsPerCycle) {
  for (let i = pointsPerCycle; i < values.length; i++)
    assert.ok(Math.abs(values[i] - values[i % pointsPerCycle]) < 1e-12,
      `sample ${i} must repeat sample ${i % pointsPerCycle}`);
}

test('100 sine cycles in 1000 points repeat without the reported amplitude envelope', () => {
  const f = harness();
  const values = f.values();
  assertRepeats(values, 10);
  for (let i = 0; i < 10; i++)
    assert.ok(Math.abs(values[i] - 0.5 * Math.sin(2 * Math.PI * i / 10)) < 1e-12);
  assert.notEqual(values.at(-1), values[0]);
});

test('frequency and period edits preserve the 100-cycle samples and synchronize timing metadata', () => {
  const f = harness();
  const original = f.run('state.data');
  for (const [id, value, frequency] of [
    ['frequencyInput', 250, 250], ['periodInput', 0.002, 500],
    ['frequencyInput', 1000, 1000], ['periodInput', 0.0001, 10000],
  ]) {
    const input = f.element(id);
    input.value = value;
    input.listeners.input();
    assert.equal(f.context.applyProperties(), true);
    assert.equal(f.run('state.data'), original);
    assert.equal(f.run('state.samples'), 1000);
    assert.equal(f.run('state.cycles'), 100);
    assert.equal(f.run('state.frequency'), frequency);
    assert.equal(Number(f.element('frequencyInput').value), frequency);
    assert.equal(Number(f.element('periodInput').value), 1 / frequency);
    assert.equal(f.run('projectDocument.AWG.frequencyHz'), frequency / 100);
    assert.equal(f.run('projectDocument.AWG.periodSeconds'), 100 / frequency);
    assertRepeats(f.values(), 10);
  }
});

test('periodic sources have identical cycles, including square-wave boundary samples', () => {
  for (const type of ['sine', 'square', 'pulse', 'triangle', 'rc']) {
    const f = harness();
    for (const phase of [0, 90, -90]) {
      f.run(`state.phase = ${phase}; generate('${type}');`);
      assertRepeats(f.values(), 10);
    }
    if (type === 'square' || type === 'pulse') {
      f.run('state.phase = 0; generate();');
      assert.deepEqual(f.values().slice(0, 10), [0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5]);
    }
  }
});

test('nondivisible point counts preserve uniform phase spacing and the requested cycle count', () => {
  const f = harness();
  f.run('state.samples = 997; state.cycles = 37; state.phase = 23; generate();');
  f.values().forEach((value, i) => {
    const expected = 0.5 * Math.sin(2 * Math.PI * (i * 37 / 997 + 23 / 360));
    assert.ok(Math.abs(value - expected) < 1e-12);
  });
  assert.equal(f.values().length, 997);
});

test('saved sample values remain authoritative when an existing project is imported', () => {
  const f = harness();
  f.run(slice('project', 'function parseProject(', 'function loadProject('));
  // Old files retain their endpoint-inclusive samples until explicitly regenerated.
  f.run(`state.data = Array.from({ length: 1000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 100 * i / 999));`);
  const previous = f.values();
  f.run('projectDocument = parseProject(JSON.parse(JSON.stringify(projectDocument)));');
  assert.deepEqual(f.values(), previous);
});
