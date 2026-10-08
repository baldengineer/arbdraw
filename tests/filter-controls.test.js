const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const listeners = new Map();
      const attributes = new Map();
      elements.set(id, {
        value: '', checked: false, disabled: false,
        addEventListener(name, callback) { listeners.set(name, callback); },
        dispatch(name, event = {}) { listeners.get(name)?.(event); },
        setCustomValidity(message) { this.validationMessage = message; },
        setAttribute(name, value) { attributes.set(name, value); },
        removeAttribute(name) { attributes.delete(name); },
        getAttribute(name) { return attributes.get(name); },
        reportValidity() { this.reportedValidity = true; },
        blur() {},
      });
    }
    return elements.get(id);
  }
  const state = {
    type: 'sine', high: 5, low: -5, sampleRate: 1,
    filters: {
      enabled: true, noiseEnabled: false, noisePercent: 1,
      smoothingEnabled: false, smoothingWindowPoints: 5,
    },
  };
  const calls = { generate: 0, persist: 0, confirm: true };
  const context = vm.createContext({
    $: element, state, DEFAULT_VALUES: { noisePercent: 1, noisePercentMax: 10 },
    ARBDRAW_WAVEFORM_SHAPES: { smoothSamples: (values) => values },
    confirmWaveformReplacement() { return calls.confirm; },
    generate() { calls.generate++; },
    refreshScopeVertical() {},
    persistCurrentSettings() { calls.persist++; },
  });
  const source = fs.readFileSync(path.join(__dirname, '../js/filters.js'), 'utf8');
  vm.runInContext(source, context);
  return { calls, context, element, state };
}

test('checkboxes enable their value inputs and regenerate once per change', () => {
  const { calls, element, state } = createHarness();
  const noise = element('noiseFilterEnabled');
  const noiseInput = element('noiseFilterInput');
  assert.equal(noiseInput.disabled, true);
  noise.checked = true;
  noise.dispatch('change');
  assert.equal(state.filters.noiseEnabled, true);
  assert.equal(noiseInput.disabled, false);
  assert.equal(calls.generate, 1);

  noiseInput.value = '2.5';
  noiseInput.dispatch('change');
  assert.equal(state.filters.noisePercent, 2.5);
  assert.equal(calls.generate, 2);
  assert.equal(calls.persist, 2);

  noise.checked = false;
  noise.dispatch('change');
  assert.equal(state.filters.noiseEnabled, false);
  assert.equal(noiseInput.disabled, true);
});

test('smoothing accepts odd window sizes and rejects even ones', () => {
  const { element, state } = createHarness();
  element('smoothingFilterEnabled').checked = true;
  element('smoothingFilterEnabled').dispatch('change');
  const window = element('smoothingFilterInput');
  window.value = '7';
  window.dispatch('change');
  assert.equal(state.filters.smoothingWindowPoints, 7);
  window.value = '8';
  window.dispatch('change');
  assert.equal(state.filters.smoothingWindowPoints, 7);
  assert.equal(window.getAttribute('aria-invalid'), 'true');
});

test('declining replacement restores filter controls without changing settings', () => {
  const { calls, element, state } = createHarness();
  calls.confirm = false;
  const noise = element('noiseFilterEnabled');
  noise.checked = true;
  noise.dispatch('change');
  assert.equal(state.filters.noiseEnabled, false);
  assert.equal(noise.checked, false);
  assert.equal(element('noiseFilterInput').disabled, true);
  assert.equal(calls.generate, 0);
});
