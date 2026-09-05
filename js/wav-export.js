// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
(function exposeWavExport(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ARBDRAW_WAV_EXPORT = api;
})(globalThis, function createWavExport() {
  function waveformWav({ values, sampleRateHz }) {
    if (!values.length || !Array.from(values).every(Number.isFinite))
      throw new Error('The waveform must contain finite samples to export WAV.');
    const rate = Math.round(sampleRateHz);
    // Limit audio exports to audio rates rather than the hardware AWG rates.
    if (!Number.isFinite(rate) || rate < 8000 || rate > 384000)
      throw new Error('WAV export requires a sample rate between 8 and 384 kHz. Select the Audio profile for 48 kHz, then export again.');
    const dataSize = values.length * 2;
    if (dataSize > 0xffffffff - 36) throw new Error('The waveform is too large for WAV.');
    const buffer = new ArrayBuffer(44 + dataSize), view = new DataView(buffer);
    const text = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, dataSize, true);
    let peak = 0;
    for (const value of values) peak = Math.max(peak, Math.abs(value));
    for (let i = 0; i < values.length; i++) {
      const value = peak ? values[i] / peak : 0;
      view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    return buffer;
  }
  return { waveformWav };
});
