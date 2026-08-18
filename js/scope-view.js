// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Read-only waveform viewer rendering and independent scope controls.
const scopeCanvas = document.querySelector('#scopeCanvas');
const scopeCtx = scopeCanvas.getContext('2d');
const scopeFitCycleCount = 2;
const scopeState = {
  voltsPerDiv: 2,
  verticalPosition: 0,
  verticalDivisions: DEFAULT_VALUES.waveformVerticalDivisions,
  timePerDivMs: null,
  timeStartMs: 0,
  fitted: false,
};
let scopeVoltageUnitScale = 1;
let scopePositionUnitScale = 1;
let scopeTimeUnitScaleMs = 0.000001;
function nextUpper125(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value)),
    power = 10 ** exponent,
    normalized = value / power;
  for (const step of [1, 2, 5]) if (step >= normalized - 1e-12) return step * power;
  return 10 * power;
}
function fittedVerticalScale() {
  let dataLow = state.low,
    dataHigh = state.high;
  for (const value of state.data) {
    if (Number.isFinite(value)) {
      dataLow = Math.min(dataLow, value);
      dataHigh = Math.max(dataHigh, value);
    }
  }
  const maximumOffset = Math.max(
    0.000001,
    Math.abs(dataHigh - scopeState.verticalPosition),
    Math.abs(dataLow - scopeState.verticalPosition),
  );
  return nextUpper125(maximumOffset / (scopeState.verticalDivisions / 2));
}
function refreshScopeVertical() {
  scopeState.voltsPerDiv = fittedVerticalScale();
  scopeState.fitted = true;
  $('scopeVoltsDiv').value = Number(
    (scopeState.voltsPerDiv / scopeVoltageUnitScale).toPrecision(8),
  );
  drawScope();
}
function scopeTimeUnitFor(milliseconds) {
  if (milliseconds >= 1000) return { scale: 1000, label: 's/div' };
  if (milliseconds >= 1) return { scale: 1, label: 'ms/div' };
  if (milliseconds >= 0.001) return { scale: 0.001, label: 'µs/div' };
  if (milliseconds >= 0.000001) return { scale: 0.000001, label: 'ns/div' };
  return { scale: 1e-9, label: 'ps/div' };
}
function renderScopeTime() {
  const unit = scopeTimeUnitFor(scopeState.timePerDivMs);
  scopeTimeUnitScaleMs = unit.scale;
  $('scopeTimeUnitBtn').textContent = unit.label;
  $('scopeTimeDiv').value = Number((scopeState.timePerDivMs / unit.scale).toPrecision(8));
}
function fittedScopeTime() {
  return Math.min(
    1000,
    Math.max(1e-9, nextUpper125((waveformDurationMs() * scopeFitCycleCount) / 10)),
  );
}
function refreshScopeTime() {
  scopeState.timePerDivMs = fittedScopeTime();
  scopeState.timeStartMs = 0;
  scopeState.fitted = true;
  renderScopeTime();
  drawScope();
}
function refreshScope() {
  scopeState.voltsPerDiv = fittedVerticalScale();
  scopeState.timePerDivMs = fittedScopeTime();
  scopeState.timeStartMs = 0;
  scopeState.fitted = true;
  $('scopeVoltsDiv').value = Number(
    (scopeState.voltsPerDiv / scopeVoltageUnitScale).toPrecision(8),
  );
  renderScopeTime();
  drawScope();
}
function drawScope() {
  const w = scopeCanvas.width,
    h = scopeCanvas.height,
    d = devicePixelRatio || 1;
  if (!w || !h) return;
  if (!scopeState.fitted) refreshScope();
  const voltsPerDiv = Math.max(1e-12, scopeState.voltsPerDiv),
    timePerDiv = Math.max(1e-12, scopeState.timePerDivMs),
    mid = scopeState.verticalPosition,
    pad = { l: 62 * d, r: 18 * d, t: 20 * d, b: 39 * d },
    pw = w - pad.l - pad.r,
    ph = h - pad.t - pad.b,
    timeSpan = timePerDiv * 10,
    voltageSpan = voltsPerDiv * scopeState.verticalDivisions,
    timeUnit = axisTimeUnitFor(scopeState.timeStartMs + timeSpan),
    voltageMinimum = mid - voltageSpan / 2,
    voltageMaximum = mid + voltageSpan / 2,
    voltageUnit = axisVoltageUnitFor(voltageMinimum, voltageMaximum);
  $('scopeTimeAxisLabel').textContent = `TIME (${timeUnit.label})`;
  $('scopeVoltageAxisLabel').textContent = `VOLTAGE (${voltageUnit.label})`;
  scopeCtx.clearRect(0, 0, w, h);
  scopeCtx.fillStyle = '#090d0f';
  scopeCtx.fillRect(0, 0, w, h);
  scopeCtx.font = `${10 * d}px ui-monospace`;
  scopeCtx.lineWidth = d;
  scopeCtx.textBaseline = 'middle';
  scopeCtx.textAlign = 'right';
  for (let y = 0; y <= scopeState.verticalDivisions; y++) {
    const py = pad.t + (ph * y) / scopeState.verticalDivisions,
      value = (mid + voltageSpan / 2 - y * voltsPerDiv) / voltageUnit.scaleV;
    scopeCtx.strokeStyle = y === scopeState.verticalDivisions / 2 ? '#49605f' : '#223033';
    scopeCtx.beginPath();
    scopeCtx.moveTo(pad.l, py);
    scopeCtx.lineTo(w - pad.r, py);
    scopeCtx.stroke();
    scopeCtx.fillStyle = '#718083';
    scopeCtx.fillText(Number(value.toPrecision(4)), pad.l - 9 * d, py);
  }
  scopeCtx.textAlign = 'center';
  scopeCtx.textBaseline = 'top';
  for (let x = 0; x <= 10; x++) {
    const px = pad.l + (pw * x) / 10,
      time = (scopeState.timeStartMs + x * timePerDiv) / timeUnit.scaleMs;
    scopeCtx.strokeStyle = x === 0 ? '#405053' : '#1e2c2f';
    scopeCtx.beginPath();
    scopeCtx.moveTo(px, pad.t);
    scopeCtx.lineTo(px, h - pad.b);
    scopeCtx.stroke();
    scopeCtx.fillStyle = '#718083';
    scopeCtx.fillText(Number(time.toPrecision(4)), px, h - pad.b + 10 * d);
  }
  if (!state.data.length) return;
  scopeCtx.save();
  scopeCtx.beginPath();
  scopeCtx.rect(pad.l, pad.t, pw, ph);
  scopeCtx.clip();
  scopeCtx.strokeStyle = DEFAULT_VALUES.waveformColor;
  scopeCtx.shadowColor = DEFAULT_VALUES.waveformColor;
  scopeCtx.lineWidth = 1.5 * d;
  const waveformDuration = waveformDurationMs();
  const firstVisibleCycle = Math.max(0, Math.floor(scopeState.timeStartMs / waveformDuration));
  const lastVisibleCycle = Math.ceil((scopeState.timeStartMs + timeSpan) / waveformDuration);
  const visibleCycleCount = Math.max(1, lastVisibleCycle - firstVisibleCycle);
  const maximumRenderedCycles = Math.max(1, Math.ceil(pw / d));
  const cycleStep = Math.max(1, Math.ceil(visibleCycleCount / maximumRenderedCycles));
  const cycleWidthPixels = (waveformDuration / timeSpan) * (pw / d);
  const maximumSamplesPerCycle = Math.max(2, Math.ceil(cycleWidthPixels * 2));
  const sampleStep = Math.max(
    1,
    Math.ceil((state.data.length - 1) / maximumSamplesPerCycle),
  );

  for (let cycle = firstVisibleCycle; cycle < lastVisibleCycle; cycle += cycleStep) {
    scopeCtx.globalAlpha = cycle % 2 === 0 ? 1 : 0.55;
    scopeCtx.shadowBlur = cycle % 2 === 0 ? 5 * d : 2 * d;
    scopeCtx.beginPath();
    const drawSample = (index) => {
      const value = state.data[index];
      const time =
          cycle * waveformDuration +
          (index / (state.data.length - 1)) * waveformDuration,
        x = pad.l + ((time - scopeState.timeStartMs) / timeSpan) * pw,
        y = pad.t + ((mid + voltageSpan / 2 - value) / voltageSpan) * ph;
      index ? scopeCtx.lineTo(x, y) : scopeCtx.moveTo(x, y);
    };
    for (let index = 0; index < state.data.length; index += sampleStep) drawSample(index);
    if ((state.data.length - 1) % sampleStep !== 0) drawSample(state.data.length - 1);
    scopeCtx.stroke();
  }
  scopeCtx.globalAlpha = 1;
  scopeCtx.restore();
}

