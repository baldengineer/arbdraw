const assert = require('node:assert/strict');
const test = require('node:test');
const { prepareAudioSamples } = require('../js/audio-playback.js');

test('prepares normalized browser-rate samples with interpolation', () => {
  const samples = prepareAudioSamples({
    values: [-2, 0, 2],
    sourceSampleRateHz: 3,
    targetSampleRateHz: 6,
  });
  assert.equal(samples.length, 6);
  assert.deepEqual(Array.from(samples, (value) => Number(value.toFixed(6))), [-1, -0.6, -0.2, 0.2, 0.6, 1]);
});

test('keeps silence silent and rejects invalid playback inputs', () => {
  assert.deepEqual(
    Array.from(prepareAudioSamples({ values: [0, 0], sourceSampleRateHz: 48_000, targetSampleRateHz: 48_000 })),
    [0, 0],
  );
  assert.throws(() => prepareAudioSamples({ values: [0, NaN], sourceSampleRateHz: 48_000, targetSampleRateHz: 48_000 }), /finite samples/);
  assert.throws(() => prepareAudioSamples({ values: [0, 1], sourceSampleRateHz: 0, targetSampleRateHz: 48_000 }), /sample rate/);
  assert.throws(() => prepareAudioSamples({ values: new Float32Array(31), sourceSampleRateHz: 1, targetSampleRateHz: 48_000 }), /limited to 30 seconds/);
});

test('configures browser playback to loop until stopped', async () => {
  const sources = [];
  class FakeAudioContext {
    state = 'running';
    sampleRate = 48_000;
    destination = {};
    createBuffer() {
      return { copyToChannel() {} };
    }
    createBufferSource() {
      const source = {
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
        loop: false,
        onended: null,
      };
      sources.push(source);
      return source;
    }
  }
  const playback = require('../js/audio-playback.js').create({ AudioContext: FakeAudioContext });
  await playback.play([0, 1], { sampleRateHz: 48_000 });
  assert.equal(sources[0].loop, true);
  playback.stop();
  assert.equal(playback.playing, false);
});
