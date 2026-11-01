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

function harness(maximum = 100000) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, classList: { contains: () => true },
      setAttribute() {}, addEventListener() {},
    });
    return elements.get(id);
  };
  const messages = [], confirmations = [];
  const context = vm.createContext({
    window: { confirm(message) { confirmations.push(message); return true; } },
    $: element, TextEncoder, selectedAwgProfile: { sampleDepth: { max: maximum } },
    document: { activeElement: null, getElementById: element }, editorViewport: {},
    currentEditorSelection: () => null, clearEditorSelection() {},
    finishWaveformPreview() {}, refreshScope() {},
    setEditorMode(mode) { context.mode = mode; },
    renderDocument() { context.syncSequence(); },
    renderAwgTiming() {
      const output = context.recordState();
      vm.runInContext(`projectDocument.AWG.sampleCount = ${output.samples};
        projectDocument.AWG.sampleRateMSa = ${output.sampleRate};`, context);
    },
    renderVoltageLevels() {}, renderFrequency() {}, renderTiming() {},
    draw() { context.syncSequence(); }, renderSamples() {},
    persistCurrentSettings() {}, updateFunctionSelect() {},
    applyFilters: (values) => values,
    showToast(message) { messages.push(message); },
  });
  for (const file of ['js/defaults.js', 'js/core.js', 'js/waveform-shapes.js'])
    vm.runInContext(read(file), context);
  vm.runInContext(slice('js/serial-properties.js', 'function serialSettings()', 'function updateSerialPropertiesVisibility('), context);
  vm.runInContext(slice('js/waveform-editor.js', 'function normalizeEditorSelection(', 'function currentEditorSelection()')
    + slice('js/waveform-editor.js', 'function waveformGenerationRange(', 'function resizeCanvas(')
    + slice('js/waveform-editor.js', 'function undoWaveform()', "$('undoBtn').textContent"), context);
  vm.runInContext(read('js/sequence.js'), context);
  vm.runInContext(slice('js/project.js', 'function parseProject(', 'function loadProject('), context);
  const run = (code) => vm.runInContext(code, context);
  run('state.samples = 16; state.frequency = 1000; state.cycles = 1; state.phase = 0; generate("sine");');
  return { context, run, messages, confirmations, element };
}

test('Add Segments divides the record equally, regenerates independent sources, and enters Arbitrary', () => {
  const { context, run, confirmations } = harness();
  context.addSequenceSegment();
  assert.equal(context.mode, 'advanced');
  assert.equal(run('state.activeSegment'), 1);
  assert.equal(run('sequenceSegments().length'), 2);
  assert.deepEqual(Array.from(run('sequenceSegments().map(segment => segment.sampleCount)')), [8, 8]);
  assert.equal(run('JSON.stringify(sequenceSegments()[0].values) === JSON.stringify(sequenceSegments()[1].values)'), true);
  assert.equal(run('sequenceSegments()[0].values === sequenceSegments()[1].values'), false);
  assert.equal(run('sequenceSegments()[0].filters === sequenceSegments()[1].filters'), false);
  assert.equal(run('recordState().samples'), 16);
  assert.equal(run('recordState().frequency'), 1000);
  assert.equal(run('state.frequency'), 2000);
  assert.equal(confirmations.length, 0);
});

test('canceling Add Segments preserves arbitrary samples, selection, mode, and undo history', () => {
  const { context, run, confirmations } = harness();
  run('state.data[3] = 2.125; state.samplesEdited = true; pushHistory();');
  context.currentEditorSelection = () => ({ left: 2, right: 5 });
  context.window.confirm = (message) => { confirmations.push(message); return false; };
  const before = run('JSON.stringify({ projectDocument, history: state.history, redo: state.redo, active: state.activeSegment })');
  context.addSequenceSegment();
  assert.equal(run('JSON.stringify({ projectDocument, history: state.history, redo: state.redo, active: state.activeSegment })'), before);
  assert.equal(context.mode, undefined);
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /lose any arbitrary edits/);
});

test('choosing a waveshape changes only the new segment and adds a single undo step', () => {
  const { context, run } = harness();
  const historyLength = run('state.history.length');
  context.addSequenceSegment('square');
  assert.deepEqual(Array.from(run('sequenceSegments().map(segment => segment.type)')), ['sine', 'square']);
  assert.equal(run('state.history.length'), historyLength + 1);
  const before = run('JSON.stringify(projectDocument.waveform)');
  context.addSequenceSegment('triangle');
  assert.deepEqual(Array.from(run('sequenceSegments().map(segment => segment.type)')), ['sine', 'square', 'triangle']);
  assert.equal(run('state.type'), 'triangle');
  assert.equal(run('state.samples'), 5);
  run('undoWaveform();');
  assert.equal(run('JSON.stringify(projectDocument.waveform)'), before);
});

