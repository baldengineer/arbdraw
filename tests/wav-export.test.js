const assert = require('node:assert/strict');
const test = require('node:test');
const { waveformWav } = require('../js/wav-export.js');

test('exports a mono 48 kHz PCM header and normalized samples in order', () => {
  const buffer = waveformWav({ values: [-2, -1, 0, 1, 2], sampleRateHz: 48000 });
  const bytes = Buffer.from(buffer), view = new DataView(buffer);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(view.getUint32(4, true), buffer.byteLength - 8);
  assert.equal(bytes.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(28, true), 96000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(bytes.toString('ascii', 36, 40), 'data');
  assert.equal(view.getUint32(40, true), 10);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => view.getInt16(44 + i * 2, true)),
    [-32768, -16384, 0, 16384, 32767]);
});

test('exports silence and the maximum audio preset length', () => {
  const buffer = waveformWav({ values: new Float32Array(100000), sampleRateHz: 48000 });
  assert.equal(buffer.byteLength, 200044);
  assert.ok(new Uint8Array(buffer, 44).every(value => value === 0));
});

test('rejects invalid samples and rates that would corrupt the WAV header', () => {
  for (const values of [[], [NaN], [Infinity]])
    assert.throws(() => waveformWav({ values, sampleRateHz: 48000 }), /finite samples/);
  for (const sampleRateHz of [0, NaN, Infinity, 7999, 384001, 1250000000, 2500000000])
    assert.throws(() => waveformWav({ values: [0], sampleRateHz }), /sample rate/);
});
