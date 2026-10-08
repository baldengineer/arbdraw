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
        setAttribute(name, value) { attributes[name] = value; },
        classList: { contains(name) { return name === 'hidden'; } },
      });
    }
    return elements.get(id);
  };
  const state = {
    tool: 'pencil',
    samplesEdited: false,
    filters: { enabled: true, noiseEnabled: false, lowPassEnabled: false, smoothingEnabled: false },
    data: [0, 1, 0],
  };
  const calls = { clear: 0, draw: 0, closeFilters: 0 };
  const context = vm.createContext({
    $: element,
    state,
    document: { documentElement: { dataset: {} } },
    clearEditorSelection() { calls.clear++; },
    setEditorTool(tool) { state.tool = tool; },
    closeFiltersMenu() { calls.closeFilters++; },
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

test('Basic keeps advanced project content visible and offers a return to Advanced', () => {
  const { context, element, state } = createHarness();
  state.samplesEdited = true;
  state.filters.noiseEnabled = true;
  context.ARBDRAW_EDITOR_MODES.forOpenedProject();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);

  element('basicModeBtn').onclick();
  assert.equal(element('advancedContentNotice').hidden, false);
  assert.equal(element('advancedContentText').textContent, 'Point edits and filters are active.');
  assert.equal(state.samplesEdited, true);
  assert.equal(state.filters.noiseEnabled, true);

  element('editInAdvancedBtn').onclick();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);
  assert.equal(element('advancedContentNotice').hidden, true);
});

test('opening an unedited project and creating a new project start in Basic', () => {
  const { context, element, state } = createHarness();
  context.ARBDRAW_EDITOR_MODES.forOpenedProject();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), false);

  state.filters.smoothingEnabled = true;
  context.ARBDRAW_EDITOR_MODES.forOpenedProject();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);

  state.filters.smoothingEnabled = false;
  context.ARBDRAW_EDITOR_MODES.forNewProject();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), false);

  element('advancedSamplesBtn').onclick();
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);
  assert.equal(element('sampleEditHint').hidden, true);
});
