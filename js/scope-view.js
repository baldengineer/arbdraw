// Read-only waveform viewer rendering and independent scope controls.
const scopeCanvas = document.querySelector('#scopeCanvas');
const scopeCtx = scopeCanvas.getContext('2d');
const scopeState = {
  voltsPerDiv: 2,
  verticalPosition: 0,
  verticalDivisions: DEFAULT_VALUES.waveformVerticalDivisions,
  timePerDivMs: null,
  cycles: 2,
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
  const maximumOffset = Math.max(
    0.000001,
    Math.abs(state.high - scopeState.verticalPosition),
    Math.abs(state.low - scopeState.verticalPosition),
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
  return Math.min(1000, Math.max(1e-9, nextUpper125((state.duration * scopeState.cycles) / 10)));
}
function refreshScopeTime() {
  scopeState.timePerDivMs = fittedScopeTime();
  scopeState.fitted = true;
  renderScopeTime();
  drawScope();
}
function refreshScope() {
  scopeState.voltsPerDiv = fittedVerticalScale();
  scopeState.timePerDivMs = fittedScopeTime();
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
    voltageSpan = voltsPerDiv * scopeState.verticalDivisions;
  scopeCtx.clearRect(0, 0, w, h);
  scopeCtx.fillStyle = '#090d0f';
  scopeCtx.fillRect(0, 0, w, h);
  scopeCtx.font = `${10 * d}px ui-monospace`;
  scopeCtx.lineWidth = d;
  scopeCtx.textBaseline = 'middle';
  scopeCtx.textAlign = 'right';
  for (let y = 0; y <= scopeState.verticalDivisions; y++) {
    const py = pad.t + (ph * y) / scopeState.verticalDivisions,
      value = mid + voltageSpan / 2 - y * voltsPerDiv;
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
      time = x * timePerDiv;
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
  scopeCtx.shadowBlur = 5 * d;
  scopeCtx.lineWidth = 1.5 * d;
  scopeCtx.beginPath();
  for (let cycle = 0; cycle < scopeState.cycles; cycle++)
    state.data.forEach((value, index) => {
      const time = cycle * state.duration + (index / (state.data.length - 1)) * state.duration,
        x = pad.l + (time / timeSpan) * pw,
        y = pad.t + ((mid + voltageSpan / 2 - value) / voltageSpan) * ph;
      index || cycle ? scopeCtx.lineTo(x, y) : scopeCtx.moveTo(x, y);
    });
  scopeCtx.stroke();
  scopeCtx.restore();
}
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
  $(id).addEventListener('change', () => {
    const value = Number($(id).value),
      scale = id === 'scopeVoltsDiv' ? scopeVoltageUnitScale : scopeTimeUnitScaleMs;
    if (Number.isFinite(value) && value > 0) {
      scopeState[key] =
        id === 'scopeTimeDiv'
          ? Math.min(1000, Math.max(1e-9, nextUpper125(value * scale)))
          : value * scale;
      scopeState.fitted = true;
      if (id === 'scopeTimeDiv') renderScopeTime();
      drawScope();
    } else $(id).value = Number((scopeState[key] / scale).toPrecision(8));
  });
  $(id).addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $(id).blur();
    }
  });
}
$('scopeVerticalPosition').addEventListener('change', () => {
  const value = Number($('scopeVerticalPosition').value);
  if (Number.isFinite(value)) {
    scopeState.verticalPosition = value * scopePositionUnitScale;
    drawScope();
  } else $('scopeVerticalPosition').value = scopeState.verticalPosition / scopePositionUnitScale;
});
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
$('scopeCycles').addEventListener('change', () => {
  const value = Math.max(1, Math.round(Number($('scopeCycles').value)));
  if (Number.isFinite(value)) {
    scopeState.cycles = value;
    $('scopeCycles').value = value;
    refreshScopeTime();
  } else $('scopeCycles').value = scopeState.cycles;
});
$('scopeCycles').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('scopeCycles').blur();
  }
});
scopeCanvas.addEventListener('pointermove', (event) => {
  const r = scopeCanvas.getBoundingClientRect(),
    x = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
    y = Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
    time = x * scopeState.timePerDivMs * 10,
    voltage =
      scopeState.verticalPosition +
      (0.5 - y) * scopeState.voltsPerDiv * scopeState.verticalDivisions;
  $('scopeCursorReadout').style.display = 'block';
  $('scopeCursorReadout').innerHTML =
    `${time.toPrecision(5)} ms &nbsp; ${voltage.toPrecision(5)} V`;
});
scopeCanvas.addEventListener('pointerleave', () => {
  $('scopeCursorReadout').style.display = 'none';
});
