const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      const attributes = {};
      elements.set(id, {
        attributes,
        hidden: false,
        textContent: '',
        open: false,
        setAttribute(name, value) { attributes[name] = value; },
        classList: { contains(name) { return name === 'hidden'; } },
        showModal() { this.open = true; },
        close() { this.open = false; },
      });
    }
    return elements.get(id);
  };
  const state = {
    tool: 'pencil',
    type: 'sine',
    high: 2,
    samplesEdited: false,
    filters: { enabled: true, noiseEnabled: false, smoothingEnabled: false },
    data: [0, 1, 0],
    history: [{ data: [0, 1, 0] }],
    redo: [],
  };
  const calls = { clear: 0, draw: 0, generate: 0, persist: 0, filtersRendered: 0, filtersAtGenerate: null };
  const context = vm.createContext({
    $: element,
    state,
    document: { documentElement: { dataset: {} } },
    clearEditorSelection() { calls.clear++; },
    setEditorTool(tool) { state.tool = tool; },
    normalizeFilterSettings() { return { enabled: true, noiseEnabled: false, smoothingEnabled: false }; },
    generate() { calls.generate++; calls.filtersAtGenerate = { ...state.filters }; state.data = [state.high, state.high, state.high]; state.samplesEdited = false; },
    pushHistory() { state.history.push({ data: [...state.data] }); },
    renderFilterControls() { calls.filtersRendered++; },
    refreshScopeVertical() {},
    persistCurrentSettings() { calls.persist++; },
    renderSamples() {},
    draw() { calls.draw++; },
  });
  const source = fs.readFileSync(path.join(__dirname, '../js/editor-modes.js'), 'utf8');
  vm.runInContext(source, context);
  return { calls, context, element, state };
}

test('a new editor starts in Basic and switching modes preserves waveform data', () => {
  const { context, element, state } = createHarness();
  const data = state.data;
  assert.equal(context.document.documentElement.dataset.editorMode, 'basic');
  assert.equal(state.tool, 'pointer');
  assert.equal(element('basicModeBtn').attributes['aria-pressed'], 'true');

  element('advancedModeBtn').onclick();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);
  assert.equal(state.tool, 'pencil');
  assert.equal(element('advancedModeBtn').attributes['aria-pressed'], 'true');

  element('basicModeBtn').onclick();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), false);
  assert.equal(state.data, data);
  assert.deepEqual(state.data, [0, 1, 0]);
});

test('switching to Basic asks before discarding Arbitrary point edits and preserves filters', () => {
  const { calls, context, element, state } = createHarness();
  state.samplesEdited = true;
  state.filters.noiseEnabled = true;
  state.data = [9, 9, 9];
  state.history.push({ data: [9, 9, 9] });
  state.redo.push({ data: [8, 8, 8] });
  context.ARBDRAW_EDITOR_MODES.forOpenedProject();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);

  element('basicModeBtn').onclick();
  assert.equal(element('basicModeConfirmDialog').open, true);
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);
  assert.equal(state.samplesEdited, true);
  assert.equal(state.filters.noiseEnabled, true);
  assert.deepEqual(state.data, [9, 9, 9]);

  element('basicModeConfirmDialog').close();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);
  assert.equal(calls.generate, 0);

  element('basicModeBtn').onclick();
  element('confirmBasicModeBtn').onclick();
  assert.equal(element('basicModeConfirmDialog').open, false);
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), false);
  assert.deepEqual(state.data, [2, 2, 2]);
  assert.equal(state.samplesEdited, false);
  assert.equal(state.filters.noiseEnabled, true);
  assert.equal(calls.filtersAtGenerate.noiseEnabled, true);
  assert.equal(state.history.length, 1);
  assert.equal(state.redo.length, 0);
  assert.equal(calls.generate, 1);
  assert.equal(calls.persist, 1);
  assert.equal(calls.filtersRendered, 1);
});

test('opening a filtered project and creating a new project start in Basic', () => {
  const { context, element, state } = createHarness();
  context.ARBDRAW_EDITOR_MODES.forOpenedProject();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), false);

  state.filters.smoothingEnabled = true;
  context.ARBDRAW_EDITOR_MODES.forOpenedProject();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), false);

  element('advancedModeBtn').onclick();
  element('basicModeBtn').onclick();
  assert.equal(element('basicModeConfirmDialog').open, false);
  assert.equal(state.filters.smoothingEnabled, true);
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), false);

  state.filters.smoothingEnabled = false;
  context.ARBDRAW_EDITOR_MODES.forNewProject();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), false);

  element('advancedSamplesBtn').onclick();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);
  assert.equal(element('sampleEditHint').hidden, true);
});
