const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function harness(dpr = 1) {
  const elements = new Map(), labels = [], strokes = [];
  let currentPath = [], dash = [];
  const ctx = {
    clearRect() { labels.length = 0; strokes.length = 0; }, fillRect() {}, save() {}, restore() {}, rect() {}, clip() {},
    beginPath() { currentPath = []; }, moveTo(x, y) { currentPath.push([x, y]); }, lineTo(x, y) { currentPath.push([x, y]); },
    setLineDash(value) { dash = value; },
    stroke() { strokes.push({ path: [...currentPath], color: this.strokeStyle, dash: [...dash] }); },
    fillText(text, x, y) { labels.push({ text, x, y }); },
  };
  function $(id) {
    if (!elements.has(id)) {
      const listeners = new Map(), attributes = {}, classes = new Set(), captures = new Set();
      elements.set(id, {
        id, hidden: false, disabled: false, value: '', style: {}, textContent: '',
        width: 480 * dpr, height: 259 * dpr,
        classList: { add: key => classes.add(key), remove: key => classes.delete(key), contains: key => classes.has(key) },
        setAttribute(key, value) { attributes[key] = value; }, getAttribute: key => attributes[key],
        removeAttribute(key) { delete attributes[key]; },
        setCustomValidity(message) { this.validationMessage = message; }, reportValidity() { this.reportedValidity = true; },
        querySelectorAll: () => [], getContext: () => ctx,
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 480, height: 259 }),
        focus() {},
        setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id),
        releasePointerCapture(id) { captures.delete(id); this.dispatch('lostpointercapture', { pointerId: id }); },
        addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); },
        dispatch(type, event = {}) {
          const e = { button: 0, pointerId: 1, pointerType: 'mouse',
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...event };
          for (const handler of listeners.get(type) || []) handler(e);
          return e;
        },
      });
    }
    return elements.get(id);
  }
  const state = { data: [-1, 0, 1], high: 1, low: -1, samples: 3, frequency: 1000, history: ['original'] };
  const projectDocument = { name: 'Unchanged waveform', waveform: state };
  const context = vm.createContext({
    $, state, projectDocument, devicePixelRatio: dpr,
    document: { querySelector: selector => $(selector.slice(1)) },
    DEFAULT_VALUES: { waveformVerticalDivisions: 8, waveformColor: '#7bffb2' },
    ARBDRAW_FIELD_DEFINITIONS: {}, ARBDRAW_FIELDS: { applyDefinition() {}, formatInputs() {} },
    waveformDurationMs: () => 1,
  });
  const read = file => fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  const core = read('core.js');
  vm.runInContext(core.slice(core.indexOf('function axisTimeUnitFor(')), context);
  vm.runInContext(read('scope-view.js'), context);
  vm.runInContext(read('scope-cursors.js'), context);
  const run = source => vm.runInContext(source, context);
  run('Object.assign(scopeState, { fitted: true, voltsPerDiv: 1, timePerDivMs: 0.1 }); drawScope();');
  const point = (x, y) => ({ clientX: 100 + 62 + 400 * x, clientY: 50 + 20 + 200 * y });
  return { $, context, state, projectDocument, run, point, labels, strokes,
    click: id => $(id).dispatch('click'),
    input: (id, value) => { $(id).value = String(value); $(id).dispatch('input'); },
    change: (id, value) => { $(id).value = String(value); $(id).dispatch('change'); },
    pointer: (type, x, y, extras = {}) => $('scopeCanvas').dispatch(type, { ...point(x, y), ...extras }),
    key: (id, key, extras = {}) => $(id).dispatch('keydown', { key, ...extras }),
    cursorLabels: () => labels.filter(label => /^(T|V)[12]$/.test(label.text)),
  };
}

