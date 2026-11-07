const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const read = file => fs.readFileSync(require.resolve(`../js/${file}.js`), 'utf8');
const slice = (file, from, to) => {
  const source = read(file);
  return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
};

function harness(type = 'sine', constraints = {}) {
  const elements = new Map();
  const document = {
    activeElement: null,
    addEventListener() {},
    getElementById: id => element(id),
    querySelectorAll: () => [element('offsetInput')],
  };
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map(), attributes = {};
      let value = '';
      elements.set(id, {
        id, type: 'number', dataset: {}, min: '', max: '', ownerDocument: document,
        get value() { return value; },
        set value(next) { value = String(next); },
        closest: () => null,
        classList: { toggle() {}, contains: () => true },
        getAttribute: name => attributes[name],
        setAttribute(name, next) { attributes[name] = next; },
        addEventListener(name, handler) {
          if (!listeners.has(name)) listeners.set(name, []);
          listeners.get(name).push(handler);
        },
        dispatch(name, key) {
          const event = { target: this, key, preventDefault() {} };
          this[`on${name}`]?.(event);
          for (const handler of listeners.get(name) || []) handler(event);
        },
        blur() { document.activeElement = null; this.dispatch('blur'); },
      });
    }
    return elements.get(id);
  }
  let saves = 0;
  const context = vm.createContext({
    document, $: element, currentEditorSelection: () => null,
    applyFilters: values => values,
    renderFrequency() {}, renderTiming() {}, renderAwgTiming() {}, renderTransitionTimes() {},
    draw() {}, renderSamples() {}, refreshScopeTime() {}, refreshScopeVertical() {},
    persistCurrentSettings() { saves++; },
    inputFrequency: () => +element('frequencyInput').value,
    inputTransitionTime: id => +element(id).value,
    amplitudeUnitScale: 1,
    voltageUnitScales: { highInput: 1, lowInput: 1, offsetInput: 1 },
    renderDocument() { context.renderVoltageLevels(); },
  });
  for (const file of ['defaults', 'core', 'fields', 'field-definitions'])
    vm.runInContext(read(file), context);
  const run = code => vm.runInContext(code, context);
  run(slice('properties', 'function displayAmplitude(', 'function displayFrequency(')
    + slice('properties', 'function renderVoltageLevels(', 'function commitTimingInput(')
    + slice('properties', 'function propertiesDiffer()', "document.querySelectorAll('[data-symmetry]')")
    + slice('waveform-editor', 'function normalizeEditorSelection(', 'function currentEditorSelection()')
    + slice('waveform-editor', 'function waveformGenerationRange(', 'function resizeCanvas('));
  run(`state.samples = 5; state.cycles = 1; state.phase = 0;
    state.high = state.sourceHigh = 2; state.low = state.sourceLow = 0;
    generate('${type}', false, false);`);
  for (const [id, key] of Object.entries({ cyclesInput: 'cycles', frequencyInput: 'frequency',
    phaseInput: 'phase', dutyInput: 'duty', symmetryInput: 'symmetry', rcTauInput: 'rcTau',
    riseTimeInput: 'riseTime', fallTimeInput: 'fallTime' })) element(id).value = run(`state.${key}`);
  context.offsetConstraints = constraints;
  run('ARBDRAW_FIELD_DEFINITIONS.inspector.offsetInput.constraints = offsetConstraints;');
  run(slice('properties', "$('offsetInput').oninput", 'const propertyDefaultMap'));
  const input = element('offsetInput');
  document.activeElement = input;
  return { input, element, run, saves: () => saves,
    type(value) { input.value = value; input.dispatch('input'); } };
}

for (const waveform of ['sine', 'dc']) {
  for (const [drafts, expected] of [
    [['02', '0.2', '0.25'], 0.25],
    [['0', '0.', '0.5'], 0.5],
    [['-', '-0', '-0.', '-0.2', '-0.25'], -0.25],
  ]) {
    for (const commit of ['blur', 'Enter']) {
      test(`${waveform} offset preserves decimal drafts and commits ${expected} on ${commit}`, () => {
        const fixture = harness(waveform);
        for (const draft of drafts) {
          fixture.type(draft);
          assert.equal(fixture.input.value, draft);
          assert.equal(fixture.run('state.history.length'), 0);
          assert.equal(fixture.saves(), 0);
        }
        if (commit === 'blur') fixture.input.blur();
        else fixture.input.dispatch('keydown', 'Enter');
        assert.equal(fixture.run('(state.high + state.low) / 2'), expected);
        assert.equal(fixture.input.value, String(expected));
        assert.equal(fixture.run('state.history.length'), 1);
        assert.equal(fixture.saves(), 1);
        assert.equal(fixture.run('state.data[0]'), expected);
      });
    }
  }
}

test('incomplete or invalid offset drafts leave linked levels and waveform unchanged', () => {
  for (const draft of ['', '-', '.', '-.', 'not a number', 'Infinity']) {
    const fixture = harness();
    const before = fixture.run('JSON.stringify(projectDocument.waveform)');
    fixture.type(draft);
    assert.equal(fixture.element('highInput').value, '2');
    assert.equal(fixture.element('lowInput').value, '0');
    fixture.input.blur();
    assert.equal(fixture.input.getAttribute('aria-invalid'), 'true');
    assert.equal(fixture.run('JSON.stringify(projectDocument.waveform)'), before);
    assert.equal(fixture.saves(), 0);
  }
});

test('offset commit still enforces configured bounds', () => {
  const fixture = harness('sine', { min: -1, max: 1 });
  for (const draft of ['-2', '2']) {
    fixture.type(draft);
    fixture.input.blur();
    assert.equal(fixture.input.getAttribute('aria-invalid'), 'true');
    assert.equal(fixture.run('(state.high + state.low) / 2'), 1);
    assert.equal(fixture.saves(), 0);
  }
});

test('Escape restores the offset and waveform before the preview', () => {
  const fixture = harness();
  const before = fixture.run('JSON.stringify(projectDocument.waveform)');
  fixture.type('0.25');
  fixture.input.dispatch('keydown', 'Escape');
  assert.equal(fixture.input.value, '1');
  assert.equal(fixture.run('JSON.stringify(projectDocument.waveform)'), before);
  assert.equal(fixture.run('state.history.length'), 0);
  assert.equal(fixture.saves(), 0);
});
