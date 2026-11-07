const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness(realWaveform = false) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      const attributes = new Map();
      elements.set(id, {
        value: '', checked: false, disabled: false,
        addEventListener(name, callback) { listeners.set(name, callback); },
        dispatch(name, event = {}) { listeners.get(name)?.(event); },
        setCustomValidity(message) { this.validationMessage = message; },
        setAttribute(name, value) { attributes.set(name, value); },
        removeAttribute(name) { attributes.delete(name); },
        getAttribute(name) { return attributes.get(name); },
        reportValidity() { this.reportedValidity = true; },
        blur() {},
      });
    }
    return elements.get(id);
  }
  const state = {
    type: 'sine', high: 5, low: -5, sampleRate: 1,
    filters: {
      enabled: true, noiseEnabled: false, noisePercent: 1,
      smoothingEnabled: false, smoothingWindowPoints: 5,
    },
  };
  const calls = { generate: 0, persist: 0, confirm: true };
  const context = vm.createContext({
    $: element, state, DEFAULT_VALUES: { noisePercent: 1, noisePercentMax: 10 },
    ARBDRAW_WAVEFORM_SHAPES: { smoothSamples: (values) => values },
    confirmWaveformReplacement() { return calls.confirm; },
    generate() { calls.generate++; },
    refreshScopeVertical() {},
    persistCurrentSettings() { calls.persist++; },
  });
  if (realWaveform) {
    delete context.state;
    delete context.DEFAULT_VALUES;
    context.document = { getElementById: element };
    for (const file of ['defaults', 'core', 'waveform-shapes'])
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${file}.js`), 'utf8'), context);
  }
  const source = fs.readFileSync(path.join(__dirname, '../js/filters.js'), 'utf8');
  vm.runInContext(source, context);
  return { calls, context, element, state };
}

test('checkboxes enable their value inputs and regenerate once per change', () => {
  const { calls, element, state } = createHarness();
  const noise = element('noiseFilterEnabled');
  const noiseInput = element('noiseFilterInput');
  assert.equal(noiseInput.disabled, true);
  noise.checked = true;
  noise.dispatch('change');
  assert.equal(state.filters.noiseEnabled, true);
  assert.equal(noiseInput.disabled, false);
  assert.equal(calls.generate, 1);

  noiseInput.value = '2.5';
  noiseInput.dispatch('change');
  assert.equal(state.filters.noisePercent, 2.5);
  assert.equal(calls.generate, 2);
  assert.equal(calls.persist, 2);

  noise.checked = false;
  noise.dispatch('change');
  assert.equal(state.filters.noiseEnabled, false);
  assert.equal(noiseInput.disabled, true);
});

test('smoothing accepts odd window sizes and rejects even ones', () => {
  const { element, state } = createHarness();
  element('smoothingFilterEnabled').checked = true;
  element('smoothingFilterEnabled').dispatch('change');
  const window = element('smoothingFilterInput');
  window.value = '7';
  window.dispatch('change');
  assert.equal(state.filters.smoothingWindowPoints, 7);
  window.value = '8';
  window.dispatch('change');
  assert.equal(state.filters.smoothingWindowPoints, 7);
  assert.equal(window.getAttribute('aria-invalid'), 'true');
});

test('declining replacement restores filter controls without changing settings', () => {
  const { calls, element, state } = createHarness();
  calls.confirm = false;
  const noise = element('noiseFilterEnabled');
  noise.checked = true;
  noise.dispatch('change');
  assert.equal(state.filters.noiseEnabled, false);
  assert.equal(noise.checked, false);
  assert.equal(element('noiseFilterInput').disabled, true);
  assert.equal(calls.generate, 0);
});

test('noise magnitude uses source levels instead of expanded final levels', () => {
  const { context, state } = createHarness();
  state.sourceHigh = 5;
  state.sourceLow = -5;
  state.high = 6;
  state.low = -6;
  const originalRandom = context.Math?.random;
  vm.runInContext('Math.random = () => 1', context);
  const filtered = context.applyNoiseFilter([0], 10);
  assert.deepEqual(Array.from(filtered), [1]);
  if (originalRandom) context.Math.random = originalRandom;
});

test('smoothing preserves noisy input extrema instead of clipping to source levels', () => {
  const { context, state } = createHarness();
  state.sourceHigh = 5;
  state.sourceLow = -5;
  state.high = 6;
  state.low = -6;
  let limits;
  context.ARBDRAW_WAVEFORM_SHAPES.smoothSamples = (values, options) => {
    limits = options;
    return values;
  };
  context.applySmoothingFilter([-6, 0, 6], 3);
  assert.equal(limits.low, -6);
  assert.equal(limits.high, 6);
});

test('clamp runs last, preserves samples inside the limits, and respects disabled filters', () => {
  const { context, state } = createHarness();
  Object.assign(state.filters, { clampEnabled: true, clampMinV: -1, clampMaxV: 2 });
  const original = [-5, -1, 0, 0.5, 2, 5];
  assert.deepEqual(Array.from(context.applyFilters(original)), [-1, -1, 0, 0.5, 2, 2]);
  assert.deepEqual(original, [-5, -1, 0, 0.5, 2, 5]);
  state.filters.enabled = false;
  assert.equal(context.applyFilters(original), original);
  Object.assign(state.filters, { enabled: true, clampEnabled: false });
  assert.equal(context.applyFilters(original), original);
  Object.assign(state.filters, { clampEnabled: true, noiseEnabled: true, noisePercent: 10,
    smoothingEnabled: true });
  vm.runInContext('Math.random = () => 1', context);
  context.ARBDRAW_WAVEFORM_SHAPES.smoothSamples = values => {
    assert.deepEqual(Array.from(values), [-4, 0, 1, 1.5, 3, 6]);
    return values;
  };
  assert.deepEqual(Array.from(context.applyFilters(original)), [-1, 0, 1, 1.5, 2, 2]);
  Object.assign(state.filters, { noiseEnabled: false, smoothingEnabled: false, clampMinV: 0, clampMaxV: 0 });
  assert.deepEqual(Array.from(context.applyFilters(original)), [0, 0, 0, 0, 0, 0]);
});

test('clamp controls accept negative, zero and equal bounds, and retain limits when disabled', () => {
  const { calls, element, state } = createHarness();
  const enabled = element('clampFilterEnabled'), min = element('clampMinInput'), max = element('clampMaxInput');
  assert.equal(min.disabled, true);
  assert.equal(max.disabled, true);
  enabled.checked = true;
  enabled.dispatch('change');
  assert.equal(min.disabled, false);
  assert.equal(max.disabled, false);
  assert.equal(state.filters.clampMinV, -1);
  assert.equal(state.filters.clampMaxV, 1);
  min.value = '-0.25';
  min.dispatch('change');
  max.value = '0';
  max.dispatch('change');
  assert.equal(state.filters.clampMinV, -0.25);
  assert.equal(state.filters.clampMaxV, 0);
  min.value = '0';
  min.dispatch('change');
  assert.equal(state.filters.clampMinV, 0);
  assert.equal(calls.generate, 4);
  min.dispatch('change');
  assert.equal(calls.generate, 4);
  enabled.checked = false;
  enabled.dispatch('change');
  assert.equal(min.disabled, true);
  assert.equal(max.disabled, true);
  assert.equal(state.filters.clampMinV, 0);
  assert.equal(state.filters.clampMaxV, 0);
});

test('clamp rejects invalid and reversed bounds without changing the waveform', () => {
  for (const [id, draft] of [['clampMinInput', ''], ['clampMinInput', '-'],
    ['clampMaxInput', 'Infinity'], ['clampMinInput', '2'], ['clampMaxInput', '-2']]) {
    const { calls, element, state } = createHarness();
    element('clampFilterEnabled').checked = true;
    element('clampFilterEnabled').dispatch('change');
    const before = JSON.stringify(state.filters);
    const input = element(id);
    input.value = draft;
    input.dispatch('change');
    assert.equal(JSON.stringify(state.filters), before);
    assert.equal(calls.generate, 1);
    assert.ok(element('clampMinInput').reportedValidity || element('clampMaxInput').reportedValidity);
    input.dispatch('keydown', { key: 'Escape', preventDefault() {} });
    assert.equal(Number(element('clampMinInput').value), -1);
    assert.equal(Number(element('clampMaxInput').value), 1);
  }
});

test('declining clamp replacement restores its checkbox and limits', () => {
  const { calls, element, state } = createHarness();
  calls.confirm = false;
  element('clampFilterEnabled').checked = true;
  element('clampFilterEnabled').dispatch('change');
  assert.notEqual(state.filters.clampEnabled, true);
  assert.equal(element('clampFilterEnabled').checked, false);
  assert.equal(element('clampMinInput').disabled, true);
  assert.equal(calls.generate, 0);
});

function waveformHarness() {
  const fixture = createHarness(true), { context, element } = fixture;
  const read = file => fs.readFileSync(path.join(__dirname, '..', 'js', `${file}.js`), 'utf8');
  const slice = (file, from, to) => {
    const source = read(file);
    return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
  };
  Object.assign(context, {
    document: { getElementById: element }, currentEditorSelection: () => null,
    draw() {}, renderSamples() {}, renderVoltageLevels() {}, renderAwgTiming() {},
    renderFrequency() {}, renderTiming() {}, updateFunctionSelect() {},
    renderDocument() { context.renderFilterControls(); },
    window: { confirm: () => true },
  });
  element('samplesView').classList = { contains: () => true };
  const run = code => vm.runInContext(code, context);
  run(slice('waveform-editor', 'function normalizeEditorSelection(', 'function currentEditorSelection()')
    + slice('waveform-editor', 'function waveformGenerationRange(', 'function resizeCanvas(')
    + slice('waveform-editor', 'function undoWaveform()', "$('undoBtn').textContent")
    + slice('project', 'function parseProject(', 'function loadProject('));
  run('state.samples = 5; state.cycles = 1; state.phase = 0; state.high = state.sourceHigh = 5;'
    + 'state.low = state.sourceLow = -5; generate("sine"); renderFilterControls();');
  return { ...fixture, read, run };
}

test('clamp regeneration preserves source levels, undo/redo, and JSON round trips', () => {
  const { element, run } = waveformHarness();
  const original = run('JSON.stringify(state.data)');
  element('clampFilterEnabled').checked = true;
  element('clampFilterEnabled').dispatch('change');
  const clipped = run('JSON.stringify(state.data)');
  assert.notEqual(clipped, original);
  assert.equal(run('state.high'), 1);
  assert.equal(run('state.low'), -1);
  assert.equal(run('state.sourceHigh'), 5);
  assert.equal(run('state.sourceLow'), -5);
  assert.equal(run('state.history.length'), 2);
  run('undoWaveform();');
  assert.equal(run('JSON.stringify(state.data)'), original);
  assert.equal(element('clampFilterEnabled').checked, false);
  run('redoWaveform();');
  assert.equal(run('JSON.stringify(state.data)'), clipped);
  assert.equal(element('clampFilterEnabled').checked, true);
  run('projectDocument.AWG.sampleCount = state.samples; projectDocument = parseProject(JSON.parse(JSON.stringify(projectDocument)));');
  assert.equal(run('state.filters.clampEnabled'), true);
  assert.equal(run('state.filters.clampMinV'), -1);
  assert.equal(run('state.filters.clampMaxV'), 1);
  assert.equal(run('state.high'), 1);
  assert.equal(run('state.low'), -1);
  run('generate("sine", false, false);');
  assert.equal(run('JSON.stringify(state.data)'), clipped);
  element('clampFilterEnabled').checked = false;
  element('clampFilterEnabled').dispatch('change');
  assert.equal(run('JSON.stringify(state.data)'), original);
});

test('older projects default clamp off and imported clamp bounds are finite and ordered', () => {
  const { run } = waveformHarness();
  run('delete projectDocument.waveform.filters.clampEnabled;'
    + 'delete projectDocument.waveform.filters.clampMinV; delete projectDocument.waveform.filters.clampMaxV;'
    + 'projectDocument = parseProject(JSON.parse(JSON.stringify(projectDocument)));');
  assert.equal(run('state.filters.clampEnabled'), false);
  assert.equal(run('state.filters.clampMinV'), -1);
  assert.equal(run('state.filters.clampMaxV'), 1);
  assert.equal(run('normalizeFilterSettings({ clampMinV: 4, clampMaxV: -2 }).clampMinV'), -2);
  assert.equal(run('normalizeFilterSettings({ clampMinV: 4, clampMaxV: -2 }).clampMaxV'), 4);
  assert.equal(run('normalizeFilterSettings({ clampMinV: null, clampMaxV: Infinity }).clampMinV'), -1);
  assert.equal(run('normalizeFilterSettings({ clampMinV: null, clampMaxV: Infinity }).clampMaxV'), 1);
});

test('clamp affects only the selected sequence segment and survives sequence import', () => {
  const { context, element, read, run } = waveformHarness();
  run(read('sequence'));
  run('projectDocument.waveform.segments = [cloneWaveform(), cloneWaveform()]; state.activeSegment = 0;');
  const neighbor = run('JSON.stringify(sequenceSegments()[1])');
  element('clampFilterEnabled').checked = true;
  element('clampFilterEnabled').dispatch('change');
  assert.equal(run('sequenceSegments()[0].filters.clampEnabled'), true);
  assert.equal(run('sequenceSegments()[0].values.every(value => value >= -1 && value <= 1)'), true);
  // Synchronization updates the shared timing metadata for both segments.
  context.syncSequence();
  run('projectDocument.AWG.sampleCount = projectDocument.waveform.sampleCount;');
  assert.equal(run('sequenceSegments()[1].filters.clampEnabled'), false);
  assert.deepEqual(Array.from(run('sequenceSegments()[1].values')), JSON.parse(neighbor).values);
  run('projectDocument = parseProject(JSON.parse(JSON.stringify(projectDocument)));');
  assert.equal(run('sequenceSegments()[0].filters.clampEnabled'), true);
  assert.equal(run('sequenceSegments()[1].filters.clampEnabled'), false);
});
