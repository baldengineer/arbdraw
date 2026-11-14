const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function harness() {
  const elements = new Map(), windowEvents = {};
  let focused;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      listeners: {}, attributes: {}, style: {}, open: false,
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute(name, value) { this.attributes[name] = value; },
      getBoundingClientRect() { return { left: parseFloat(this.style.left) || 24,
        top: parseFloat(this.style.top) || 72, width: 520, height: 600 }; },
      getClientRects() { return [{}]; },
      show() { this.open = true; },
      close() { this.open = false; this.listeners.close(); },
      focus() { focused = id; },
      closest() { return null; },
      setPointerCapture(id) { this.capture = id; },
      hasPointerCapture(id) { return this.capture === id; },
      releasePointerCapture() { this.capture = null; },
    });
    return elements.get(id);
  };
  const window = { innerWidth: 1200, innerHeight: 900,
    addEventListener(name, handler) { windowEvents[name] = handler; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/math-reference.js'), 'utf8'), {
    document: { getElementById: element }, window,
  });
  const dialog = element('mathReferenceDialog'), trigger = element('mathReferenceBtn');
  const handle = element('mathReferenceHandle'), close = element('closeMathReferenceBtn');
  return { dialog, trigger, handle, close, window, windowEvents, focused: () => focused };
}

test('reference opens modelessly and closes with focus returned to its trigger', () => {
  const f = harness();
  f.trigger.listeners.click(); // Harness deliberately has no showModal method.
  assert.equal(f.dialog.open, true);
  assert.equal(f.trigger.attributes['aria-expanded'], 'true');
  assert.equal(f.focused(), 'closeMathReferenceBtn');
  f.close.listeners.click();
  assert.equal(f.dialog.open, false);
  assert.equal(f.trigger.attributes['aria-expanded'], 'false');
  assert.equal(f.focused(), 'mathReferenceBtn');
});

test('Escape inside reference closes it without reaching editor shortcuts', () => {
  const f = harness();
  let prevented = false, stopped = false;
  f.trigger.listeners.click();
  f.dialog.listeners.keydown({ key: 'Escape', preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; } });
  assert.equal(f.dialog.open, false);
  assert.ok(prevented && stopped);
});

test('dragging stays within the viewport and ends on pointer cancellation', () => {
  const f = harness();
  f.trigger.listeners.click();
  f.handle.listeners.pointerdown({ button: 0, target: f.handle, pointerId: 1,
    clientX: 30, clientY: 80, preventDefault() {} });
  f.handle.listeners.pointermove({ pointerId: 1, clientX: 1500, clientY: -20 });
  assert.equal(f.dialog.style.left, '668px');
  assert.equal(f.dialog.style.top, '12px');
  f.handle.listeners.pointercancel({ pointerId: 1 });
  f.handle.listeners.pointermove({ pointerId: 1, clientX: 30, clientY: 80 });
  assert.equal(f.dialog.style.left, '668px');
  assert.equal(f.handle.capture, null);
});

test('keyboard movement and resize keep the reference reachable', () => {
  const f = harness();
  f.trigger.listeners.click();
  f.handle.listeners.keydown({ target: f.handle, key: 'ArrowRight', shiftKey: true, preventDefault() {} });
  assert.equal(f.dialog.style.left, '64px');
  f.window.innerWidth = 550;
  f.window.innerHeight = 630;
  f.windowEvents.resize();
  assert.equal(f.dialog.style.left, '18px');
  assert.equal(f.dialog.style.top, '18px');
});
