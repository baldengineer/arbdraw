const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness() {
  const listeners = {};
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: '',
        classList: { add() {}, remove() {} },
        contains() { return false; },
      });
    }
    return elements.get(id);
  };
  const calls = { closeTimingUnitMenus: 0 };
  const context = vm.createContext({
    $: element,
    document: {
      documentElement: { dataset: {} },
      querySelectorAll: () => [],
      addEventListener(type, listener) { listeners[type] = listener; },
    },
    localStorage: { getItem: () => null, setItem() {} },
    window: { addEventListener() {} },
    setTimeout() {},
    closePropertyContextMenu() {},
    closeAmplitudeUnitMenu() {},
    closeVoltageUnitMenu() {},
    closeTimingUnitMenus() { calls.closeTimingUnitMenus++; },
    closeScopeVoltageUnitMenu() {},
    closeScopePositionUnitMenu() {},
    closeScopeTimeUnitMenu() {},
    closeScopeDivisionMenu() {},
    closeScopeZoomMenu() {},
    closeFunctionSelectMenu() {},
  });
  const source = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
  vm.runInContext(source, context);
  return { calls, listeners };
}

test('pointer down in the transition-time unit menu does not dismiss it', () => {
  const { calls, listeners } = createHarness();
  const target = {
    closest(selector) {
      return selector.includes('#transitionTimeUnitMenu') ? {} : null;
    },
  };

  listeners.pointerdown({ target });

  assert.equal(calls.closeTimingUnitMenus, 0);
});

test('pointer down on a transition-time unit button does not dismiss its menu', () => {
  const { calls, listeners } = createHarness();
  const target = {
    closest(selector) {
      return selector.includes('.transition-time-unit-button') ? {} : null;
    },
  };

  listeners.pointerdown({ target });

  assert.equal(calls.closeTimingUnitMenus, 0);
});

test('View menu follows Edit and retains all project views', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const views = fs.readFileSync(path.join(__dirname, '../js/views.js'), 'utf8');
  const project = fs.readFileSync(path.join(__dirname, '../js/project.js'), 'utf8');
  const help = fs.readFileSync(path.join(__dirname, '../js/help.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../includes/styles.css'), 'utf8');

  assert.match(views, /'#fileMenu'\)\.after\(viewPicker\)/);
  assert.match(project, /fileMenu\.after\(editMenuAnchor\)/);
  assert.match(html, /id="fileBtn"[^>]*>File<\/button>/);
  assert.match(views, /viewPickerButton\.textContent = 'View'/);
  assert.match(project, /editButton\.textContent = 'Edit'/);
  assert.match(help, /helpButton\.textContent = 'Help'/);
  assert.doesNotMatch(`${html}\n${views}\n${project}\n${help}`, /menu-chevron/);
  assert.match(views, /prepareItem\(tab, 'menuitemradio'\)/);
  assert.match(views, /addViewSubmenu\('theme', 'Theme'/);
  assert.match(views, /addViewSubmenu\('rendering', 'Rendering'/);
  assert.match(views, /role: 'menuitemcheckbox'/);
  assert.doesNotMatch(html, /id="waveformModePicker"|class="section theme-section"/);
  assert.doesNotMatch(html, /id="lowPassFilterEnabled"/);
  for (const id of ['editorTab', 'waveformTab', 'samplesTab', 'jsonTab'])
    assert.match(html, new RegExp(`id="${id}"`));
  assert.match(styles, /\.project-actions \.view-picker-menu\{top:calc\(100% \+ 8px\);right:auto;left:0/);
});

test('mobile document order places AWG controls after waveform properties', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../includes/styles.css'), 'utf8');
  const editorColumnEnd = html.indexOf('</section>');
  const inspectorEnd = html.indexOf('</aside>');

  assert.ok(html.indexOf('id="viewerControls"') < editorColumnEnd);
  assert.ok(html.indexOf('id="editorControls"') > inspectorEnd);
  assert.match(styles, /grid-template-rows:minmax\(0,1fr\) auto/);
  assert.match(styles, /\.inspector \{[^}]*grid-row:1 \/ span 2/);
  assert.match(styles, /#editorControls\{grid-column:1;grid-row:2\}/);
});

test('Arbitrary edit tools sit beside the mode switch without zoom buttons', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../includes/styles.css'), 'utf8');
  const modeBar = html.slice(html.indexOf('<div class="editor-mode-bar">'), html.indexOf('<div class="editor-waveform-stage">'));

  assert.ok(modeBar.indexOf('id="advancedModeBtn"') < modeBar.indexOf('id="toolrail"'));
  assert.match(modeBar, /id="advancedModeBtn"[^>]*>Arbitrary<\/button>/);
  assert.match(modeBar, /id="toolrail"/);
  assert.doesNotMatch(modeBar, /id="zoomIn"|id="zoomOut"/);
  for (const tool of ['pointer', 'selection', 'pencil', 'erase'])
    assert.match(modeBar, new RegExp(`data-tool="${tool}"`));
  assert.doesNotMatch(modeBar, /editorModeDescription/);
  assert.match(styles, /\[data-editor-mode="basic"\] \.toolrail/);
  assert.match(html, /class="section filters-section" data-property-panel="filters"/);
  assert.doesNotMatch(styles, /\[data-editor-mode="basic"\][^{]*\.filters-section/);
  assert.match(styles, /\.editor-mode-bar \.toolrail\{[^}]*flex-direction:row/);
});
