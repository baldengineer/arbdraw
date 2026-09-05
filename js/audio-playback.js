// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Browser audio playback for the current waveform buffer.
(function exposeAudioPlayback(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ARBDRAW_AUDIO_PLAYBACK = api;
})(globalThis, function createAudioPlayback() {
  const MAX_PLAYBACK_SECONDS = 30;

  function finiteSamples(values) {
    if (!values || !values.length || !Array.from(values).every(Number.isFinite))
      throw new Error('The waveform must contain finite samples to play audio.');
    return values;
  }

  function prepareAudioSamples({ values, sourceSampleRateHz, targetSampleRateHz }) {
    finiteSamples(values);
    const sourceRate = Number(sourceSampleRateHz),
      targetRate = Number(targetSampleRateHz);
    if (!Number.isFinite(sourceRate) || sourceRate <= 0)
      throw new Error('The waveform sample rate must be positive to play audio.');
    if (!Number.isFinite(targetRate) || targetRate <= 0)
      throw new Error('The browser audio sample rate is unavailable.');
    const durationSeconds = values.length / sourceRate;
    if (durationSeconds > MAX_PLAYBACK_SECONDS)
      throw new Error(`Playback is limited to ${MAX_PLAYBACK_SECONDS} seconds.`);
    const outputLength = Math.max(1, Math.round(durationSeconds * targetRate)),
      output = new Float32Array(outputLength);
    let peak = 0;
    for (const value of values) peak = Math.max(peak, Math.abs(value));
    for (let index = 0; index < output.length; index++) {
      const position = output.length === 1 ? 0 : (index * (values.length - 1)) / (output.length - 1),
        left = Math.floor(position),
        right = Math.min(values.length - 1, left + 1),
        fraction = position - left,
        value = values[left] + (values[right] - values[left]) * fraction;
      output[index] = peak ? Math.max(-1, Math.min(1, value / peak)) : 0;
    }
    return output;
  }

  function create({ AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext } = {}) {
    let context = null,
      source = null;

    function stop() {
      if (!source) return;
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      source.disconnect();
      source = null;
    }

    async function play(values, { sampleRateHz, onEnded } = {}) {
      if (!AudioContext) throw new Error('This browser does not support Web Audio playback.');
      finiteSamples(values);
      stop();
      if (!context) context = new AudioContext();
      if (context.state === 'suspended') await context.resume();
      const samples = prepareAudioSamples({
        values,
        sourceSampleRateHz: sampleRateHz,
        targetSampleRateHz: context.sampleRate,
      });
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.copyToChannel(samples, 0);
      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(context.destination);
      source.onended = () => {
        if (!source) return;
        source.disconnect();
        source = null;
        onEnded?.();
      };
      source.start();
    }

    return { play, stop, get playing() { return source !== null; } };
  }

  const defaultPlayback = create();
  return {
    MAX_PLAYBACK_SECONDS,
    prepareAudioSamples,
    create,
    play: defaultPlayback.play,
    stop: defaultPlayback.stop,
    get playing() { return defaultPlayback.playing; },
  };
});
