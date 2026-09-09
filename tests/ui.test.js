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