function scopePlotPoint(event) {
  const bounds = scopeCanvas.getBoundingClientRect();
  const pad = { left: 62, right: 18, top: 20, bottom: 39 };
  const x = Math.max(pad.left, Math.min(bounds.width - pad.right, event.clientX - bounds.left));
  const y = Math.max(pad.top, Math.min(bounds.height - pad.bottom, event.clientY - bounds.top));
  return {
    x,
    y,
    timeFraction: (x - pad.left) / (bounds.width - pad.left - pad.right),
    voltageFraction: (y - pad.top) / (bounds.height - pad.top - pad.bottom),
  };
}

function updateScopeCursor(event) {
  const point = scopePlotPoint(event);
  const timeSpan = scopeState.timePerDivMs * 10;
  const timeUnit = axisTimeUnitFor(scopeState.timeStartMs + timeSpan);
  const time =
    (scopeState.timeStartMs + point.timeFraction * timeSpan) / timeUnit.scaleMs;
  const voltage =
    scopeState.verticalPosition +
    (0.5 - point.voltageFraction) *
      scopeState.voltsPerDiv *
      scopeState.verticalDivisions;
  const voltageSpan = scopeState.voltsPerDiv * scopeState.verticalDivisions;
  const voltageUnit = axisVoltageUnitFor(
    scopeState.verticalPosition - voltageSpan / 2,
    scopeState.verticalPosition + voltageSpan / 2,
  );
  $('scopeCursorReadout').style.display = 'block';
  $('scopeCursorReadout').innerHTML =
    `${time.toPrecision(5)} ${timeUnit.label} &nbsp; ${(voltage / voltageUnit.scaleV).toPrecision(5)} ${voltageUnit.label}`;
}

