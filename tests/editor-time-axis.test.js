const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/waveform-editor.js'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '../js/core.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

function editor({ stored = {}, sequence = false, overview = false } = {}) {
  const elements = new Map(), labels = [], lines = [], saved = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', hidden: false, style: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      classList: { contains: () => true },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    $: element,
    state: { data: Array.from({ length: 1000 }, (_, i) => Math.sin(i / 100)),
      samples: 1000, frequency: 1000, cycles: 2, sampleRate: 2500,
      high: 1, low: -1, activeSegment: 0, tool: 'pencil',
      history: [{ marker: 'preserve' }], redo: [{ marker: 'redo' }] },
    readStoredSettings: () => stored,
    persistSettings: (value) => saved.push({ ...value }),
    ARBDRAW_SEQUENCE: { hasSegments: () => sequence, isOverview: () => overview, refresh() {} },
    recordState: () => ({ frequency: 200, cycles: 1 }),
    devicePixelRatio: 1,
    canvas: { width: 1076, height: 459, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    ctx: new Proxy({
      fillText: (text, x, y) => labels.push({ text, x, y }),
      moveTo: (x, y) => lines.push({ x, y }),
    }, { get: (target, key) => target[key] || (() => {}) }),
    drawEditorOverview() {}, drawEditorSelection() {}, editorWaveformColor: () => 'orange',
  });
  vm.runInContext(section('const editorViewport =', 'function editorWaveformColor()')
    + section('function normalizeEditorViewport(', 'function waveformGenerationRange(')
    + section('function voltageBounds()', 'function editorPointCanvasX(')
    + section('function draw()', 'function setWaveformRenderMode(')
    + section('function canvasPoint(', 'const dutyDisabledTypes')
    + core.slice(core.indexOf('function axisTimeUnitFor(')), context);
  return { context, element, labels, lines, saved,
    run: (code) => vm.runInContext(code, context) };
}

test('time axis follows the AWG record period across multiple cycles, not nominal sample-rate metadata', () => {
  const { run, element } = editor();
  assert.equal(run('editorTiming().periodSeconds'), 0.002);
  assert.equal(run('editorTiming().intervalSeconds'), 0.000002);
  assert.equal(run('editorTiming().outputFrequency'), 500);
  run('setEditorAxisMode("time")');
  assert.equal(element('editorTimingReadout').textContent, '1,000 pts × 2 µs = 2 ms · AWG 500 Hz');
  assert.equal(run('editorCoordinateText(999)'), '1.998 ms (999 pts)');
  run('state.frequency = 2000; draw()');
  assert.equal(run('editorTiming().intervalSeconds'), 0.000001);
  assert.equal(element('editorTimingReadout').textContent, '1,000 pts × 1 µs = 1 ms · AWG 1 kHz');
});

test('switching axes preserves data, zoom, selection, cursor and undo/redo, then refreshes readouts', () => {
  const { run, element, saved } = editor();
  run(`Object.assign(editorViewport, { start: 200, pointsPerScreen: 500, total: 1000 });
    Object.assign(editorSelection, { left: 250, right: 500 });
    editorCursorPoint = { i: 400, v: 0.5 }; draw();`);
  const snapshot = run('JSON.stringify({ state, editorViewport, editorSelection, editorCursorPoint })');
  element('editorTimeAxisBtn').onclick();
  assert.equal(run('JSON.stringify({ state, editorViewport, editorSelection, editorCursorPoint })'), snapshot);
  assert.equal(element('editorTimeAxisBtn').attributes['aria-pressed'], 'true');
  assert.equal(element('editorAbsoluteAxisBtn').attributes['aria-pressed'], 'false');
  assert.equal(element('editorSelectionLeft').textContent, '500 µs (250 pts)');
  assert.equal(element('editorSelectionRight').textContent, '1 ms (500 pts)');
  assert.equal(element('cursorReadout').textContent, '800 µs (400 pts)  0.50000 V');
  element('editorAbsoluteAxisBtn').onclick();
  assert.equal(run('JSON.stringify({ state, editorViewport, editorSelection, editorCursorPoint })'), snapshot);
  assert.equal(element('editorSelectionLeft').textContent, '250 pts');
  assert.equal(element('cursorReadout').textContent, '400 pts  0.50000 V');
  assert.deepEqual(saved, [{ editorAxisMode: 'time' }, { editorAxisMode: 'absolute' }]);
});

