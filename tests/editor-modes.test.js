const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness({ url = 'https://example.test/arbdraw/' } = {}) {
  const elements = new Map();
  const listeners = {};
  const currentUrl = new URL(url);
  const location = {
    href: currentUrl.href,
    hash: currentUrl.hash,
    pathname: currentUrl.pathname,
    search: currentUrl.search,
  };
  const replacedUrls = [];
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
    document: {
      documentElement: { dataset: {} },
      addEventListener(type, listener) { listeners[type] = listener; },
    },
    history: {
      state: null,
      replaceState(_state, _title, nextUrl) {
        const resolved = new URL(nextUrl, location.href);
        replacedUrls.push(resolved.href);
        Object.assign(location, {
          href: resolved.href,
          hash: resolved.hash,
          pathname: resolved.pathname,
          search: resolved.search,
        });
      },
    },
    location,
    URLSearchParams,
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
  return { calls, context, element, listeners, location, replacedUrls, state };
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

test('mode=arbitrary opens a bookmark directly in Arbitrary mode', () => {
  const { context, location, replacedUrls, state } = createHarness({
    url: 'https://example.test/arbdraw/?waveshape=square&mode=arbitrary#editor',
  });

  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);
  assert.equal(state.tool, 'pencil');
  assert.equal(location.search, '?waveshape=square&mode=arbitrary');
  assert.deepEqual(replacedUrls, []);
});

test('mode selection updates its URL parameter without disturbing the rest of the URL', () => {
  const { element, location, replacedUrls } = createHarness({
    url: 'https://example.test/arbdraw/?waveshape=triangle#editor',
  });

  element('advancedModeBtn').onclick();
  assert.equal(location.search, '?waveshape=triangle&mode=arbitrary');
  assert.equal(location.hash, '#editor');

  element('basicModeBtn').onclick();
  assert.equal(location.search, '?waveshape=triangle');
  assert.equal(location.hash, '#editor');
  assert.equal(replacedUrls.length, 2);
});

test('Space switches to Arbitrary mode outside interactive controls', () => {
  const { context, listeners } = createHarness();
  let prevented = 0;
  const target = { matches: () => false };

  listeners.keydown({ key: ' ', target, preventDefault() { prevented++; } });
  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), true);
  assert.equal(prevented, 1);
});

test('the Arbitrary shortcut preserves native Space behavior in controls and with modifiers', () => {
  const { context, listeners } = createHarness();
  let prevented = 0;
  const preventDefault = () => { prevented++; };

  listeners.keydown({ key: ' ', target: { matches: () => true }, preventDefault });
  listeners.keydown({ key: ' ', target: { matches: () => false }, ctrlKey: true, preventDefault });
  listeners.keydown({ key: ' ', target: { matches: () => false }, repeat: true, preventDefault });

  assert.equal(context.ARBDRAW_EDITOR_MODES.isAdvanced(), false);
  assert.equal(prevented, 0);
});

test('Arbitrary uses its current default color, not a stale stored color', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/waveform-editor.js'), 'utf8');
  const colorFunction = source.match(/function editorWaveformColor\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(colorFunction);
  const defaultsSource = fs.readFileSync(path.join(__dirname, '../js/defaults.js'), 'utf8');
  const coreSource = fs.readFileSync(path.join(__dirname, '../js/core.js'), 'utf8');
  let savedSettings = JSON.stringify({ arbitraryEditorColor: '#000000' });
  const context = vm.createContext({
    document: { documentElement: { dataset: { editorMode: 'basic' } } },
    localStorage: {
      getItem() { return savedSettings; },
      setItem(_key, value) { savedSettings = value; },
    },
  });
  vm.runInContext(defaultsSource, context);
  vm.runInContext(coreSource, context);
  vm.runInContext(colorFunction, context);

  assert.equal(vm.runInContext('editorWaveformColor()', context), context.ARBDRAW_DEFAULTS.editorColor);
  context.document.documentElement.dataset.editorMode = 'advanced';
  assert.equal(vm.runInContext('editorWaveformColor()', context), context.ARBDRAW_DEFAULTS.arbitraryEditorColor);
  assert.equal(JSON.parse(savedSettings).arbitraryEditorColor, context.ARBDRAW_DEFAULTS.arbitraryEditorColor);
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
