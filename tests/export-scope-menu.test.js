const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('export menu offers Full Record and only the currently selected numbered segment', () => {
  const elements = [], exports = [];
  class Element {
    constructor() {
      this.attributes = {}; this.listeners = {}; this.classes = new Set();
      this.classList = {
        contains: (name) => this.classes.has(name),
        toggle: (name, open) => open ? this.classes.add(name) : this.classes.delete(name),
      };
      elements.push(this);
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(event, handler) { this.listeners[event] = handler; }
    append() {}
    after() {}
    focus() { this.focused = true; }
  }
  const element = (id) => elements.find((item) => item.id === id) || Object.assign(new Element(), { id });
  const context = vm.createContext({
    document: { createElement: () => new Element() }, $: element,
    state: { activeSegment: null }, projectDocument: { waveform: { segments: [{}, {}, {}] } },
    openExportDialog: (index = null) => exports.push(index),
  });
  const source = fs.readFileSync(path.join(__dirname, '../js/project.js'), 'utf8');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/menus.js'), 'utf8'), context);
  vm.runInContext(source.slice(source.indexOf('const exportButton ='), source.indexOf("$('saveBtn').title"))
    + source.slice(source.indexOf('function refreshExportScopeMenu()'), source.indexOf("$('confirmExportBtn').onclick")), context);

  context.refreshExportScopeMenu();
  assert.equal(element('exportFullRecordBtn').textContent, 'Full Record');
  assert.equal(element('exportSegmentBtn').hidden, true);
  assert.equal(element('exportSegmentBtn').disabled, true);
  context.state.activeSegment = 1;
  context.setExportScopeMenuOpen(true);
  element('exportBtn').listeners.pointerenter({ pointerType: 'mouse' });
  element('exportBtn').onclick({ stopPropagation() {} });
  assert.equal(element('exportBtn').attributes['aria-expanded'], 'true');
  assert.equal(element('exportSegmentBtn').textContent, 'Segment 2');
  assert.equal(element('exportSegmentBtn').hidden, false);
  assert.equal(element('exportSegmentBtn').disabled, false);
  element('exportSegmentBtn').listeners.click();
  element('exportFullRecordBtn').listeners.click();
  assert.deepEqual(exports, [1, null]);
  context.state.activeSegment = 2;
  context.refreshExportScopeMenu();
  assert.equal(element('exportSegmentBtn').textContent, 'Segment 3');
  context.state.activeSegment = null;
  context.refreshExportScopeMenu();
  assert.equal(element('exportSegmentBtn').hidden, true);
  context.state.activeSegment = 9;
  context.refreshExportScopeMenu();
  assert.equal(element('exportSegmentBtn').hidden, true);
  delete context.projectDocument.waveform.segments;
  context.state.activeSegment = 1;
  context.refreshExportScopeMenu();
  assert.equal(element('exportSegmentBtn').hidden, true);
});
