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

function harness(defaults = {}) {
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
  for (const file of ['js/awg-profiles.js', 'js/defaults.js']) run(read(file));
  context.startupDefaults = defaults;
  run('Object.assign(ARBDRAW_DEFAULTS, startupDefaults);');
  for (const file of ['js/math-expression.js', 'js/core.js', 'js/waveform-shapes.js']) run(read(file));
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

test('compact signal selector lists names and keeps one signal selected without preview cards', () => {
  const { run, element } = harness();
  element('addSignalBtn').onclick();
  element('addSignalBtn').onclick();
  element('duplicateSignalBtn').onclick();
  const list = element('signalSelect');
  assert.equal(list.children.length, 4);
  assert.equal(list.value, 'signal-4');
  assert.equal(list.children[3].textContent, 'Signal 3 copy');
  list.onchange({ target: { value: 'signal-1' } });
  element('signalNameInput').onchange({ target: { value: 'Clock' } });
  assert.equal(list.children[0].textContent, 'Clock');
  assert.equal(list.value, 'signal-1');
  assert.equal(run('activeSignal().name'), 'Clock');
  element('removeSignalBtn').onclick();
  assert.equal(list.children.length, 3);
  run('projectDocument = createDefaultDocument(); resetSignals(); generate();');
  assert.equal(element('signalSelect').children.length, 1);
  assert.equal(element('removeSignalBtn').disabled, true);
  assert.doesNotMatch(read('index.html'), /signalList|signal-card|signals-panel/);
});

function gridHarness(defaults = {}) {
  const fixture = harness(defaults), { context, run } = fixture;
  const listeners = {}, draws = [];
  const context2d = new Proxy({}, { get: (target, key) => target[key]
    || ((...args) => draws.push({ method: key, args })) });
  Object.assign(context, { devicePixelRatio: 1, editorAxisMode: 'absolute', editorSelection: {},
    ctx: context2d, drawEditorSelection() {},
    editorWaveformColor: () => '#7bffb2',
    canvas: { width: 1000, height: 459, parentElement: { style: {}, parentElement: { classList: { toggle() {} } } },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 459 }),
      setAttribute() {}, setPointerCapture() {},
      addEventListener(name, handler) { listeners[name] = handler; } },
    displayVoltage: (_, value) => value, displayAmplitude: value => value,
  });
  run(slice('js/waveform-editor.js', 'function editorTimeTicks(', 'function updateEditorCursorReadout('));
  run(slice('js/waveform-editor.js', 'function editorPointTicks(', 'function editorPointCanvasX('));
  run(slice('js/waveform-editor.js', 'function normalizeEditorViewport(', 'function normalizeEditorSelection('));
  run(slice('js/waveform-editor.js', 'function editorRecordLength()', 'function waveformGenerationRange('));
  run(slice('js/waveform-editor.js', 'function canvasPoint(', 'const dutyDisabledTypes'));
  run(slice('js/waveform-editor.js', "canvas.addEventListener('pointerdown'", "canvas.addEventListener('pointermove'"));
  run(read('js/signal-grid.js'));
  run(`state.samples = 100; state.frequency = 10000; generate('sine');
    addSignal(true); state.samples = 200; state.frequency = 1000; generate('triangle');
    activateSignal('signal-1');`);
  return { ...fixture, listeners, draws };
}

test('stacked grid aligns actual sample positions or elapsed time, including unequal records', () => {
  const { run, context } = gridHarness();
  assert.equal(run('currentEditorViewport().total'), 200);
  assert.equal(run('editorRecordLength()'), 100);
  context.editorAxisMode = 'time';
  assert.equal(run('currentEditorViewport().total'), 996);
  const before = run('JSON.stringify(projectDocument.signals)');
  run('Object.assign(editorViewport, { start: 100, pointsPerScreen: 401, total: 996 }); activateSignal("signal-2");');
  assert.equal(run('currentEditorViewport().start'), 20);
  assert.equal(run('currentEditorViewport().end'), 100);
  run('activateSignal("signal-1");');
  assert.equal(run('currentEditorViewport().start'), 100);
  assert.equal(run('currentEditorViewport().end'), 500);
  assert.equal(run('JSON.stringify(projectDocument.signals)'), before);
});

test('grid renders two vertically separated traces and one shared horizontal axis', () => {
  const { run, draws, element, context } = gridHarness();
  run('ARBDRAW_SIGNAL_GRID.draw(ctx, 1000, 459, 1, currentEditorViewport());');
  const clips = draws.filter(call => call.method === 'rect');
  assert.equal(clips.length, 2);
  assert.equal(clips[0].args[0], clips[1].args[0]);
  assert.ok(clips[0].args[1] + clips[0].args[3] < clips[1].args[1]);
  assert.ok(draws.some(call => call.method === 'fillText' && call.args[0] === 'Signal 1'));
  assert.ok(draws.some(call => call.method === 'fillText' && call.args[0] === 'Signal 1 copy'));
  assert.equal(element('editorPointAxisLabel').textContent, 'POINTS');
  assert.equal(context.canvas.parentElement.style.minHeight, '227px');
  for (const call of draws) for (const arg of call.args)
    if (typeof arg === 'number') assert.ok(Number.isFinite(arg), `${call.method} received ${arg}`);
});

