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
  button.textContent = playing ? '■ Stop' : audioProfileSelected ? '▶ Play' : 'Send';
  button.classList.toggle('playing', playing);
  button.classList.toggle('send', !playing && !audioProfileSelected);
  button.disabled = false;
  button.title = playing
    ? 'Stop browser audio playback'
    : audioProfileSelected
      ? 'Play waveform through browser audio'
      : 'Send waveform to AWG';
  button.setAttribute('aria-pressed', String(playing));
}

function updateAudioVolume(value) {
  const volume = ARBDRAW_AUDIO_PLAYBACK.setVolume(Number(value) / 100);
  $('audioVolumeValue').textContent = `${Math.round(volume * 100)}%`;
}

function closeAudioVolumeControl() {
  const panel = $('audioVolumePanel'), button = $('audioVolumeBtn');
  panel.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (globalThis.document?.activeElement === $('audioVolumeInput')) button.focus();
}

$('audioVolumeBtn').onclick = () => {
  const panel = $('audioVolumePanel'), button = $('audioVolumeBtn'), open = panel.hidden;
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open) $('audioVolumeInput').focus();
};
$('audioVolumeInput').oninput = (event) => updateAudioVolume(event.target.value);

$('playWaveformBtn').onclick = async () => {
  if (ARBDRAW_AUDIO_PLAYBACK.playing) {
    ARBDRAW_AUDIO_PLAYBACK.stop();
    updateAudioPlaybackButton();
    return;
  }
  if ($('awgProfileSelect')?.value !== 'audio') {
    globalThis.openSendToAwgDialog?.();
    return;
  }
  try {
    const output = globalThis.ARBDRAW_SEQUENCE?.hasSegments() ? recordState() : state;
    await ARBDRAW_AUDIO_PLAYBACK.play(output.data, {
      sampleRateHz: output.sampleRate * 1e6,
      durationSeconds: Math.max(1, output.cycles) / output.frequency,
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
