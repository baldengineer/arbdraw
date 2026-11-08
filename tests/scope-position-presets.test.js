const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function harness() {
  const document = { activeElement: null }, elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set(), listeners = {}, attributes = {};
      elements.set(id, {
        id, value: '', style: {}, offsetWidth: 220, offsetHeight: 80,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
        setAttribute: (name, value) => { attributes[name] = value; },
        getAttribute: name => attributes[name],
        getBoundingClientRect: () => ({ left: 10, bottom: 40 }),
        focus() { document.activeElement = this; },
        addEventListener(name, handler) { listeners[name] = handler; },
        dispatch(name, event = {}) {
          const details = { preventDefault() {}, stopPropagation() {}, ...event };
          listeners[name]?.(details);
        },
      });
    }
    return elements.get(id);
  };
  const state = { data: [-2, 0, 6], high: 20, low: -20, history: ['unchanged'] };
  const scopeState = { verticalPosition: 9, voltsPerDiv: 2, timePerDivMs: 3, timeStartMs: 4 };
  let draws = 0;
  const context = vm.createContext({
    document, state, scopeState, $: element, scopePositionUnitScale: 1,
    innerWidth: 800, innerHeight: 600,
    drawScope() { draws++; }, closePropertyMenus() {},
  });
  const source = fs.readFileSync(require.resolve('../js/scope-view.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function scopePositionMidpoint('),
    source.indexOf("$('scopeVoltageUnitBtn').onclick")), context);
  return { context, element, state, scopeState, document, draws: () => draws };
}

test('presets use sample extrema, honor voltage units, and leave waveform and zoom unchanged', () => {
  for (const scale of [1, 0.001]) {
    const f = harness();
    f.context.scopePositionUnitScale = scale;
    const before = JSON.stringify(f.state);
    f.element('scopePositionMidpointBtn').onclick();
    assert.equal(f.scopeState.verticalPosition, 2);
    assert.equal(Number(f.element('scopeVerticalPosition').value), 2 / scale);
    assert.equal(f.draws(), 1);
    f.element('scopePositionZeroBtn').onclick();
    assert.equal(f.scopeState.verticalPosition, 0);
    assert.equal(Number(f.element('scopeVerticalPosition').value), 0);
    assert.equal(JSON.stringify(f.state), before);
    assert.deepEqual(f.scopeState, { verticalPosition: 0, voltsPerDiv: 2, timePerDivMs: 3, timeStartMs: 4 });
    assert.equal(f.document.activeElement, f.element('scopeVerticalPosition'));
  }
});

test('midpoint handles DC, negative signals, empty data and large finite voltages', () => {
  const f = harness();
  for (const [data, low, high, expected] of [
    [[3, 3, 3], -10, 10, 3],
    [[-8, -6, -2], -10, 10, -5],
    [[], -4, 8, 2],
    [[NaN, Infinity], -4, 8, 2],
    [[1e308, 1e308], 0, 0, 1e308],
  ]) {
    Object.assign(f.state, { data, low, high });
    assert.equal(f.context.scopePositionMidpoint(), expected);
  }
});

test('sequence midpoint uses the complete record, not just the selected segment', () => {
  const f = harness();
  const record = { data: [-10, 2, 20], low: -10, high: 20 };
  f.context.ARBDRAW_SEQUENCE = { hasSegments: () => true };
  f.context.recordState = () => record;
  const before = JSON.stringify(record);
  f.element('scopePositionMidpointBtn').onclick();
  assert.equal(f.scopeState.verticalPosition, 5);
  assert.equal(JSON.stringify(record), before);
});

test('right-click menu stays within the viewport and closes after choosing a preset', () => {
  const f = harness(), menu = f.element('scopePositionPresetMenu'), input = f.element('scopeVerticalPosition');
  let prevented = false;
  input.dispatch('contextmenu', { clientX: 799, clientY: 599, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(menu.classList.contains('open'), true);
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  assert.equal(menu.style.left, '580px');
  assert.equal(menu.style.top, '520px');
  f.element('scopePositionZeroBtn').onclick();
  assert.equal(menu.classList.contains('open'), false);
  assert.equal(input.getAttribute('aria-expanded'), 'false');
});

test('keyboard opens and navigates the presets; Escape restores focus without changing position', () => {
  const f = harness(), menu = f.element('scopePositionPresetMenu'), input = f.element('scopeVerticalPosition');
  for (const key of [{ key: 'F10', shiftKey: true }, { key: 'ContextMenu' }]) {
    input.dispatch('keydown', key);
    assert.equal(menu.classList.contains('open'), true);
    assert.equal(menu.style.left, '10px');
    assert.equal(menu.style.top, '40px');
    assert.equal(f.document.activeElement, f.element('scopePositionZeroBtn'));
    menu.dispatch('keydown', { key: 'ArrowDown' });
    assert.equal(f.document.activeElement, f.element('scopePositionMidpointBtn'));
    menu.dispatch('keydown', { key: 'ArrowUp' });
    assert.equal(f.document.activeElement, f.element('scopePositionZeroBtn'));
    menu.dispatch('keydown', { key: 'Escape' });
    assert.equal(menu.classList.contains('open'), false);
    assert.equal(f.document.activeElement, input);
    assert.equal(f.scopeState.verticalPosition, 9);
  }
});
