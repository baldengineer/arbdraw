// Waveform generation, editable canvas rendering, presets, and history.
const canvas = document.querySelector('#waveCanvas');
const ctx = canvas.getContext('2d');
function generate(type = state.type, recordHistory = true) {
  state.type = type;
  const n = state.samples,
    mid = (state.high + state.low) / 2,
    amp = (state.high - state.low) / 2,
    phase = (state.phase * Math.PI) / 180,
    serialBits = type === 'serial' ? serialBitPattern() : null,
    serialBaud = type === 'serial' ? serialSettings().baud : null,
    bufferDurationSeconds = waveformDurationMs() / 1000;
  state.data = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1),
      p = (t * state.cycles + state.phase / 360) % 1;
    switch (type) {
      case 'sine':
        return mid + amp * Math.sin(2 * Math.PI * state.cycles * t + phase);
      case 'square':
        return p < state.duty / 100 ? state.high : state.low;
      case 'triangle':
        return mid + amp * (1 - 4 * Math.abs(p - 0.5));
      case 'ramp':
        return state.low + (state.high - state.low) * p;
      case 'pulse':
        return p < state.duty / 100 ? state.high : state.low;
      case 'dc':
        return mid;
      case 'noise':
        return mid + (Math.random() * 2 - 1) * amp;
      case 'serial':
        {
          const elapsedSeconds = (i / (n - 1)) * bufferDurationSeconds;
          const bitIndex = Math.floor(elapsedSeconds * serialBaud);
          if (bitIndex >= serialBits.length) return state.high;
          return serialBits[bitIndex] ? state.high : state.low;
        }
      default:
        return mid;
    }
  });
  if (recordHistory) pushHistory();
  draw();
  if (!$('samplesView').classList.contains('hidden')) renderSamples();
}
function cloneWaveform(source = projectDocument.waveform) {
  return {
    ...source,
    serial: { ...source.serial },
    values: [...source.values],
  };
}
function restoreWaveform(snapshot) {
  projectDocument.waveform = cloneWaveform(snapshot);
  renderDocument();
}
function pushHistory() {
  state.history.push(cloneWaveform());
  if (state.history.length > 30) state.history.shift();
  state.redo = [];
}
function resizeCanvas(target, render) {
  const r = target.getBoundingClientRect(),
    d = devicePixelRatio || 1;
  if (target.width !== Math.round(r.width * d) || target.height !== Math.round(r.height * d)) {
    target.width = Math.round(r.width * d);
    target.height = Math.round(r.height * d);
  }
  render();
}
function resize() {
  resizeCanvas(canvas, draw);
  if (!$('waveformView').classList.contains('hidden')) resizeCanvas(scopeCanvas, drawScope);
}
function voltageBounds() {
  if (state.high !== state.low) return { high: state.high, low: state.low };
  const span = Math.max(5, Math.abs(state.high));
  return { high: state.high + span, low: state.low - span };
}
function draw() {
  const w = canvas.width,
    h = canvas.height,
    d = devicePixelRatio || 1;
  if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#090d0f';
  ctx.fillRect(0, 0, w, h);
  const pad = { l: 58 * d, r: 18 * d, t: 20 * d, b: 39 * d },
    pw = w - pad.l - pad.r,
    ph = h - pad.t - pad.b,
    bounds = voltageBounds(),
    waveformDuration = waveformDurationMs(),
    timeUnit = axisTimeUnitFor(waveformDuration),
    voltageUnit = axisVoltageUnitFor(bounds.low, bounds.high);
  $('editorTimeAxisLabel').textContent = `TIME (${timeUnit.label})`;
  $('editorVoltageAxisLabel').textContent = `VOLTAGE (${voltageUnit.label})`;
  ctx.font = `${10 * d}px ui-monospace`;
  ctx.lineWidth = 1 * d;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let y = 0; y <= 8; y++) {
    const py = pad.t + (ph * y) / 8,
      val = (bounds.high - ((bounds.high - bounds.low) * y) / 8) / voltageUnit.scaleV;
    ctx.strokeStyle = y === 4 ? '#49605f' : '#223033';
    ctx.beginPath();
    ctx.moveTo(pad.l, py);
    ctx.lineTo(w - pad.r, py);
    ctx.stroke();
    ctx.fillStyle = '#718083';
    ctx.fillText(val.toFixed(1), pad.l - 9 * d, py);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let x = 0; x <= 10; x++) {
    const px = pad.l + (pw * x) / 10;
    ctx.strokeStyle = x === 0 ? '#405053' : '#1e2c2f';
    ctx.beginPath();
    ctx.moveTo(px, pad.t);
    ctx.lineTo(px, h - pad.b);
    ctx.stroke();
    ctx.fillStyle = '#718083';
    ctx.fillText(
      Number((((waveformDuration * x) / 10) / timeUnit.scaleMs).toPrecision(4)),
      px,
      h - pad.b + 10 * d,
    );
  }
  if (!state.data.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.l, pad.t, pw, ph);
  ctx.clip();
  ctx.strokeStyle = DEFAULT_VALUES.editorColor;
  ctx.shadowColor = DEFAULT_VALUES.editorColor;
  ctx.shadowBlur = 5 * d;
  ctx.lineWidth = 1.5 * d;
  ctx.beginPath();
  state.data.forEach((v, i) => {
    const x = pad.l + (pw * i) / (state.data.length - 1),
      y = pad.t + ((bounds.high - v) / (bounds.high - bounds.low)) * ph;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
  drawCustomPreview();
  if (!$('waveformView').classList.contains('hidden')) drawScope();
}
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect(),
    d = devicePixelRatio || 1,
    p = { l: 58 * d, r: 18 * d, t: 20 * d, b: 39 * d },
    x = (e.clientX - r.left) * d,
    y = (e.clientY - r.top) * d,
    pw = canvas.width - p.l - p.r,
    ph = canvas.height - p.t - p.b,
    bounds = voltageBounds();
  return {
    i: Math.max(0, Math.min(state.samples - 1, Math.round(((x - p.l) / pw) * (state.samples - 1)))),
    v: Math.max(
      bounds.low,
      Math.min(bounds.high, bounds.high - ((y - p.t) / ph) * (bounds.high - bounds.low)),
    ),
  };
}

