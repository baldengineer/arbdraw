const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/property-panels.js'), 'utf8');
const storageKey = 'arbdraw-property-panels';

function createHarness(storage = new Map()) {
  const panels = ['function', 'amplitude', 'timing', 'serial', 'filters', 'theme']
    .map((name) => ({
      dataset: { propertyPanel: name },
      open: true,
      addEventListener(event, handler) { this.listeners[event] = handler; },
      listeners: {},
    }));
  const context = vm.createContext({
    document: { querySelectorAll: () => panels },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
    },
  });
  vm.runInContext(source, context);
  return { context, panels, storage };
}

test('property sections restore their disclosure state and persist changes', () => {
  const storage = new Map([[storageKey, JSON.stringify({ timing: false, filters: false })]]);
  const { panels } = createHarness(storage);
  assert.equal(panels.find((panel) => panel.dataset.propertyPanel === 'timing').open, false);
  assert.equal(panels.find((panel) => panel.dataset.propertyPanel === 'filters').open, false);
  assert.equal(panels.find((panel) => panel.dataset.propertyPanel === 'amplitude').open, true);

  const amplitude = panels.find((panel) => panel.dataset.propertyPanel === 'amplitude');
  amplitude.open = false;
  amplitude.listeners.toggle();
  const restored = createHarness(storage).panels;
  assert.equal(restored.find((panel) => panel.dataset.propertyPanel === 'amplitude').open, false);
  assert.equal(restored.find((panel) => panel.dataset.propertyPanel === 'filters').open, false);
});

test('New and Default reset all property sections to expanded', () => {
  const storage = new Map([[storageKey, JSON.stringify({ function: false, timing: false })]]);
  const { context, panels } = createHarness(storage);
  vm.runInContext('resetPropertyPanels()', context);
  assert.ok(panels.every((panel) => panel.open));
  assert.ok(Object.values(JSON.parse(storage.get(storageKey))).every(Boolean));

  const project = fs.readFileSync(path.join(__dirname, '../js/project.js'), 'utf8');
  const properties = fs.readFileSync(path.join(__dirname, '../js/properties.js'), 'utf8');
  assert.match(project, /confirmNewBtn'\)\.onclick[\s\S]*resetPropertyPanels\(\)/);
  assert.match(properties, /defaultAllBtn'\)\.onclick[\s\S]*resetStoredSettings\(\)[\s\S]*resetPropertyPanels\(\)/);
});

test('unavailable or malformed storage keeps sections usable', () => {
  const storage = new Map([[storageKey, '{bad json']]);
  const { panels } = createHarness(storage);
  assert.ok(panels.every((panel) => panel.open));
});
