const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('amplitude and timing modes switch independently without changing the waveform', () => {
  const state = { high: 8, low: -2, frequency: 1000 };
  const inputs = Object.fromEntries(
    ['highInput', 'lowInput', 'amplitudeInput', 'offsetInput', 'frequencyInput', 'periodInput']
      .map((id) => [id, { value: '' }]),
  );
  const button = (kind, mode) => ({
    dataset: { [`${kind}Mode`]: mode },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this[name] = handler; },
  });
  const amplitudeButtons = [button('amplitude', 'amplitude'), button('amplitude', 'levels')];
  const timingButtons = [button('timing', 'frequency'), button('timing', 'period')];
  const field = (kind, mode) => ({ dataset: { [`${kind}Field`]: mode }, hidden: false });
  const amplitudeFields = [field('amplitude', 'levels'), field('amplitude', 'amplitude'),
    field('amplitude', 'amplitude'), field('amplitude', 'levels')];
  const timingFields = [field('timing', 'frequency'), field('timing', 'period')];
  const groups = {
    '[data-amplitude-mode]': amplitudeButtons,
    '[data-amplitude-field]': amplitudeFields,
    '[data-timing-mode]': timingButtons,
    '[data-timing-field]': timingFields,
  };
  const context = vm.createContext({
    state,
    $: (id) => inputs[id],
    document: { querySelectorAll: (selector) => groups[selector] || [] },
    displayVoltage: (_id, value) => value,
    displayAmplitude: (value) => value,
    renderFrequency: () => {
      inputs.frequencyInput.value = state.frequency;
      inputs.periodInput.value = 1 / state.frequency;
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../js/property-modes.js'), 'utf8'), context,
  );

  amplitudeButtons[1].click();
  assert.deepEqual(amplitudeFields.map((item) => item.hidden), [false, true, true, false]);
  assert.deepEqual(amplitudeButtons.map((item) => item.attributes['aria-pressed']), ['false', 'true']);
  assert.equal(inputs.highInput.value, 8);
  assert.equal(inputs.lowInput.value, -2);

  timingButtons[1].click();
  assert.deepEqual(timingFields.map((item) => item.hidden), [true, false]);
  assert.deepEqual(timingButtons.map((item) => item.attributes['aria-pressed']), ['false', 'true']);
  assert.equal(inputs.periodInput.value, 0.001);
  assert.deepEqual(amplitudeFields.map((item) => item.hidden), [false, true, true, false]);

  amplitudeButtons[0].click();
  assert.equal(inputs.amplitudeInput.value, 10);
  assert.equal(inputs.offsetInput.value, 3);
  assert.deepEqual(state, { high: 8, low: -2, frequency: 1000 });
});
