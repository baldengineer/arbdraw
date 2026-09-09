const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness({ profileId = 'owon-xdg3000', playing = false } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: id === 'awgProfileSelect' ? profileId : '',
        disabled: false,
        textContent: '',
        title: '',
        attributes: {},
        classList: {
          contains: () => true,
          toggle() {},
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
      });
    }
    return elements.get(id);
  };
  const calls = { play: 0, stop: 0 };
  const playback = {
    playing,
    async play() {
      calls.play++;
    },
    stop() {
      calls.stop++;
      this.playing = false;
    },
  };
  class ResizeObserver {
    observe() {}
  }
  const context = vm.createContext({
    ARBDRAW_AUDIO_PLAYBACK: playback,
    ResizeObserver,
    canvas: {},
    scopeCanvas: {},
    state: { data: [0, 1], sampleRate: 0.048, cycles: 1, frequency: 1000, type: 'sine' },
    $: element,
    resize() {},
    drawScope() {},
    resizeCanvas() {},
    renderDocument() {},
    generate() {},
    ensureSerialPeriodCoversPayload() {},
    showToast() {},
  });
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  vm.runInContext(source, context);
  return { button: element('playWaveformBtn'), calls, context, element, playback };
}

test('Play is disabled unless the Audio AWG profile is selected', () => {
  const { button, context, element } = createHarness();

  context.updateAudioPlaybackButton();
  assert.equal(button.disabled, true);
  assert.match(button.title, /Audio AWG profile/);

  element('awgProfileSelect').value = 'audio';
  context.updateAudioPlaybackButton();
  assert.equal(button.disabled, false);
});

test('Stop remains enabled and stops playback regardless of profile', async () => {
  const { button, calls, context, playback } = createHarness({ playing: true });

  context.updateAudioPlaybackButton();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '■ Stop');

  await button.onclick();
  assert.equal(calls.stop, 1);
  assert.equal(playback.playing, false);
});

test('the click handler refuses playback outside the Audio profile', async () => {
  const { button, calls } = createHarness();

  await button.onclick();
  assert.equal(calls.play, 0);
  assert.equal(button.disabled, true);
});
