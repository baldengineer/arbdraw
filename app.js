// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// ArbDraw bootstrap. Feature code lives in the ordered scripts under js/.
new ResizeObserver(resize).observe(canvas);
new ResizeObserver(() => {
  if (!$('waveformView').classList.contains('hidden')) resizeCanvas(scopeCanvas, drawScope);
}).observe(scopeCanvas);

function updateAudioPlaybackButton() {
  const button = $('playWaveformBtn'), playing = ARBDRAW_AUDIO_PLAYBACK.playing;
  button.textContent = playing ? '■ Stop' : '▶ Play';
  button.classList.toggle('playing', playing);
  button.title = playing ? 'Stop browser audio playback' : 'Play waveform through browser audio';
  button.setAttribute('aria-pressed', String(playing));
}

$('playWaveformBtn').onclick = async () => {
  if (ARBDRAW_AUDIO_PLAYBACK.playing) {
    ARBDRAW_AUDIO_PLAYBACK.stop();
    updateAudioPlaybackButton();
    return;
  }
  try {
    await ARBDRAW_AUDIO_PLAYBACK.play(state.data, {
      sampleRateHz: state.sampleRate * 1e6,
      onEnded: updateAudioPlaybackButton,
    });
    updateAudioPlaybackButton();
  } catch (error) {
    updateAudioPlaybackButton();
    showToast(error.message);
  }
};

renderDocument();
if (state.type === 'serial') ensureSerialPeriodCoversPayload();
generate();