let scopeZoomDrag = null;

function renderScopeZoomSelection(currentPoint) {
  const selection = $('scopeZoomSelection');
  selection.style.left = Math.min(scopeZoomDrag.start.x, currentPoint.x) + 'px';
  selection.style.top = Math.min(scopeZoomDrag.start.y, currentPoint.y) + 'px';
  selection.style.width = Math.abs(currentPoint.x - scopeZoomDrag.start.x) + 'px';
  selection.style.height = Math.abs(currentPoint.y - scopeZoomDrag.start.y) + 'px';
  selection.classList.add('open');
}

function finishScopeZoom(event, applyZoom) {
  if (!scopeZoomDrag || event.pointerId !== scopeZoomDrag.pointerId) return;
  const end = scopePlotPoint(event);
  const start = scopeZoomDrag.start;
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  const selection = $('scopeZoomSelection');

  if (scopeCanvas.hasPointerCapture(event.pointerId)) {
    scopeCanvas.releasePointerCapture(event.pointerId);
  }
  scopeZoomDrag = null;
  selection.classList.remove('open');

  if (!applyZoom || width < 8 || height < 8) return;

  const timeSpan = scopeState.timePerDivMs * 10;
  const voltageSpan = scopeState.voltsPerDiv * scopeState.verticalDivisions;
  const leftFraction = Math.min(start.timeFraction, end.timeFraction);
  const rightFraction = Math.max(start.timeFraction, end.timeFraction);
  const topFraction = Math.min(start.voltageFraction, end.voltageFraction);
  const bottomFraction = Math.max(start.voltageFraction, end.voltageFraction);
  const selectedTimeStart = scopeState.timeStartMs + leftFraction * timeSpan;
  const selectedTimeEnd = scopeState.timeStartMs + rightFraction * timeSpan;
  const selectedTimeCenter = (selectedTimeStart + selectedTimeEnd) / 2;
  const selectedVoltageTop =
    scopeState.verticalPosition + (0.5 - topFraction) * voltageSpan;
  const selectedVoltageBottom =
    scopeState.verticalPosition + (0.5 - bottomFraction) * voltageSpan;

  scopeState.timePerDivMs = Math.min(
    1000,
    Math.max(1e-9, nextUpper125((selectedTimeEnd - selectedTimeStart) / 10)),
  );
  const newTimeSpan = scopeState.timePerDivMs * 10;
  scopeState.timeStartMs = Math.max(0, selectedTimeCenter - newTimeSpan / 2);
  scopeState.voltsPerDiv = nextUpper125(
    Math.abs(selectedVoltageTop - selectedVoltageBottom) / scopeState.verticalDivisions,
  );
  scopeState.verticalPosition = (selectedVoltageTop + selectedVoltageBottom) / 2;
  scopeState.fitted = true;

  $('scopeVoltsDiv').value = Number(
    (scopeState.voltsPerDiv / scopeVoltageUnitScale).toPrecision(8),
  );
  $('scopeVerticalPosition').value = Number(
    (scopeState.verticalPosition / scopePositionUnitScale).toPrecision(8),
  );
  renderScopeTime();
  drawScope();
}