test('accepting Add Segments regenerates edited samples and undo restores them', () => {
  const { context, run, confirmations } = harness();
  run('state.data[3] = 123; state.samplesEdited = true; pushHistory();');
  const original = run('JSON.stringify(projectDocument.waveform)');
  context.addSequenceSegment();
  assert.equal(confirmations.length, 1);
  assert.equal(run('sequenceSegments().every(segment => !segment.samplesEdited && !segment.values.includes(123))'), true);
  run('undoWaveform();');
  assert.equal(run('JSON.stringify(projectDocument.waveform)'), original);
  run('redoWaveform();');
  assert.deepEqual(Array.from(run('sequenceSegments().map(segment => segment.sampleCount)')), [8, 8]);
});

test('each addition warns about edits in any segment, including from full-record view', () => {
  for (const overview of [false, true]) {
    const { context, run, confirmations } = harness();
    context.addSequenceSegment();
    context.selectSequenceSegment(0);
    run('state.data[3] = 123; state.samplesEdited = true; pushHistory();');
    context.selectSequenceSegment(1);
    if (overview) context.ARBDRAW_SEQUENCE.showOverview();
    const before = run('JSON.stringify({ projectDocument, history: state.history, redo: state.redo, active: state.activeSegment })');
    context.window.confirm = (message) => { confirmations.push(message); return false; };
    context.addSequenceSegment();
    assert.equal(confirmations.length, 1);
    assert.equal(run('JSON.stringify({ projectDocument, history: state.history, redo: state.redo, active: state.activeSegment })'), before);
    context.window.confirm = (message) => { confirmations.push(message); return true; };
    context.addSequenceSegment();
    assert.equal(confirmations.length, 2);
    assert.deepEqual(Array.from(run('sequenceSegments().map(segment => segment.sampleCount)')), [6, 5, 5]);
    assert.equal(run('sequenceSegments().every(segment => !segment.samplesEdited && segment.values.length === segment.sampleCount && !segment.values.includes(123))'), true);
    run('state.data[0] = 123; state.samplesEdited = true; pushHistory();');
    context.addSequenceSegment();
    assert.equal(confirmations.length, 3);
    assert.deepEqual(Array.from(run('sequenceSegments().map(segment => segment.sampleCount)')), [4, 4, 4, 4]);
    assert.equal(run('recordState().samples'), 16);
    assert.equal(run('recordState().sampleRate'), 0.016);
    assert.equal(run('recordState().frequency'), 1000);
    context.addSequenceSegment();
    assert.equal(confirmations.length, 3);
  }
});

test('too few total points explains the minimum and preserves the waveform', () => {
  const { context, run, messages, confirmations } = harness();
  run('state.samples = 4; generate("sine");');
  context.addSequenceSegment();
  const before = run('JSON.stringify(projectDocument)');
  context.addSequenceSegment();
  assert.equal(run('JSON.stringify(projectDocument)'), before);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /at least 6/);
  assert.equal(confirmations.length, 0);
});

test('waveshape and direct point edits stay inside the selected segment', () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  const original = run('JSON.stringify(sequenceSegments()[0])');
  run('generate("square"); state.data[3] = 2.125; state.samplesEdited = true; pushHistory();');
  assert.equal(run('JSON.stringify(sequenceSegments()[0])'), original);
  assert.equal(run('recordState().data[11]'), 2.125);
  context.selectSequenceSegment(0);
  assert.equal(run('state.type'), 'sine');
  assert.equal(run('state.samplesEdited'), false);
  context.selectSequenceSegment(1);
  assert.equal(run('state.type'), 'square');
  assert.equal(run('state.samplesEdited'), true);
});

test('new segments inherit the selected source including serial and filter settings', () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  run('editableWaveform().serial.payload = "hello"; state.filters.smoothingEnabled = true; generate("dc");');
  context.addSequenceSegment();
  assert.equal(run('state.type'), 'dc');
  assert.equal(run('editableWaveform().serial.payload'), 'hello');
  assert.equal(run('state.filters.smoothingEnabled'), true);
  assert.equal(run('sequenceSegments()[1].serial === sequenceSegments()[2].serial'), false);
});