test('time grid uses elapsed-time divisions and responds to zoom and frequency changes', () => {
  const { run, labels, element } = editor();
  run('setEditorAxisMode("time")');
  assert.equal(element('editorPointAxisLabel').textContent, 'TIME (ms)');
  assert.deepEqual(labels.filter((label) => label.y === 430).map((label) => label.text), [0, 0.5, 1, 1.5]);
  labels.length = 0;
  run('setEditorViewport({ start: 200, pointsPerScreen: 101 })');
  assert.equal(element('editorPointAxisLabel').textContent, 'TIME (µs)');
  const ticks = labels.filter((label) => label.y === 430);
  assert.deepEqual(ticks.map((label) => label.text), [400, 450, 500, 550, 600]);
  assert.ok(Math.abs(ticks[0].x - 58) < 1e-9);
  assert.ok(Math.abs(ticks.at(-1).x - 1058) < 1e-9);
  labels.length = 0;
  run('state.frequency = 2000; draw()');
  assert.deepEqual(labels.filter((label) => label.y === 430).map((label) => label.text), [200, 220, 240, 260, 280, 300]);
});

test('time and sample views map pencil and erase gestures to the same voltage samples', () => {
  const a = editor(), b = editor();
  b.run('setEditorAxisMode("time")');
  for (const view of [a, b]) {
    view.run(`setEditorViewport({ start: 200, pointsPerScreen: 101 });
      Object.assign(editorSelection, { left: 220, right: 280 });
      const point = canvasPoint({ clientX: 558, clientY: 120 });
      editAt(point, { i: 200, v: -1 });`);
    assert.equal(view.run('point.i'), 250);
    assert.equal(view.run('point.v'), 0.5);
    assert.equal(view.run('state.data[250]'), 0.5);
    assert.equal(view.run('state.data[219]'), Math.sin(2.19));
  }
  assert.equal(a.run('JSON.stringify(state.data)'), b.run('JSON.stringify(state.data)'));
  for (const view of [a, b]) view.run('state.tool = "erase"; editAt({ i: 250, v: 1 });');
  assert.equal(a.run('state.data[250]'), 0);
  assert.equal(a.run('JSON.stringify(state.data)'), b.run('JSON.stringify(state.data)'));
});

test('sequence segments and full records use the shared clock, with local zero for each segment', () => {
  for (const overview of [false, true]) {
    const { run, element } = editor({ sequence: true, overview });
    run(`state.sampleRate = 0.1; state.frequency = 7000; state.cycles = 3;
      setEditorAxisMode('time')`);
    assert.equal(run('editorTiming().intervalSeconds'), 0.00001);
    assert.equal(run('editorTiming().periodSeconds'), 0.01);
    assert.equal(run('editorCoordinateText(0)'), '0 ns (0 pts)');
    assert.equal(run('editorCoordinateText(999)'), '9.99 ms (999 pts)');
    assert.equal(element('editorTimingReadout').textContent,
      `${overview ? '' : 'Segment 1 · '}1,000 pts × 10 µs = 10 ms · AWG 200 Hz`);
  }
});

test('axis preference restores independently of waveform data, with safe default and tiny/long time scales', () => {
  for (const [stored, expected] of [[{}, 'absolute'], [{ editorAxisMode: 'bad' }, 'absolute'], [{ editorAxisMode: 'time' }, 'time']]) {
    const { run } = editor({ stored });
    assert.equal(run('editorAxisMode'), expected);
    assert.equal(run('Object.hasOwn(state, "editorAxisMode")'), false);
  }
  const { run, element } = editor({ stored: { editorAxisMode: 'time' } });
  run('state.frequency = 1e7; state.cycles = 1; draw()');
  assert.equal(element('editorPointAxisLabel').textContent, 'TIME (ns)');
  run('state.frequency = 0.1; draw()');
  assert.equal(element('editorPointAxisLabel').textContent, 'TIME (s)');
  assert.equal(run('editorCoordinateText(999)'), '9.99 s (999 pts)');
  assert.deepEqual(Array.from(run('editorTimeTicks({start: 0, end: 0}, 1)')), [0]);
});