function closeScopeZoomMenu() {
  $('scopeZoomMenu').classList.remove('open');
}

function zoomOutScope() {
  const currentTimeSpan = scopeState.timePerDivMs * 10;
  const currentTimeCenter = scopeState.timeStartMs + currentTimeSpan / 2;

  scopeState.timePerDivMs = Math.min(1000, nextUpper125(scopeState.timePerDivMs * 2));
  const newTimeSpan = scopeState.timePerDivMs * 10;
  scopeState.timeStartMs = Math.max(0, currentTimeCenter - newTimeSpan / 2);
  scopeState.voltsPerDiv = nextUpper125(scopeState.voltsPerDiv * 2);
  scopeState.fitted = true;

  $('scopeVoltsDiv').value = Number(
    (scopeState.voltsPerDiv / scopeVoltageUnitScale).toPrecision(8),
  );
  renderScopeTime();
  drawScope();
  closeScopeZoomMenu();
}

$('scopeZoomAllBtn').onclick = () => {
  refreshScope();
  closeScopeZoomMenu();
};
$('scopeZoomOutBtn').onclick = zoomOutScope;
$('scopeCanvas').addEventListener('contextmenu', (event) => {
  event.preventDefault();
  const menu = $('scopeZoomMenu');
  menu.style.left = Math.min(event.clientX, innerWidth - 155) + 'px';
  menu.style.top = Math.min(event.clientY, innerHeight - 82) + 'px';
  menu.classList.add('open');
});
$('scopeRefreshBtn').onclick = refreshScopeTime;
$('scopeVerticalRefreshBtn').onclick = refreshScopeVertical;
$('scopeVerticalControl').addEventListener('contextmenu', (event) => {
  event.preventDefault();
  const menu = $('scopeDivisionMenu');
  menu.style.left = Math.min(event.clientX, innerWidth - 155) + 'px';
  menu.style.top = Math.min(event.clientY, innerHeight - 82) + 'px';
  menu.classList.add('open');
  menu.querySelectorAll('button').forEach((option) => {
    option.setAttribute(
      'aria-checked',
      String(+option.dataset.divisions === scopeState.verticalDivisions),
    );
  });
});
function closeScopeDivisionMenu() {
  $('scopeDivisionMenu').classList.remove('open');
}
$('scopeDivisionMenu')
  .querySelectorAll('button')
  .forEach((option) => {
    option.onclick = () => {
      scopeState.verticalDivisions = +option.dataset.divisions;
      refreshScopeVertical();
      closeScopeDivisionMenu();
    };
  });
