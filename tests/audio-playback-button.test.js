const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createHarness({ profileId = 'owon-xdg3000', playing = false } = {}) {
  const elements = new Map();
  const classes = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      classes.set(id, new Set());
      elements.set(id, {
        value: id === 'awgProfileSelect' ? profileId : '',
        hidden: id === 'audioVolumePanel',
        disabled: false,
        textContent: '',
        title: '',
        attributes: {},
        classList: {
          contains: (name) => classes.get(id).has(name),
          toggle(name, force) {
            if (force) classes.get(id).add(name);
            else classes.get(id).delete(name);
          },
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        focus() {},
      });
    }
    return elements.get(id);
  };
  const calls = { play: 0, stop: 0, openSendToAwgDialog: 0 };
  const playback = {
    playing,
    volume: 1,
    async play() {
      calls.play++;
    },
    setVolume(value) {
      this.volume = value;
      return value;
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
    openSendToAwgDialog() { calls.openSendToAwgDialog++; },
  });
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  vm.runInContext(source, context);
  return { button: element('playWaveformBtn'), calls, context, element, playback };
}

test('the action is an orange Send button unless the Audio AWG profile is selected', () => {
  const { button, context, element } = createHarness();

  context.updateAudioPlaybackButton();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Send');
  assert.equal(button.classList.contains('send'), true);
  assert.match(button.title, /Send waveform to AWG/);

  element('awgProfileSelect').value = 'audio';
  context.updateAudioPlaybackButton();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '▶ Play');
  assert.equal(button.classList.contains('send'), false);
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

test('the Send button opens the Send to AWG dialog outside the Audio profile', async () => {
  const { button, calls } = createHarness();

  await button.onclick();
  assert.equal(calls.play, 0);
  assert.equal(calls.openSendToAwgDialog, 1);
});

test('loading a project refreshes the Play or Send action for its AWG profile', () => {
  const projectSource = fs.readFileSync(path.join(__dirname, '../js/project.js'), 'utf8');
  const renderDocumentSource = projectSource.match(/function renderDocument\(\) \{[\s\S]*?\n\}/)?.[0];

  assert.ok(renderDocumentSource);
  assert.match(renderDocumentSource, /updateAudioPlaybackButton\?\.\(\)/);
});

test('the volume control maps its percentage to browser audio volume', () => {
  const { context, element, playback } = createHarness();

  context.updateAudioVolume(35);

  assert.equal(playback.volume, 0.35);
  assert.equal(element('audioVolumeValue').textContent, '35%');
});

test('the volume button expands and collapses the slider', () => {
  const { context, element } = createHarness();

  element('audioVolumeBtn').onclick();
  assert.equal(element('audioVolumePanel').hidden, false);
  assert.equal(element('audioVolumeBtn').attributes['aria-expanded'], 'true');

  element('audioVolumeBtn').onclick();
  assert.equal(element('audioVolumePanel').hidden, true);
  assert.equal(element('audioVolumeBtn').attributes['aria-expanded'], 'false');
  assert.equal(typeof context.closeAudioVolumeControl, 'function');
});
