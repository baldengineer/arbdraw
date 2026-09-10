// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// ArbDraw bootstrap. Feature code lives in the ordered scripts under js/.
new ResizeObserver(resize).observe(canvas);
new ResizeObserver(() => {
  if (!$('waveformView').classList.contains('hidden')) resizeCanvas(scopeCanvas, drawScope);
}).observe(scopeCanvas);

function updateAudioPlaybackButton() {
  const button = $('playWaveformBtn'),
    playing = ARBDRAW_AUDIO_PLAYBACK.playing,
    audioProfileSelected = $('awgProfileSelect')?.value === 'audio';
  button.textContent = playing ? '■ Stop' : '▶ Play';
  button.classList.toggle('playing', playing);
  button.disabled = !playing && !audioProfileSelected;
  button.title = playing
    ? 'Stop browser audio playback'
    : audioProfileSelected
      ? 'Play waveform through browser audio'
      : 'Select the Audio AWG profile to enable playback';
  button.setAttribute('aria-pressed', String(playing));
}

function updateAudioVolume(value) {
  const volume = ARBDRAW_AUDIO_PLAYBACK.setVolume(Number(value) / 100);
  $('audioVolumeValue').value = `${Math.round(volume * 100)}%`;
  $('audioVolumeValue').textContent = `${Math.round(volume * 100)}%`;
}

$('audioVolumeInput').oninput = (event) => updateAudioVolume(event.target.value);

$('playWaveformBtn').onclick = async () => {
  if (ARBDRAW_AUDIO_PLAYBACK.playing) {
    ARBDRAW_AUDIO_PLAYBACK.stop();
    updateAudioPlaybackButton();
    return;
  }
  if ($('awgProfileSelect')?.value !== 'audio') {
    updateAudioPlaybackButton();
    return;
  }
  try {
    await ARBDRAW_AUDIO_PLAYBACK.play(state.data, {
      sampleRateHz: state.sampleRate * 1e6,
      durationSeconds: Math.max(1, state.cycles) / state.frequency,
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