for (const [id, key] of [
  ['scopeVoltsDiv', 'voltsPerDiv'],
  ['scopeTimeDiv', 'timePerDivMs'],
]) {
  const updateControl = (event) => {
    const value = Number($(id).value),
      scale = id === 'scopeVoltsDiv' ? scopeVoltageUnitScale : scopeTimeUnitScaleMs;
    if (Number.isFinite(value) && value > 0) {
      scopeState[key] =
        id === 'scopeTimeDiv'
          ? Math.min(
              1000,
              Math.max(1e-9, event.type === 'change' ? nextUpper125(value * scale) : value * scale),
            )
          : value * scale;
      scopeState.fitted = true;
      if (id === 'scopeTimeDiv') renderScopeTime();
      drawScope();
    } else $(id).value = Number((scopeState[key] / scale).toPrecision(8));
  };
  $(id).addEventListener('input', updateControl);
  $(id).addEventListener('change', updateControl);
  $(id).addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $(id).blur();
    }
  });
}
const updateScopePosition = () => {
  const value = Number($('scopeVerticalPosition').value);
  if (Number.isFinite(value)) {
    scopeState.verticalPosition = value * scopePositionUnitScale;
    drawScope();
  } else $('scopeVerticalPosition').value = scopeState.verticalPosition / scopePositionUnitScale;
};
$('scopeVerticalPosition').addEventListener('input', updateScopePosition);
$('scopeVerticalPosition').addEventListener('change', updateScopePosition);
$('scopeVerticalPosition').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('scopeVerticalPosition').blur();
  }
});
$('scopeVoltageUnitBtn').onclick = (event) => {
  event.stopPropagation();
  const button = $('scopeVoltageUnitBtn'),
    menu = $('scopeVoltageUnitMenu'),
    rect = button.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, innerWidth - 110) + 'px';
  menu.style.top = rect.bottom + 4 + 'px';
  menu.classList.add('open');
  button.setAttribute('aria-expanded', 'true');
  menu
    .querySelectorAll('button')
    .forEach((option) =>
      option.setAttribute('aria-checked', String(+option.dataset.scale === scopeVoltageUnitScale)),
    );
};
function closeScopeVoltageUnitMenu() {
  $('scopeVoltageUnitMenu').classList.remove('open');
  $('scopeVoltageUnitBtn').setAttribute('aria-expanded', 'false');
}
function selectScopeVoltageUnit(scale, label) {
  scopeVoltageUnitScale = scale;
  $('scopeVoltageUnitBtn').textContent = label;
  const value = Number($('scopeVoltsDiv').value);
  if (Number.isFinite(value) && value > 0) scopeState.voltsPerDiv = value * scopeVoltageUnitScale;
  drawScope();
  closeScopeVoltageUnitMenu();
}
$('scopeVoltageUnitMenu')
  .querySelectorAll('button')
  .forEach(
    (option) =>
      (option.onclick = () => selectScopeVoltageUnit(+option.dataset.scale, option.dataset.label)),
  );
const scopeVoltageSuffixes = {
  m: { scale: 0.001, label: 'mV/div' },
  v: { scale: 1, label: 'V/div' },
};
$('scopeVoltsDiv').addEventListener('keydown', (event) => {
  const unit = scopeVoltageSuffixes[event.key.toLowerCase()];
  if (!unit || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  selectScopeVoltageUnit(unit.scale, unit.label);
});
function closeScopePositionUnitMenu() {
  $('scopePositionUnitMenu').classList.remove('open');
  $('scopePositionUnitBtn').setAttribute('aria-expanded', 'false');
}
function selectScopePositionUnit(scale, label) {
  scopePositionUnitScale = scale;
  $('scopePositionUnitBtn').textContent = label;
  const value = Number($('scopeVerticalPosition').value);
  if (Number.isFinite(value)) scopeState.verticalPosition = value * scopePositionUnitScale;
  drawScope();
  closeScopePositionUnitMenu();
}
$('scopePositionUnitBtn').onclick = (event) => {
  event.stopPropagation();
  const button = $('scopePositionUnitBtn'),
    menu = $('scopePositionUnitMenu'),
    rect = button.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, innerWidth - 100) + 'px';
  menu.style.top = rect.bottom + 4 + 'px';
  menu.classList.add('open');
  button.setAttribute('aria-expanded', 'true');
  menu
    .querySelectorAll('button')
    .forEach((option) =>
      option.setAttribute('aria-checked', String(+option.dataset.scale === scopePositionUnitScale)),
    );
};
$('scopePositionUnitMenu')
  .querySelectorAll('button')
  .forEach(
    (option) =>
      (option.onclick = () => selectScopePositionUnit(+option.dataset.scale, option.dataset.label)),
  );