test('sample count and source frequency share one clock without changing neighboring samples', () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  const original = run('JSON.stringify(sequenceSegments()[0].values)');
  run('state.samples = 32; generate("sine");');
  assert.equal(run('state.frequency'), 500);
  assert.equal(run('recordState().samples'), 40);
  assert.equal(run('recordState().duration'), 2.5);
  run('state.frequency = 2000; generate("sine");');
  assert.equal(run('state.samples'), 8);
  assert.equal(run('recordState().samples'), 16);
  assert.equal(run('JSON.stringify(sequenceSegments()[0].values)'), original);
});

test('the full-record view is read only and full outputs include every segment', () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  run('generate("dc");');
  const record = run('JSON.stringify(recordState().data)');
  assert.equal(context.ARBDRAW_SEQUENCE.showOverview(), true);
  assert.equal(context.sequenceOverview(), true);
  assert.equal(run('state.samples'), 16);
  assert.equal(run('generate("square")'), false);
  assert.equal(run('JSON.stringify(state.data)'), record);
  context.selectSequenceSegment(0);
  assert.equal(run('state.samples'), 8);
  assert.equal(run('JSON.stringify(recordState().data)'), record);
});

test('undo and redo preserve segment sources, samples, and independent snapshots', () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  run('generate("square");');
  const record = run('JSON.stringify(recordState().data)');
  run('undoWaveform();');
  assert.equal(run('state.type'), 'sine');
  run('undoWaveform();');
  assert.equal(run('sequenceSegments()'), null);
  run('redoWaveform(); redoWaveform();');
  assert.equal(run('JSON.stringify(recordState().data)'), record);
  run('state.data[0] = 123;');
  assert.notEqual(run('state.history.at(-1).segments[1].values[0]'), 123);
});

test('saving and parsing retain every segment and reconstruct the combined sample buffer', () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  run('generate("square"); state.samplesEdited = true; renderAwgTiming();');
  const expected = run('JSON.stringify(recordState().data)');
  run('projectDocument = parseProject(JSON.parse(JSON.stringify(projectDocument))); state.activeSegment = null;');
  assert.equal(run('sequenceSegments().length'), 2);
  assert.equal(run('sequenceSegments()[1].type'), 'square');
  assert.equal(run('sequenceSegments()[1].samplesEdited'), true);
  assert.equal(run('JSON.stringify(state.data)'), expected);
  assert.equal(run('projectDocument.AWG.frequencyHz'), 1000);
});

test('malformed sequence imports fail explicitly instead of silently dropping segments', () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  run('renderAwgTiming();');
  for (const mutation of [
    'raw.waveform.segments = []',
    'raw.waveform.segments[0].sampleCount = 17',
    'raw.waveform.segments[0].values[0] = null',
    'raw.waveform.segments[0].segments = []',
    'raw.AWG.sampleCount = 40',
  ]) {
    assert.throws(() => run(`{ const raw = JSON.parse(JSON.stringify(projectDocument)); ${mutation}; parseProject(raw); }`), /sequence|segment|Sequence/i);
  }
});

test('adding segments at the profile limit redistributes all points without exceeding the limit', () => {
  const { context, run, messages } = harness(40);
  run('state.samples = 40; generate("sine");');
  context.addSequenceSegment();
  context.addSequenceSegment();
  assert.deepEqual(Array.from(run('sequenceSegments().map(segment => segment.sampleCount)')), [14, 13, 13]);
  assert.equal(run('recordState().samples'), 40);
  assert.equal(messages.length, 0);
  run('state.samples = 1000; generate("sine");');
  assert.equal(run('state.samples'), 13);
  assert.equal(run('recordState().samples'), 40);
});

test('removing the penultimate segment keeps the surviving waveform and can be undone', () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  run('generate("square");');
  const expected = run('JSON.stringify(state.data)');
  context.removeSequenceSegment(0);
  assert.equal(run('sequenceSegments()'), null);
  assert.equal(run('state.type'), 'square');
  assert.equal(run('JSON.stringify(state.data)'), expected);
  run('undoWaveform();');
  assert.equal(run('sequenceSegments().length'), 2);
});

test('serial segments use the shared clock for exact bit widths without a duplicated endpoint', () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  run(`state.samples = 16; editableWaveform().serial.binaryPattern = '1010';
    editableWaveform().serial.baud = 4000; generate('serial');`);
  const high = run('state.sourceHigh'), low = run('state.sourceLow');
  assert.deepEqual(Array.from(run('state.data')), [
    ...Array(4).fill(high), ...Array(4).fill(low), ...Array(4).fill(high), ...Array(4).fill(low),
  ]);
  context.currentEditorSelection = () => ({ left: 4, right: 11 });
  run('generate("serial");');
  assert.deepEqual(Array.from(run('state.data.slice(4, 12)')), [...Array(4).fill(high), ...Array(4).fill(low)]);
});

