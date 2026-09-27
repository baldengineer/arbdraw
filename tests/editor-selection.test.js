const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('selection tool and marker readout are placed in the editor', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'js/core.js'), 'utf8');
  const properties = fs.readFileSync(path.join(root, 'js/properties.js'), 'utf8');
  const pointerIndex = html.indexOf('data-tool="pointer"');
  const selectionIndex = html.indexOf('data-tool="selection"');
  const pencilIndex = html.indexOf('data-tool="pencil"');

  assert.ok(pointerIndex >= 0 && pointerIndex < selectionIndex);
  assert.ok(selectionIndex < pencilIndex);
  assert.match(html, /id="editorSelectionReadout"[^>]*hidden/);
  assert.match(html, /id="editorSelectionLeft"/);
  assert.match(html, /id="editorSelectionRight"/);
  assert.match(html, /id="editorSelectionClear"[^>]*aria-label="Clear point selection"/);
  assert.match(core, /Select: 'selection'/);
  assert.match(properties, /selection: 'Select'/);
});

test('selection bounds are ordered and clamped to the memory record', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helper = source.slice(
    source.indexOf('function normalizeEditorSelection('),
    source.indexOf('function currentEditorSelection()'),
  );
  const normalize = (selection, totalPoints) =>
    vm.runInNewContext(
      `${helper}\nnormalizeEditorSelection(${JSON.stringify(selection)}, ${totalPoints});`,
    );

  assert.equal(normalize({ left: null, right: null }, 1000), null);
  const ordered = normalize({ left: 700, right: 200 }, 1000);
  assert.deepEqual({ left: ordered.left, right: ordered.right }, { left: 200, right: 700 });
  const clamped = normalize({ left: -50, right: 1200 }, 1000);
  assert.deepEqual({ left: clamped.left, right: clamped.right }, { left: 0, right: 999 });
});

test('selection interaction shades the range and supports movable markers and clearing', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');

  assert.match(source, /function drawEditorSelection\(/);
  assert.match(source, /ctx\.fillRect\(leftX, pad\.t/);
  assert.match(source, /for \(const markerIndex of new Set\(\[selection\.left, selection\.right\]\)\)/);
  assert.match(source, /function beginEditorSelection\(event\)/);
  assert.match(source, /leftDistance <= rightDistance \? 'left' : 'right'/);
  assert.match(source, /editorSelection\.dragging = 'range'/);
  assert.match(source, /editorSelectionClear'\)\.addEventListener\('click', clearEditorSelection\)/);
});

test('direct editing is clipped to the active marker range', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helpers = source.slice(
    source.indexOf('function editorEditIndexRange('),
    source.indexOf('const dutyDisabledTypes'),
  );
  const context = {
    state: {
      tool: 'pencil',
      data: [0, 0, 0, 0, 0, 0, 0],
      high: 1,
      low: -1,
      samplesEdited: false,
      lineStart: null,
    },
    currentEditorSelection: () => ({ left: 2, right: 4 }),
    draw() {},
  };
  vm.runInNewContext(
    `${helpers}
    editAt({ i: 0, v: 9 });
    editAt({ i: 5, v: 5 }, { i: 1, v: 1 });`,
    context,
  );

  assert.deepEqual(Array.from(context.state.data), [0, 0, 2, 3, 4, 0, 0]);
  assert.equal(context.state.samplesEdited, true);
});

test('delete and line edits cannot change samples outside the active marker range', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helpers = source.slice(
    source.indexOf('function editorEditIndexRange('),
    source.indexOf('const dutyDisabledTypes'),
  );
  const context = {
    state: {
      tool: 'erase',
      data: [9, 9, 9, 9, 9, 9, 9],
      high: 2,
      low: -2,
      samplesEdited: false,
      lineStart: null,
    },
    currentEditorSelection: () => ({ left: 2, right: 4 }),
    draw() {},
  };
  vm.runInNewContext(
    `${helpers}
    editAt({ i: 6, v: 9 }, { i: 0, v: 9 });
    state.tool = 'line';
    state.lineStart = { i: 0, v: 0 };
    editAt({ i: 6, v: 6 });`,
    context,
  );

  assert.deepEqual(Array.from(context.state.data), [9, 9, 2, 3, 4, 9, 9]);
});

test('an edit entirely outside the marker range leaves the waveform unchanged', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helpers = source.slice(
    source.indexOf('function editorEditIndexRange('),
    source.indexOf('const dutyDisabledTypes'),
  );
  const context = {
    state: {
      tool: 'pencil',
      data: [0, 0, 0, 0, 0],
      high: 1,
      low: -1,
      samplesEdited: false,
      lineStart: null,
    },
    currentEditorSelection: () => ({ left: 2, right: 3 }),
    draw() {},
  };
  vm.runInNewContext(`${helpers}\neditAt({ i: 1, v: 7 });`, context);

  assert.deepEqual(Array.from(context.state.data), [0, 0, 0, 0, 0]);
  assert.equal(context.state.samplesEdited, false);
});