const scopePositionSuffixes = { m: { scale: 0.001, label: 'mV' }, v: { scale: 1, label: 'V' } };
$('scopeVerticalPosition').addEventListener('keydown', (event) => {
  const unit = scopePositionSuffixes[event.key.toLowerCase()];
  if (!unit || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  selectScopePositionUnit(unit.scale, unit.label);
});
function closeScopeTimeUnitMenu() {
  $('scopeTimeUnitMenu').classList.remove('open');
  $('scopeTimeUnitBtn').setAttribute('aria-expanded', 'false');
}
function selectScopeTimeUnit(scale, label) {
  scopeTimeUnitScaleMs = scale;
  $('scopeTimeUnitBtn').textContent = label;
  const value = Number($('scopeTimeDiv').value);
  if (Number.isFinite(value) && value > 0)
    scopeState.timePerDivMs = Math.min(1000, value * scopeTimeUnitScaleMs);
  drawScope();
  closeScopeTimeUnitMenu();
}
$('scopeTimeUnitBtn').onclick = (event) => {
  event.stopPropagation();
  const button = $('scopeTimeUnitBtn'),
    menu = $('scopeTimeUnitMenu'),
    rect = button.getBoundingClientRect();
  menu.style.left = Math.min(rect.left, innerWidth - 110) + 'px';
  menu.style.top = rect.bottom + 4 + 'px';
  menu.classList.add('open');
  button.setAttribute('aria-expanded', 'true');
  menu
    .querySelectorAll('button')
    .forEach((option) =>
      option.setAttribute('aria-checked', String(+option.dataset.scale === scopeTimeUnitScaleMs)),
    );
};
$('scopeTimeUnitMenu')
  .querySelectorAll('button')
  .forEach(
    (option) =>
      (option.onclick = () => selectScopeTimeUnit(+option.dataset.scale, option.dataset.label)),
  );
const scopeTimeSuffixes = {
  p: { scale: 1e-9, label: 'ps/div' },
  n: { scale: 1e-6, label: 'ns/div' },
  u: { scale: 0.001, label: 'µs/div' },
  m: { scale: 1, label: 'ms/div' },
  s: { scale: 1000, label: 's/div' },
};
$('scopeTimeDiv').addEventListener('keydown', (event) => {
  const unit = scopeTimeSuffixes[event.key.toLowerCase()];
  if (!unit || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  selectScopeTimeUnit(unit.scale, unit.label);
});
scopeCanvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  const start = scopePlotPoint(event);
  scopeZoomDrag = { pointerId: event.pointerId, start };
  scopeCanvas.setPointerCapture(event.pointerId);
  renderScopeZoomSelection(start);
});
scopeCanvas.addEventListener('pointermove', (event) => {
  updateScopeCursor(event);
  if (scopeZoomDrag && event.pointerId === scopeZoomDrag.pointerId) {
    renderScopeZoomSelection(scopePlotPoint(event));
  }
});
scopeCanvas.addEventListener('pointerup', (event) => finishScopeZoom(event, true));
scopeCanvas.addEventListener('pointercancel', (event) => finishScopeZoom(event, false));
scopeCanvas.addEventListener('pointerleave', () => {
  if (!scopeZoomDrag) $('scopeCursorReadout').style.display = 'none';
});