test('CSV, SVG, and WAV exports use the combined record while a segment is selected', async () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  run('generate("square");');
  const expected = Array.from(run('recordState().data'));
  const downloads = [], rendered = {};
  Object.assign(context, {
    Blob,
    downloadBlob(blob, filename) { downloads.push({ blob, filename }); },
    ARBDRAW_SVG_EXPORT: { waveformSvg(options) { rendered.svg = options; return '<svg/>'; } },
    ARBDRAW_WAV_EXPORT: { waveformWav(options) { rendered.wav = options; return new ArrayBuffer(0); } },
  });
  context.document.querySelector = () => ({ value: 'Sequence test' });
  vm.runInContext(slice('js/project.js', 'function buildCsvRows(', 'function updateExportFormat('), context);
  run('downloadCsv(false, "sequence.csv"); downloadSvg("sequence.svg"); downloadWav("sequence.wav");');
  const rows = (await downloads[0].blob.text()).trim().split('\r\n');
  assert.equal(rows.length, 16);
  rows.forEach((row, i) => {
    const [time, voltage] = row.split(',').map(Number);
    assert.ok(Math.abs(time - i / 16000) < 1e-12);
    assert.equal(voltage, expected[i]);
  });
  assert.deepEqual(Array.from(rendered.svg.values), expected);
  assert.deepEqual(Array.from(rendered.wav.values), expected);
  assert.equal(rendered.wav.sampleRateHz, 16000);
});

test('leaving a sequence retains the selected source or the first source in full-record view', () => {
  for (const overview of [false, true]) {
    const { context, run } = harness();
    context.addSequenceSegment();
    run('generate("square");');
    if (overview) context.ARBDRAW_SEQUENCE.showOverview();
    context.leaveSequence();
    assert.equal(run('sequenceSegments()'), null);
    assert.equal(run('state.type'), overview ? 'sine' : 'square');
  }
});

test('segment exports contain only the requested segment with its own type and timing', async () => {
  const { context, run } = harness();
  context.addSequenceSegment();
  run('state.samples = 8; generate("square");');
  const downloads = [], rendered = {};
  Object.assign(context, {
    Blob,
    downloadBlob(blob) { downloads.push(blob); },
    ARBDRAW_SVG_EXPORT: { waveformSvg(options) { rendered.svg = options; return '<svg/>'; } },
    ARBDRAW_WAV_EXPORT: { waveformWav(options) { rendered.wav = options; return new ArrayBuffer(0); } },
  });
  context.document.querySelector = () => ({ value: 'Sequence test' });
  vm.runInContext(slice('js/project.js', 'function buildCsvRows(', 'function updateExportFormat('), context);
  const before = run('JSON.stringify(projectDocument)');
  for (const index of [0, 1]) {
    const expected = Array.from(run(`sequenceSegments()[${index}].values`));
    run(`{ const output = exportWaveformData(${index});
      downloadCsv(true, "segment.csv", true, output);
      downloadSvg("segment.svg", output); downloadWav("segment.wav", output); }`);
    const csv = await downloads.at(-3).text();
    assert.ok(csv.includes(`Waveform type,${index === 0 ? 'Sine wave' : 'Square wave'}\r\n`));
    assert.ok(csv.includes('Frequency (Hz),2000\r\n'));
    const rows = csv.split('Time (s),Voltage (V)\r\n')[1].trim().split('\r\n');
    assert.equal(rows.length, expected.length);
    rows.forEach((row, i) => {
      const [time, voltage] = row.split(',').map(Number);
      assert.ok(Math.abs(time - i / 16000) < 1e-12);
      assert.equal(voltage, expected[i]);
    });
    assert.deepEqual(Array.from(rendered.svg.values), expected);
    assert.equal(rendered.svg.durationSeconds, (expected.length - 1) / 16000);
    assert.deepEqual(Array.from(rendered.wav.values), expected);
    assert.equal(rendered.wav.sampleRateHz, 16000);
  }
  assert.equal(run('JSON.stringify(projectDocument)'), before);
  assert.throws(() => run('exportWaveformData(2)'), /Select a segment/);
  assert.throws(() => run('exportWaveformData(-1)'), /Select a segment/);
});