function pointerIsNearWaveform(e) {
  if (!state.data.length) return false;
  const r = canvas.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  const pad = { l: 58 * d, r: 18 * d, t: 20 * d, b: 39 * d };
  const x = (e.clientX - r.left) * d;
  const y = (e.clientY - r.top) * d;
  const plotWidth = canvas.width - pad.l - pad.r;
  const plotHeight = canvas.height - pad.t - pad.b;
  if (x < pad.l || x > canvas.width - pad.r || y < pad.t || y > canvas.height - pad.b) {
    return false;
  }

  const samplePosition = ((x - pad.l) / plotWidth) * (state.data.length - 1);
  const leftIndex = Math.floor(samplePosition);
  const rightIndex = Math.min(state.data.length - 1, leftIndex + 1);
  const interpolation = samplePosition - leftIndex;
  const voltage =
    state.data[leftIndex] + (state.data[rightIndex] - state.data[leftIndex]) * interpolation;
  const bounds = voltageBounds();
  const waveformY =
    pad.t + ((bounds.high - voltage) / (bounds.high - bounds.low)) * plotHeight;
  return Math.abs(y - waveformY) <= 7 * d;
}

function editAt(pt, last) {
  if (state.tool === 'pan') return;
  if (state.tool === 'erase') pt.v = (state.high + state.low) / 2;
  if (state.tool === 'line' && state.lineStart) {
    const a = state.lineStart,
      b = pt,
      lo = Math.min(a.i, b.i),
      hi = Math.max(a.i, b.i);
    for (let i = lo; i <= hi; i++)
      state.data[i] = a.v + ((b.v - a.v) * (i - a.i)) / (b.i - a.i || 1);
  } else if (last) {
    const lo = Math.min(last.i, pt.i),
      hi = Math.max(last.i, pt.i);
    for (let i = lo; i <= hi; i++)
      state.data[i] = last.v + ((pt.v - last.v) * (i - last.i)) / (pt.i - last.i || 1);
  } else state.data[pt.i] = pt.v;
  draw();
}
const dutyDisabledTypes = new Set([
  'custom',
  'sine',
  'triangle',
  'ramp',
  'dc',
  'noise',
  'serial',
]);
function updateDutyAvailability(type) {
  const disabled = dutyDisabledTypes.has(type);
  $('dutyInput').disabled = disabled;
  $('dutyInput').closest('.range-label').classList.toggle('disabled', disabled);
}
function selectPreset(type) {
  document.querySelector('.preset.active')?.classList.remove('active');
  document.querySelector(`.preset[data-wave="${type}"]`)?.classList.add('active');
  updateDutyAvailability(type);
  updateSerialPropertiesVisibility(type);
  updateFunctionSelect(type);
}
function markCustom() {
  if (state.type !== 'custom') {
    state.type = 'custom';
    selectPreset('custom');
  }
}
canvas.addEventListener('pointerdown', (e) => {
  markCustom();
  state.drawing = true;
  canvas.setPointerCapture(e.pointerId);
  const p = canvasPoint(e);
  if (state.high === state.low && state.tool !== 'pan') {
    state.high = Math.max(state.high, p.v);
    state.low = Math.min(state.low, p.v);
    $('highInput').value = displayVoltage('highInput', state.high);
    $('lowInput').value = displayVoltage('lowInput', state.low);
    $('amplitudeInput').value = displayAmplitude(state.high - state.low);
    $('offsetInput').value = displayVoltage('offsetInput', (state.high + state.low) / 2);
  }
  state.lineStart = state.tool === 'line' ? p : null;
  state.lastPoint = p;
  editAt(p);
});
canvas.addEventListener('pointermove', (e) => {
  const p = canvasPoint(e);
  const timeUnit = axisTimeUnitFor(waveformDurationMs());
  const bounds = voltageBounds();
  const voltageUnit = axisVoltageUnitFor(bounds.low, bounds.high);
  canvas.classList.toggle('waveform-hover', pointerIsNearWaveform(e));
  $('cursorReadout').style.display = 'block';
  $('cursorReadout').innerHTML =
    `${(((p.i / (state.samples - 1)) * waveformDurationMs()) / timeUnit.scaleMs).toPrecision(5)} ${timeUnit.label} &nbsp; ${(p.v / voltageUnit.scaleV).toPrecision(5)} ${voltageUnit.label}`;
  if (state.drawing) {
    editAt(p, state.tool === 'pencil' || state.tool === 'erase' ? state.lastPoint : null);
    state.lastPoint = p;
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (state.drawing && state.tool === 'line') editAt(canvasPoint(e));
  if (state.drawing) pushHistory();
  state.drawing = false;
  state.lineStart = null;
});
canvas.addEventListener('pointerleave', () => {
  canvas.classList.remove('waveform-hover');
  $('cursorReadout').style.display = 'none';
});

function drawMini(c, type) {
  const x = c.getContext('2d'),
    w = (c.width = 110),
    h = (c.height = 42);
  x.strokeStyle = '#ff6b2c';
  x.lineWidth = 2;
  if (type === 'serial') {
    x.fillStyle = '#ff6b2c';
    x.font = 'bold 18px ui-monospace, monospace';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.beginPath();
    x.moveTo(31, 6);
    x.lineTo(79, 6);
    x.lineTo(88, 21);
    x.lineTo(79, 36);
    x.lineTo(31, 36);
    x.lineTo(22, 21);
    x.closePath();
    x.stroke();
    x.fillText('AA', 55, 21);
    return;
  }
  x.beginPath();
  for (let i = 0; i < w; i++) {
    let t = i / (w - 1),
      p = (t * 2) % 1,
      y = 0.5;
    if (type === 'sine') y = 0.5 - 0.34 * Math.sin(t * Math.PI * 4);
    if (type === 'square' || type === 'pulse') y = p < 0.5 ? 0.2 : 0.8;
    if (type === 'triangle') y = 0.2 + 0.6 * Math.abs(2 * p - 1);
    if (type === 'ramp') y = 0.8 - 0.6 * p;
    if (type === 'dc') y = 0.5;
    if (type === 'noise') y = 0.2 + Math.random() * 0.6;
    if (type === 'custom') y = 0.5;
    i ? x.lineTo(i, y * h) : x.moveTo(i, y * h);
  }
  x.stroke();
}
function updateFunctionSelect(type) {
  const label = type.charAt(0).toUpperCase() + type.slice(1),
    button = $('functionSelectBtn');
  button.querySelector('span').textContent = label;
  drawMini(button.querySelector('canvas'), type);
  $('functionSelectMenu')
    .querySelectorAll('[data-wave]')
    .forEach((option) => option.setAttribute('aria-checked', String(option.dataset.wave === type)));
}
function closeFunctionSelectMenu() {
  $('functionSelectMenu').classList.remove('open');
  $('functionSelectBtn').setAttribute('aria-expanded', 'false');
}
$('functionSelectBtn').onclick = (event) => {
  event.stopPropagation();
  const button = $('functionSelectBtn'),
    menu = $('functionSelectMenu'),
    rect = button.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, innerWidth - 180) + 'px';
  menu.classList.add('open');
  menu.style.top = Math.min(rect.bottom + 4, innerHeight - menu.offsetHeight - 8) + 'px';
  button.setAttribute('aria-expanded', 'true');
};
$('functionSelectMenu')
  .querySelectorAll('[data-wave]')
  .forEach((option) => {
    drawMini(option.querySelector('canvas'), option.dataset.wave);
    option.onclick = () => {
      const type = option.dataset.wave;
      selectPreset(type);
      if (type === 'custom') {
        state.type = 'custom';
        drawCustomPreview();
      } else generate(type);
      refreshScopeTime();
      closeFunctionSelectMenu();
    };
  });
