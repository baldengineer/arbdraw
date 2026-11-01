const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function buttonFixture() {
  const listeners = {}, additions = [], menus = [];
  const button = {
    setAttribute() {},
    addEventListener(name, callback) { listeners[name] = callback; },
  };
  const context = vm.createContext({
    $: () => button,
    addSequenceSegment(type) { additions.push(type); },
    openFunctionSelectMenu(trigger, callback) { menus.push({ trigger, callback }); },
  });
  const source = read('js/sequence.js');
  vm.runInContext(source.slice(source.indexOf('function bindSegmentAddButton(')), context);
  return {
    button, additions, menus,
    emit(name, values = {}) {
      const event = { preventDefault() { this.prevented = true; }, ...values };
      listeners[name](event);
      return event;
    },
  };
}

test('clicking opens the waveshape menu and adds nothing until a shape is chosen', () => {
  const f = buttonFixture();
  f.button.onclick();
  assert.equal(f.menus.length, 1);
  assert.equal(f.menus[0].trigger, f.button);
  assert.deepEqual(f.additions, []);
  f.menus[0].callback('triangle');
  assert.deepEqual(f.additions, ['triangle']);
  f.button.onclick();
  assert.equal(f.menus.length, 2);
  assert.deepEqual(f.additions, ['triangle']);
});

test('ArrowDown opens the same picker without adding a segment', () => {
  const f = buttonFixture();
  assert.equal(f.emit('keydown', { key: 'ArrowDown' }).prevented, true);
  assert.equal(f.menus.length, 1);
  assert.deepEqual(f.additions, []);
});

function menuFixture() {
  let focused = null;
  const trigger = () => ({ attrs: {}, setAttribute(key, value) { this.attrs[key] = value; },
    getBoundingClientRect: () => ({ left: 100, bottom: 100 }), focus() { focused = this; } });
  const sourceButton = trigger(), addButton = trigger(), classes = new Set(), generated = [];
  const options = ['sine', 'square', 'triangle'].map((type) => ({
    dataset: { wave: type }, attrs: {}, querySelector: () => ({}),
    setAttribute(key, value) { this.attrs[key] = value; }, focus() { focused = this; },
  }));
  const menu = {
    style: {}, offsetHeight: 300,
    classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); } },
    querySelectorAll: () => options,
    querySelector: () => options.find((option) => option.attrs['aria-checked'] === 'true'),
    addEventListener(name, callback) { this[name] = callback; },
  };
  const context = vm.createContext({
    $: (id) => id === 'functionSelectBtn' ? sourceButton : menu,
    document: { get activeElement() { return focused; } },
    innerWidth: 1000, innerHeight: 800, state: { type: 'sine' }, drawMini() {},
    generate(type) { generated.push(type); return true; },
    renderWaveformProperties() {}, refreshScopeTime() {},
  });
  const source = read('js/waveform-editor.js');
  vm.runInContext(source.slice(source.indexOf('let functionSelectTrigger'), source.indexOf('function setEditorTool(')), context);
  return { context, sourceButton, addButton, menu, options, generated, classes };
}

test('the same waveshape options dispatch to either segment creation or source generation', () => {
  const f = menuFixture(), additions = [];
  f.context.openFunctionSelectMenu(f.addButton, (type) => additions.push(type));
  assert.equal(f.addButton.attrs['aria-expanded'], 'true');
  assert.deepEqual(f.generated, []);
  f.options[2].onclick();
  assert.deepEqual(additions, ['triangle']);
  assert.deepEqual(f.generated, []);
  assert.equal(f.classes.has('open'), false);
  assert.equal(f.addButton.attrs['aria-expanded'], 'false');
  f.sourceButton.onclick({ stopPropagation() {} });
  f.options[1].onclick();
  assert.deepEqual(f.generated, ['square']);
  assert.deepEqual(additions, ['triangle']);
});

test('dismissing the picker adds nothing and resets its action before source selection', () => {
  const f = menuFixture(), additions = [];
  f.context.openFunctionSelectMenu(f.addButton, (type) => additions.push(type));
  f.menu.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(f.classes.has('open'), false);
  assert.deepEqual(additions, []);
  f.sourceButton.onclick({ stopPropagation() {} });
  f.options[0].onclick();
  assert.deepEqual(f.generated, ['sine']);
  assert.deepEqual(additions, []);
});