test('clicking another lane selects it without editing and point edits use that lane’s voltage scale', () => {
  const { run, listeners } = gridHarness();
  const first = run('JSON.stringify(projectDocument.signals[0].waveform.values)');
  const second = run('JSON.stringify(projectDocument.signals[1].waveform.values)');
  listeners.pointerdown({ clientX: 500, clientY: 320, pointerId: 1 });
  assert.equal(run('projectDocument.activeSignalId'), 'signal-2');
  assert.equal(run('JSON.stringify(projectDocument.signals[1].waveform.values)'), second);
  const point = run('canvasPoint({clientX: 500, clientY: 320})');
  assert.ok(Math.abs(point.v) < 1e-12);
  assert.equal(point.outsideLane, false);
  run('state.tool = "pencil";');
  listeners.pointerdown({ clientX: 500, clientY: 250, pointerId: 2 });
  assert.notEqual(run('JSON.stringify(projectDocument.signals[1].waveform.values)'), second);
  assert.equal(run('JSON.stringify(projectDocument.signals[0].waveform.values)'), first);
  const changed = run('JSON.stringify(projectDocument.signals[1].waveform.values)');
  run('editAt(canvasPoint({ clientX: 500, clientY: 100 }), { i: 90, v: 0 });');
  assert.equal(run('JSON.stringify(projectDocument.signals[1].waveform.values)'), changed);
});

test('blank record tails and signal labels cannot write samples', () => {
  const { run, listeners } = gridHarness();
  const before = run('JSON.stringify(projectDocument.signals)');
  run('state.tool = "pencil";');
  listeners.pointerdown({ clientX: 950, clientY: 100, pointerId: 1 });
  listeners.pointerdown({ clientX: 20, clientY: 100, pointerId: 2 });
  assert.equal(run('JSON.stringify(projectDocument.signals)'), before);
  assert.equal(run('state.drawing'), false);
});

test('Add Signal follows the current record timing instead of stale startup defaults in Time mode', () => {
  const { run, context, draws } = gridHarness({ waveformType: 'square', frequencyHz: 750, frequencyUnit: 'kHz' });
  run(`projectDocument = createDefaultDocument(); resetSignals();
    state.samples = 1000; state.frequency = 475.9638; state.cycles = 1; generate('square');
    var originalValues = JSON.stringify(state.data); addSignal();`);
  assert.equal(run('state.frequency'), 475.9638);
  assert.equal(run('state.samples'), 1000);
  assert.equal(run('state.type'), 'square');
  context.editorAxisMode = 'time';
  run('activateSignal("signal-1");');
  const before = run('JSON.stringify(projectDocument.signals)');
  draws.length = 0;
  run('ARBDRAW_SIGNAL_GRID.draw(ctx, 1000, 459, 1, currentEditorViewport());');
  // Trace paths are clipped per row. Both records must span the same time window.
  const traceEnds = [];
  let inTrace = false, lastX;
  for (const call of draws) {
    if (call.method === 'clip') inTrace = true;
    if (inTrace && call.method === 'lineTo') lastX = call.args[0];
    if (inTrace && call.method === 'restore') { traceEnds.push(lastX); inTrace = false; }
  }
  assert.equal(traceEnds.length, 2);
  assert.equal(traceEnds[0], 982);
  assert.equal(traceEnds[1], 982);
  assert.equal(run('JSON.stringify(projectDocument.signals)'), before);
  assert.equal(run('JSON.stringify(projectDocument.signals[0].waveform.values) === originalValues'), true);
});

test('new signals regenerate source samples without changing existing edits or the current profile', () => {
  const { run } = harness();
  run(`selectedAwgProfile = profileById('rigol-dg1022');
    state.sampleRate = 100; state.samples = 32; state.frequency = 250; state.cycles = 3;
    generate('square'); state.data[4] = 0.123; state.samplesEdited = true; pushHistory(); renderAwgTiming();
    var original = JSON.stringify(projectDocument.signals[0]); addSignal();`);
  assert.equal(run('JSON.stringify(projectDocument.signals[0]) === original'), true);
  assert.equal(run('selectedAwgProfile.id'), 'rigol-dg1022');
  assert.equal(run('state.samples'), 32);
  assert.equal(run('state.sampleRate'), 100);
  assert.equal(run('state.cycles / state.frequency'), 3 / 250);
  assert.equal(run('state.samplesEdited'), false);
  assert.notEqual(run('state.data[4]'), 0.123);
});

test('adding a Serial signal preserves deliberately adjusted timing instead of reinitializing its period', () => {
  const { run } = harness();
  run(`generate('serial'); state.frequency = 200; state.cycles = 2; generate('serial');
    var serialValues = JSON.stringify(state.data); addSignal();`);
  assert.equal(run('state.type'), 'serial');
  assert.equal(run('state.frequency'), 200);
  assert.equal(run('state.cycles'), 2);
  assert.equal(run('JSON.stringify(state.data) === serialValues'), true);
});

test('adding from a selected sequence segment uses the complete record duration and count', () => {
  const { run } = harness();
  run(`addSequenceSegment('triangle');
    var period = recordState().cycles / recordState().frequency;
    var count = recordState().samples;
    var source = JSON.stringify(projectDocument.signals[0]); addSignal();`);
  assert.equal(run('state.type'), 'triangle');
  assert.equal(run('state.samples === count'), true);
  assert.equal(run('state.cycles / state.frequency === period'), true);
  assert.equal(run('Boolean(sequenceSegments())'), false);
  assert.equal(run('JSON.stringify(projectDocument.signals[0]) === source'), true);
});