function drawCustomPreview() {
  if (state.type !== 'custom' || !state.data.length) return;
  const canvases = [
      $('functionSelectBtn').querySelector('canvas'),
      $('functionSelectMenu').querySelector('[data-wave="custom"] canvas'),
    ],
    values = state.data;
  let min = Infinity,
    max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  for (const c of canvases) {
    const x = c.getContext('2d'),
      w = (c.width = 110),
      h = (c.height = 42),
      pad = 4,
      span = max - min;
    x.clearRect(0, 0, w, h);
    x.strokeStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--orange').trim() || '#ff6b2c';
    x.lineWidth = 2;
    x.beginPath();
    for (let px = 0; px < w; px++) {
      const index = Math.round((px / (w - 1)) * (values.length - 1)),
        y = span ? pad + ((max - values[index]) / span) * (h - pad * 2) : h / 2;
      px ? x.lineTo(px, y) : x.moveTo(px, y);
    }
    x.stroke();
  }
}
document.querySelectorAll('.tool[data-tool]').forEach(
  (b) =>
    (b.onclick = () => {
      document.querySelector('.tool.active')?.classList.remove('active');
      b.classList.add('active');
      state.tool = b.dataset.tool;
    }),
);
function undoWaveform() {
  if (state.history.length > 1) {
    state.redo.push(state.history.pop());
    restoreWaveform(state.history.at(-1));
  }
}
function redoWaveform() {
  if (state.redo.length) {
    const snapshot = state.redo.pop();
    state.history.push(cloneWaveform(snapshot));
    restoreWaveform(snapshot);
  }
}
$('undoBtn').onclick = undoWaveform;
$('redoBtn').onclick = redoWaveform;
document.addEventListener('keydown', (event) => {
  const editing = event.target.matches?.('input, textarea, select, [contenteditable="true"]');
  if (editing) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    undoWaveform();
  } else if ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey)) {
    event.preventDefault();
    redoWaveform();
  }
});
$('zoomIn').onclick = () => {
  state.high *= 0.8;
  state.low *= 0.8;
  draw();
};
$('zoomOut').onclick = () => {
  state.high *= 1.25;
  state.low *= 1.25;
  draw();
};
$('fitView').onclick = () => {
  syncInputs();
  draw();
};
$('exportBtn').onclick = () => {
  const csv =
      'time_s,voltage_v\n' +
      state.data
        .map((v, i) => `${((i / (state.samples - 1)) * waveformDurationMs()) / 1000},${v}`)
        .join('\n'),
    blob = new Blob([csv], { type: 'text/csv' }),
    a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'arbdraw-waveform.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Waveform exported as CSV');
};