test('time and voltage overlays toggle independently with labelled positions and signed deltas', () => {
  const f = harness();
  assert.equal(f.$('scopeTimeMeasurements').hidden, true);
  assert.equal(f.$('scopeVoltageMeasurements').hidden, true);
  assert.equal(f.$('scopeResetCursorsBtn').disabled, true);
  assert.equal(f.cursorLabels().length, 0);
  f.click('scopeTimeCursorsBtn');
  assert.equal(f.$('scopeTimeCursorsBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(f.$('scopeTimeMeasurements').hidden, false);
  assert.equal(f.$('scopeT1Btn').textContent, 'T1: 250 µs');
  assert.equal(f.$('scopeT2Btn').textContent, 'T2: 750 µs');
  assert.equal(f.$('scopeTimeDelta').textContent, 'Δt: 500 µs');
  assert.equal(f.cursorLabels().length, 2);
  f.click('scopeVoltageCursorsBtn');
  assert.equal(f.$('scopeV1Btn').textContent, 'V1: -2 V');
  assert.equal(f.$('scopeV2Btn').textContent, 'V2: 2 V');
  assert.equal(f.$('scopeVoltageDelta').textContent, 'ΔV: 4 V');
  assert.equal(f.cursorLabels().length, 4);
  f.click('scopeTimeCursorsBtn');
  assert.equal(f.cursorLabels().length, 2);
  assert.equal(f.$('scopeVoltageMeasurements').hidden, false);
  f.click('scopeVoltageCursorsBtn');
  assert.equal(f.cursorLabels().length, 0);
  assert.equal(f.$('scopeCursorHint').hidden, true);
});

test('dragging each cursor updates measurements without changing samples, project data, history or zoom', () => {
  for (const dpr of [1, 2]) {
    const f = harness(dpr), original = JSON.stringify(f.projectDocument), view = f.run('JSON.stringify(scopeState)');
    f.click('scopeTimeCursorsBtn');
    f.click('scopeVoltageCursorsBtn');
    f.pointer('pointerdown', 0.25, 0.5);
    assert.equal(f.run('scopeZoomDrag'), null);
    assert.equal(f.$('scopeCanvas').hasPointerCapture(1), true);
    f.pointer('pointermove', 0.4, 0.9);
    assert.equal(f.$('scopeT1Btn').textContent, 'T1: 400 µs');
    assert.equal(f.$('scopeTimeDelta').textContent, 'Δt: 350 µs');
    f.pointer('pointerup', 0.9, 0.9);
    assert.equal(f.$('scopeTimeDelta').textContent, 'Δt: -150 µs');
    assert.equal(f.$('scopeCanvas').hasPointerCapture(1), false);
    f.pointer('pointerdown', 0.75, 0.4);
    f.pointer('pointerup', 0.6, 0.4);
    assert.equal(f.$('scopeT2Btn').textContent, 'T2: 600 µs');
    f.pointer('pointerdown', 0.1, 0.75);
    f.pointer('pointermove', 0.1, 0.2);
    assert.equal(f.$('scopeV1Btn').textContent, 'V1: 2.4 V');
    f.pointer('pointerup', 0.1, 0.2);
    assert.equal(f.$('scopeVoltageDelta').textContent, 'ΔV: -400 mV');
    f.pointer('pointerdown', 0.1, 0.25);
    f.pointer('pointerup', 0.1, 0.5);
    assert.equal(f.$('scopeV2Btn').textContent, 'V2: 0 mV');
    assert.equal(JSON.stringify(f.projectDocument), original);
    assert.equal(f.run('JSON.stringify(scopeState)'), view);
    const t2Line = f.strokes.find(stroke => stroke.color === '#7edcff' && stroke.path[0][0] === (62 + 0.6 * 400) * dpr);
    assert.ok(t2Line);
    assert.deepEqual(t2Line.dash, [7 * dpr, 4 * dpr]);
  }
});

test('zoom, scale, waveform, and canvas size changes preserve physical measurements and flag hidden cursors', () => {
  const f = harness();
  f.click('scopeTimeCursorsBtn');
  f.click('scopeVoltageCursorsBtn');
  f.pointer('pointerdown', 0.05, 0.05);
  assert.ok(f.run('scopeZoomDrag'));
  f.pointer('pointermove', 0.15, 0.2);
  assert.equal(f.$('scopeZoomSelection').classList.contains('open'), true);
  f.pointer('pointerup', 0.15, 0.2);
  assert.equal(f.run('scopeZoomDrag'), null);
  assert.match(f.$('scopeT1Btn').textContent, /^T1: 250 µs \(outside view\)$/);
  assert.equal(f.$('scopeTimeDelta').textContent, 'Δt: 500 µs');
  f.run('scopeState.timePerDivMs = 1; scopeState.verticalPosition = 10; scopeState.voltsPerDiv = 0.1;');
  f.state.data = [0, 0];
  f.$('scopeCanvas').width = 960;
  f.context.devicePixelRatio = 2;
  f.run('drawScope()');
  assert.equal(f.$('scopeTimeDelta').textContent, 'Δt: 500 µs');
  assert.equal(f.$('scopeVoltageDelta').textContent, 'ΔV: 4 V');
  assert.match(f.$('scopeV1Btn').textContent, /outside view/);
  f.click('scopeResetCursorsBtn');
  assert.doesNotMatch(f.$('scopeT1Btn').textContent, /outside view/);
  assert.doesNotMatch(f.$('scopeV1Btn').textContent, /outside view/);
  assert.equal(f.$('scopeVoltageDelta').textContent, 'ΔV: 400 mV');
  assert.equal(f.$('scopeTimeDelta').textContent, 'Δt: 5 ms');
});

test('readout buttons and canvas support keyboard selection, fine/coarse moves and view boundaries', () => {
  const f = harness();
  f.click('scopeTimeCursorsBtn');
  f.click('scopeT2Btn');
  assert.equal(f.$('scopeT2Btn').getAttribute('aria-pressed'), 'true');
  assert.equal(f.key('scopeT2Btn', 'ArrowLeft').defaultPrevented, true);
  assert.equal(f.$('scopeT2Btn').textContent, 'T2: 747.5 µs');
  f.key('scopeCanvas', 'ArrowRight', { shiftKey: true });
  assert.equal(f.$('scopeT2Btn').textContent, 'T2: 772.5 µs');
  f.key('scopeT2Btn', 'ArrowLeft', { ctrlKey: true });
  assert.equal(f.$('scopeT2Btn').textContent, 'T2: 772.5 µs');
  f.key('scopeT2Btn', 'Home');
  assert.equal(f.$('scopeT2Btn').textContent, 'T2: 0 ns');
  f.key('scopeT2Btn', 'End');
  assert.equal(f.$('scopeT2Btn').textContent, 'T2: 1 ms');
  f.click('scopeVoltageCursorsBtn');
  f.key('scopeV1Btn', 'ArrowUp');
  assert.equal(f.$('scopeV1Btn').textContent, 'V1: -1.96 V');
  f.key('scopeV1Btn', 'ArrowDown', { shiftKey: true });
  assert.equal(f.$('scopeV1Btn').textContent, 'V1: -2.36 V');
  f.key('scopeV1Btn', 'End');
  f.key('scopeV1Btn', 'ArrowUp');
  assert.equal(f.$('scopeV1Btn').textContent, 'V1: 4 V');
});

test('pointer cancellation, capture loss and Escape restore the original position; unrelated pointers do not take over', () => {
  for (const end of ['pointercancel', 'lostpointercapture', 'Escape']) {
    const f = harness();
    f.click('scopeTimeCursorsBtn');
    f.pointer('pointerdown', 0.25, 0.5);
    f.pointer('pointerdown', 0.75, 0.5, { pointerId: 2 });
    f.pointer('pointermove', 0.6, 0.5, { pointerId: 2 });
    f.pointer('pointerup', 0.6, 0.5, { pointerId: 2 });
    assert.equal(f.$('scopeT1Btn').textContent, 'T1: 250 µs');
    f.pointer('pointermove', 0.4, 0.5);
    assert.equal(f.$('scopeT1Btn').textContent, 'T1: 400 µs');
    if (end === 'Escape') f.key('scopeCanvas', 'Escape');
    else f.$('scopeCanvas').dispatch(end, { pointerId: 1 });
    assert.equal(f.$('scopeT1Btn').textContent, 'T1: 250 µs');
    assert.equal(f.$('scopeCanvas').hasPointerCapture(1), false);
    assert.equal(f.run('scopeZoomDrag'), null);
  }
});

test('dragging clamps to the plot bounds, toggling retains positions, and reset works with an empty waveform', () => {
  const f = harness();
  f.click('scopeTimeCursorsBtn');
  f.pointer('pointerdown', 0.25, 0.5);
  f.pointer('pointerup', -1, 2);
  assert.equal(f.$('scopeT1Btn').textContent, 'T1: 0 ns');
  f.click('scopeTimeCursorsBtn');
  f.click('scopeTimeCursorsBtn');
  assert.equal(f.$('scopeT1Btn').textContent, 'T1: 0 ns');
  f.state.data = [];
  f.click('scopeResetCursorsBtn');
  assert.equal(f.$('scopeT1Btn').textContent, 'T1: 250 µs');
  assert.equal(f.cursorLabels().length, 2);
});

test('touch has a larger hit target, while plot margins and right clicks do not start cursor drags', () => {
  const f = harness();
  f.click('scopeTimeCursorsBtn');
  f.pointer('pointerdown', 0.28, 0.5, { pointerType: 'touch' });
  assert.equal(f.run('scopeZoomDrag'), null);
  f.pointer('pointerup', 0.4, 0.5);
  assert.equal(f.$('scopeT1Btn').textContent, 'T1: 370 µs');
  f.pointer('pointerdown', 0.37, 0.5, { button: 2 });
  assert.equal(f.$('scopeCanvas').hasPointerCapture(1), false);
  f.pointer('pointerdown', 0.37, -0.05);
  assert.ok(f.run('scopeZoomDrag'));
  f.$('scopeCanvas').dispatch('pointercancel', f.point(0.4, -0.05));
});

test('cursor labels act as drag handles and selected coincident cursors remain movable', () => {
  const f = harness();
  f.click('scopeTimeCursorsBtn');
  // Inside T1's label, but farther from its line than the mouse hit tolerance.
  f.pointer('pointerdown', 0.29, 0.04);
  assert.equal(f.run('scopeZoomDrag'), null);
  f.pointer('pointerup', 0.29, 0.04);
  assert.equal(f.$('scopeT1Btn').textContent, 'T1: 250 µs');
  f.pointer('pointerdown', 0.29, 0.04);
  f.pointer('pointerup', 0.79, 0.5);
  assert.equal(f.$('scopeTimeDelta').textContent, 'Δt: 0 ns');
  f.click('scopeT2Btn');
  f.pointer('pointerdown', 0.75, 0.5);
  f.pointer('pointerup', 0.9, 0.5);
  assert.equal(f.$('scopeT1Btn').textContent, 'T1: 750 µs');
  assert.equal(f.$('scopeT2Btn').textContent, 'T2: 900 µs');
});

test('X/Y Apply moves the selected cursor pair atomically without editing samples or view settings', () => {
  const f = harness(), original = JSON.stringify(f.projectDocument), view = f.run('JSON.stringify(scopeState)');
  assert.equal(f.$('scopeCoordinateControls').hidden, true);
  f.click('scopeTimeCursorsBtn');
  assert.equal(f.$('scopeYInput').disabled, true);
  assert.equal(f.$('scopeXInput').value, '0.25');
  f.click('scopeVoltageCursorsBtn');
  assert.equal(f.$('scopeYInput').value, '-2');
  f.change('scopeXCursor', 'T2');
  f.change('scopeYCursor', 'V2');
  f.input('scopeXInput', '0.6');
  f.input('scopeYInput', '-0.5');
  assert.equal(f.$('scopeT2Btn').textContent, 'T2: 750 µs');
  f.click('scopeApplyCoordinatesBtn');
  assert.equal(f.$('scopeT2Btn').textContent, 'T2: 600 µs');
  assert.equal(f.$('scopeV2Btn').textContent, 'V2: -500 mV');
  assert.equal(f.$('scopeTimeDelta').textContent, 'Δt: 350 µs');
  assert.equal(f.$('scopeVoltageDelta').textContent, 'ΔV: 1.5 V');
  assert.equal(JSON.stringify(f.projectDocument), original);
  assert.equal(f.run('JSON.stringify(scopeState)'), view);
});

test('unit changes preserve both applied positions and precise drafts until Enter applies', () => {
  const f = harness();
  f.click('scopeTimeCursorsBtn');
  f.click('scopeVoltageCursorsBtn');
  f.change('scopeXUnit', '0.001');
  f.change('scopeYUnit', '0.001');
  assert.equal(f.$('scopeXInput').value, '250');
  assert.equal(f.$('scopeYInput').value, '-2000');
  assert.equal(f.$('scopeXInput').max, '1000');
  assert.equal(f.$('scopeYInput').min, '-4000');
  f.input('scopeXInput', '123.45678901234567');
  f.input('scopeYInput', '-125');
  for (let i = 0; i < 3; i++) {
    for (const unit of ['1e-9', '1e-6', '1', '1000', '0.001']) f.change('scopeXUnit', unit);
    for (const unit of ['1', '0.001']) f.change('scopeYUnit', unit);
  }
  assert.equal(f.$('scopeT1Btn').textContent, 'T1: 250 µs');
  assert.equal(f.$('scopeV1Btn').textContent, 'V1: -2 V');
  f.key('scopeYInput', 'Enter');
  assert.equal(f.$('scopeT1Btn').textContent, 'T1: 123.457 µs');
  assert.equal(f.$('scopeV1Btn').textContent, 'V1: -125 mV');
  const line = f.strokes.find(stroke => stroke.color === '#7edcff' && stroke.dash[0] === 2);
  assert.equal(line.path[0][0], 62 + (123.45678901234567 * 0.001) * 400);
});

test('invalid or out-of-range coordinates reject the whole Apply and show an actionable error', () => {
  for (const bad of ['', ' ', '-', 'NaN', 'Infinity', '1e309', '0x10', '4.01', '-4.01']) {
    const f = harness();
    f.click('scopeTimeCursorsBtn');
    f.click('scopeVoltageCursorsBtn');
    f.input('scopeXInput', '0.4');
    f.input('scopeYInput', bad);
    f.click('scopeApplyCoordinatesBtn');
    assert.equal(f.$('scopeT1Btn').textContent, 'T1: 250 µs', bad);
    assert.equal(f.$('scopeV1Btn').textContent, 'V1: -2 V', bad);
    assert.equal(f.$('scopeYInput').getAttribute('aria-invalid'), 'true');
    assert.equal(f.$('scopeCoordinateError').hidden, false);
    assert.match(f.$('scopeCoordinateError').textContent, /^Y \(V1\): .*finite|^Y \(V1\): .*current view/);
    assert.equal(f.$('scopeYInput').reportedValidity, true);
    f.input('scopeYInput', '-1');
    f.click('scopeApplyCoordinatesBtn');
    assert.equal(f.$('scopeCoordinateError').hidden, true);
    assert.equal(f.$('scopeT1Btn').textContent, 'T1: 400 µs');
  }
});

test('range validation uses the current view and ignores disabled coordinate axes', () => {
  const f = harness();
  f.click('scopeTimeCursorsBtn');
  f.run('scopeState.timeStartMs = 2; scopeState.timePerDivMs = 0.2; drawScope()');
  assert.equal(f.$('scopeXInput').min, '2');
  assert.equal(f.$('scopeXInput').max, '4');
  for (const bad of ['1.9', '4.1']) {
    f.input('scopeXInput', bad);
    f.click('scopeApplyCoordinatesBtn');
    assert.match(f.$('scopeCoordinateError').textContent, /from 2 to 4 ms/);
  }
  f.input('scopeYInput', 'invalid');
  for (const boundary of ['2', '4']) {
    f.input('scopeXInput', boundary);
    f.click('scopeApplyCoordinatesBtn');
    assert.equal(f.$('scopeT1Btn').textContent, `T1: ${boundary} ms`);
    assert.equal(f.$('scopeCoordinateError').hidden, true);
  }
});

test('coordinate fields follow dragged and keyboard-selected cursors using the chosen units', () => {
  const f = harness();
  f.click('scopeTimeCursorsBtn');
  f.click('scopeVoltageCursorsBtn');
  f.change('scopeXUnit', '0.001');
  f.change('scopeYUnit', '0.001');
  f.input('scopeXInput', '125');
  f.pointer('pointerdown', 0.75, 0.4);
  f.pointer('pointermove', 0.6, 0.4);
  f.pointer('pointerup', 0.6, 0.4);
  assert.equal(f.$('scopeXCursor').value, 'T2');
  assert.equal(f.$('scopeXInput').value, '600');
  f.pointer('pointerdown', 0.1, 0.25);
  f.pointer('pointerup', 0.1, 0.45);
  assert.equal(f.$('scopeYCursor').value, 'V2');
  assert.equal(f.$('scopeYInput').value, '400');
  f.key('scopeT1Btn', 'ArrowRight');
  assert.equal(f.$('scopeXCursor').value, 'T1');
  assert.equal(f.$('scopeXInput').value, '252.5');
  f.click('scopeResetCursorsBtn');
  assert.equal(f.$('scopeXInput').value, '250');
  assert.equal(f.$('scopeYInput').value, '2000');
});

test('redraws preserve drafts, Escape restores them, and Reset discards drafts even at default positions', () => {
  const f = harness();
  f.click('scopeTimeCursorsBtn');
  f.click('scopeVoltageCursorsBtn');
  f.input('scopeXInput', '0.4');
  f.input('scopeYInput', '-1');
  f.run('drawScope()');
  assert.equal(f.$('scopeXInput').value, '0.4');
  assert.equal(f.$('scopeYInput').value, '-1');
  f.key('scopeXInput', 'Escape');
  assert.equal(f.$('scopeXInput').value, '0.25');
  assert.equal(f.$('scopeYInput').value, '-2');
  f.input('scopeXInput', '0.4');
  f.click('scopeResetCursorsBtn');
  assert.equal(f.$('scopeXInput').value, '0.25');
  f.input('scopeYInput', '');
  f.change('scopeYUnit', '0.001');
  assert.equal(f.$('scopeYUnit').value, '1');
  assert.equal(f.$('scopeYInput').value, '');
  assert.match(f.$('scopeCoordinateError').textContent, /finite number before changing units/);
});