test('generated waveshapes replace only the active selected sample range', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helper = source.slice(
    source.indexOf('function normalizeEditorSelection('),
    source.indexOf('function currentEditorSelection()'),
  ) + source.slice(
    source.indexOf('function waveformGenerationRange('),
    source.indexOf('function generate('),
  );
  const result = vm.runInNewContext(
    `${helper}
    const range = waveformGenerationRange(6, { left: 2, right: 4 }, 6);
    ({ range, values: mergeGeneratedSamples([0, 1, 2, 3, 4, 5], [20, 30, 40], range, 6) });`,
  );

  assert.deepEqual(
    { left: result.range.left, right: result.range.right, scoped: result.range.scoped },
    { left: 2, right: 4, scoped: true },
  );
  assert.deepEqual(Array.from(result.values), [0, 1, 20, 30, 40, 5]);
});

test('waveshape generation spans the selected range and preserves surrounding samples', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helpers = source.slice(
    source.indexOf('function normalizeEditorSelection('),
    source.indexOf('function currentEditorSelection()'),
  ) + source.slice(
    source.indexOf('function waveformGenerationRange('),
    source.indexOf('function cloneWaveform('),
  );
  const context = {
    state: {
      type: 'sine', samples: 6, data: [10, 11, 12, 13, 14, 15],
      high: 1, low: -1, phase: 0, cycles: 1, frequency: 1,
      duty: 50, symmetry: 50, rcTau: 5, riseTime: 0, fallTime: 0,
      noiseColor: 'white',
    },
    currentEditorSelection: () => ({ left: 1, right: 4 }),
    applyFilters: (values) => values,
    waveformDurationMs: () => 1000,
    serialBitPattern: () => [],
    serialSettings: () => ({ baud: 1 }),
    ARBDRAW_WAVEFORM_SHAPES: {},
    updateFunctionSelect() {},
    pushHistory() {},
    draw() {},
    renderSamples() {},
    persistCurrentSettings() {},
    $: () => ({ classList: { contains: () => true } }),
  };
  vm.runInNewContext(`${helpers}\ngenerate('sine', false, false);`, context);

  assert.equal(context.state.data[0], 10);
  assert.equal(context.state.data[5], 15);
  assert.ok(Math.abs(context.state.data[1]) < 1e-12);
  assert.ok(Math.abs(context.state.data[2] - Math.sqrt(3) / 2) < 1e-12);
  assert.ok(Math.abs(context.state.data[3] + Math.sqrt(3) / 2) < 1e-12);
  assert.ok(Math.abs(context.state.data[4]) < 1e-12);
});

test('generation falls back to the whole record without a valid selection-sized buffer', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helper = source.slice(
    source.indexOf('function normalizeEditorSelection('),
    source.indexOf('function currentEditorSelection()'),
  ) + source.slice(
    source.indexOf('function waveformGenerationRange('),
    source.indexOf('function generate('),
  );
  const result = vm.runInNewContext(
    `${helper}
    const noSelection = waveformGenerationRange(4, null, 4);
    const resizedRecord = waveformGenerationRange(4, { left: 1, right: 2 }, 6);
    ({ noSelection, resizedRecord,
       values: mergeGeneratedSamples([8, 8, 8, 8], [1, 2, 3, 4], noSelection, 4) });`,
  );

  for (const range of [result.noSelection, result.resizedRecord]) {
    assert.deepEqual(
      { left: range.left, right: range.right, scoped: range.scoped },
      { left: 0, right: 3, scoped: false },
    );
  }
  assert.deepEqual(Array.from(result.values), [1, 2, 3, 4]);
});

test('selection scope is used by waveshape and property generation but not record-level changes', () => {
  const editor = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const properties = fs.readFileSync(path.join(root, 'js/properties.js'), 'utf8');
  const filters = fs.readFileSync(path.join(root, 'js/filters.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(editor, /scopeSelection \? currentEditorSelection\(\) : null/);
  assert.match(editor, /state\.data = mergeGeneratedSamples\(/);
  assert.match(properties, /if \(waveformChanged\) \{\s*generate\(state\.type/);
  assert.match(properties, /generate\(state\.type, true, true, false\)/);
  assert.match(filters, /generate\(state\.type, true, true, false\)/);
  assert.match(html, /Selection · edits scoped/);
});
