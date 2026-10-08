// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Waveform generation, editable canvas rendering, presets, and history.
const canvas = document.querySelector('#waveCanvas');
const ctx = canvas.getContext('2d');
const editorOverviewCanvas = document.querySelector('#editorOverviewCanvas');
const editorOverviewContext = editorOverviewCanvas.getContext('2d');
const editorViewport = { start: 0, pointsPerScreen: null, total: null };
const editorSelection = { left: null, right: null, origin: null, dragging: null };

function normalizeEditorViewport(viewport, totalPoints) {
  const total = Math.max(1, Math.trunc(Number(totalPoints)) || 1),
    minimumPoints = Math.min(2, total),
    requestedPoints = viewport?.pointsPerScreen == null ? Number.NaN : Number(viewport.pointsPerScreen),
    pointsPerScreen = Number.isFinite(requestedPoints)
      ? Math.max(minimumPoints, Math.min(total, Math.round(requestedPoints)))
      : total,
    maximumStart = Math.max(0, total - pointsPerScreen),
    requestedStart = Number(viewport?.start),
    start = Math.max(
      0,
      Math.min(maximumStart, Number.isFinite(requestedStart) ? Math.round(requestedStart) : 0),
    ),
    end = start + pointsPerScreen - 1;
  return {
    total,
    start,
    end,
    pointsPerScreen,
    center: Math.round((start + end) / 2),
    maximumStart,
  };
}

function normalizeEditorSelection(selection, totalPoints) {
  if (selection?.left == null || selection?.right == null) return null;
  const total = Math.max(1, Math.trunc(Number(totalPoints)) || 1),
    maximumIndex = total - 1,
    requestedLeft = Number(selection?.left),
    requestedRight = Number(selection?.right);
  if (!Number.isFinite(requestedLeft) || !Number.isFinite(requestedRight)) return null;
  const first = Math.max(0, Math.min(maximumIndex, Math.round(requestedLeft))),
    second = Math.max(0, Math.min(maximumIndex, Math.round(requestedRight)));
  return { left: Math.min(first, second), right: Math.max(first, second) };
}

function currentEditorSelection() {
  const normalized = normalizeEditorSelection(editorSelection, editorRecordLength());
  editorSelection.left = normalized?.left ?? null;
  editorSelection.right = normalized?.right ?? null;
  return normalized;
}

function updateEditorSelectionReadout(selection = currentEditorSelection()) {
  const readout = $('editorSelectionReadout');
  readout.hidden = !selection;
  if (!selection) return;
  $('editorSelectionLeft').textContent = `${selection.left.toLocaleString()} pts`;
  $('editorSelectionRight').textContent = `${selection.right.toLocaleString()} pts`;
}

function clearEditorSelection(render = true) {
  editorSelection.left = null;
  editorSelection.right = null;
  editorSelection.origin = null;
  editorSelection.dragging = null;
  if (render) draw();
}

function handleEditorSelectionEscape(event) {
  if (event.key !== 'Escape' || !currentEditorSelection()) return false;
  event.preventDefault();
  clearEditorSelection();
  setEditorTool('selection');
  return true;
}

function handleEditorToolShortcut(event) {
  if (globalThis.ARBDRAW_EDITOR_MODES?.isAdvanced() === false) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
  const key = event.key.toLowerCase();
  let tool = null;
  if (key === 'a') tool = state.tool === 'pointer' ? 'selection' : 'pointer';
  else if (key === 'e') tool = 'pencil';
  else if (key === 'd') tool = 'erase';
  if (!tool) return false;
  event.preventDefault();
  setEditorTool(tool);
  return true;
}

function editorRecordLength() {
  return Math.max(1, state.data.length || state.samples || 1);
}

function currentEditorViewport() {
  const followsFullRecord =
      editorViewport.pointsPerScreen == null ||
      (editorViewport.total != null && editorViewport.pointsPerScreen >= editorViewport.total),
    requestedViewport = followsFullRecord
      ? { start: 0, pointsPerScreen: null }
      : editorViewport,
    normalized = normalizeEditorViewport(requestedViewport, editorRecordLength());
  editorViewport.start = normalized.start;
  editorViewport.pointsPerScreen = normalized.pointsPerScreen;
  editorViewport.total = normalized.total;
  return normalized;
}

function setEditorViewport(nextViewport) {
  Object.assign(editorViewport, nextViewport);
  currentEditorViewport();
  draw();
}

function setEditorViewportCenter(center) {
  const view = currentEditorViewport(),
    requestedCenter = Number(center),
    nextCenter = Number.isFinite(requestedCenter) ? Math.round(requestedCenter) : view.center;
  setEditorViewport({ start: nextCenter - Math.round((view.pointsPerScreen - 1) / 2) });
}

function waveformGenerationRange(totalPoints, selection, existingPointCount) {
  const total = Math.max(1, Math.trunc(Number(totalPoints)) || 1),
    normalized = normalizeEditorSelection(selection, total);
  if (!normalized || Number(existingPointCount) !== total)
    return { left: 0, right: total - 1, scoped: false };
  return { ...normalized, scoped: true };
}

function mergeGeneratedSamples(existingValues, generatedValues, range, totalPoints) {
  if (!range.scoped) return generatedValues;
  const merged = Array.from(existingValues).slice(0, totalPoints);
  for (let offset = 0; offset < generatedValues.length; offset++)
    merged[range.left + offset] = generatedValues[offset];
  return merged;
}

function waveformReplacementNeedsConfirmation(scopeSelection = true) {
  if (state.samplesEdited !== true) return false;
  return !waveformGenerationRange(
    state.samples,
    scopeSelection ? currentEditorSelection() : null,
    state.data.length,
  ).scoped;
}

function confirmWaveformReplacement(scopeSelection = true) {
  return (
    !waveformReplacementNeedsConfirmation(scopeSelection) ||
    window.confirm('This action will replace waveform samples you edited. Continue?')
  );
}

function generate(
  type = state.type,
  recordHistory = true,
  persist = true,
  scopeSelection = true,
  confirmOverwrite = true,
) {
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  globalThis.updateAudioPlaybackButton?.();
  const n = state.samples,
    existingData = [...state.data],
    range = waveformGenerationRange(
      n,
      scopeSelection ? currentEditorSelection() : null,
      existingData.length,
    ),
    generatedPointCount = range.right - range.left + 1,
    mid = (state.high + state.low) / 2,
    amp = (state.high - state.low) / 2,
    phase = (state.phase * Math.PI) / 180,
    serialBits = type === 'serial' ? serialBitPattern() : null,
    serialBaud = type === 'serial' ? serialSettings().baud : null,
    serialVoltage = type === 'serial' ? ARBDRAW_WAVEFORM_SHAPES.createSerialVoltage({
      bits: serialBits,
      baud: serialBaud,
      high: state.high,
      low: state.low,
      riseTimeSeconds: state.riseTime,
      fallTimeSeconds: state.fallTime,
    }) : null,
    noiseSamples =
      type === 'noise'
        ? ARBDRAW_WAVEFORM_SHAPES.generateNoiseSamples({
            count: generatedPointCount,
            high: state.high,
            low: state.low,
            color: state.noiseColor,
          })
        : null,
    bufferDurationSeconds = waveformDurationMs() / 1000;
  if (confirmOverwrite && !confirmWaveformReplacement(scopeSelection)) return false;
  state.type = type;
  const generatedData = Array.from({ length: generatedPointCount }, (_, i) => {
    const t = i / Math.max(1, generatedPointCount - 1),
      p = (t * state.cycles + state.phase / 360) % 1;
    switch (type) {
      case 'sine':
        return mid + amp * Math.sin(2 * Math.PI * state.cycles * t + phase);
      case 'square':
        return ARBDRAW_WAVEFORM_SHAPES.squarePulseVoltage({
          phase: p,
          high: state.high,
          low: state.low,
          dutyPercent: state.duty,
          frequencyHz: state.frequency,
          riseTimeSeconds: state.riseTime,
          fallTimeSeconds: state.fallTime,
        });
      case 'triangle':
        return ARBDRAW_WAVEFORM_SHAPES.triangleVoltage({
          phase: p,
          high: state.high,
          low: state.low,
          symmetryPercent: state.symmetry,
        });
      case 'rc':
        return ARBDRAW_WAVEFORM_SHAPES.rcVoltage({
          phase: p,
          high: state.high,
          low: state.low,
          tau: state.rcTau,
        });
      case 'pulse':
        return ARBDRAW_WAVEFORM_SHAPES.squarePulseVoltage({
          phase: p,
          high: state.high,
          low: state.low,
          dutyPercent: state.duty,
          frequencyHz: state.frequency,
          riseTimeSeconds: state.riseTime,
          fallTimeSeconds: state.fallTime,
        });
      case 'dc':
        return mid;
      case 'noise':
        return noiseSamples[i];
      case 'serial':
        {
          const elapsedSeconds = t * bufferDurationSeconds;
          return serialVoltage(elapsedSeconds);
        }
      default:
        return mid;
    }
  });
  state.data = mergeGeneratedSamples(existingData, applyFilters(generatedData), range, n);
  state.samplesEdited = range.scoped;
  globalThis.ARBDRAW_EDITOR_MODES?.refresh();
  if (type === 'triangle') updateFunctionSelect(type);
  if (recordHistory) pushHistory();
  draw();
  if (!$('samplesView').classList.contains('hidden')) renderSamples();
  if (persist) persistCurrentSettings();
  return true;
}
function cloneWaveform(source = projectDocument.waveform) {
  return {
    ...source,
    serial: { ...source.serial },
    filters: { ...source.filters },
    values: [...source.values],
  };
}
function restoreWaveform(snapshot) {
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  globalThis.updateAudioPlaybackButton?.();
  projectDocument.waveform = cloneWaveform(snapshot);
  renderDocument();
  globalThis.ARBDRAW_EDITOR_MODES?.refresh();
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
  resizeCanvas(editorOverviewCanvas, drawEditorOverview);
  if (!$('waveformView').classList.contains('hidden')) resizeCanvas(scopeCanvas, drawScope);
}
function voltageBounds() {
  let high = state.high,
    low = state.low;
  for (const value of state.data) {
    if (!Number.isFinite(value)) continue;
    high = Math.max(high, value);
    low = Math.min(low, value);
  }
  if (high !== low) return { high, low };
  const span = Math.max(5, Math.abs(high));
  return { high: high + span, low: low - span };
}
function editorPointTicks(startIndex, endIndex, divisionCount = 10) {
  const firstPointIndex = Math.max(0, Math.trunc(startIndex)),
    lastPointIndex = Math.max(firstPointIndex, Math.trunc(endIndex));
  if (firstPointIndex === lastPointIndex) return [firstPointIndex];
  const pointStep = Math.max(1, Math.ceil((lastPointIndex - firstPointIndex) / divisionCount));
  const ticks = [];
  for (let pointIndex = firstPointIndex; pointIndex <= lastPointIndex; pointIndex += pointStep)
    ticks.push(pointIndex);
  if (ticks.at(-1) !== lastPointIndex) ticks.push(lastPointIndex);
  return ticks;
}

function editorPointCanvasX(pointIndex, view, pad, plotWidth) {
  return pad.l + (plotWidth * (pointIndex - view.start)) / Math.max(1, view.end - view.start);
}

function drawEditorSelection(view, pad, plotWidth, plotHeight, pixelRatio) {
  const selection = currentEditorSelection();
  if (!selection || selection.right < view.start || selection.left > view.end) return;
  const visibleLeft = Math.max(selection.left, view.start),
    visibleRight = Math.min(selection.right, view.end),
    leftX = editorPointCanvasX(visibleLeft, view, pad, plotWidth),
    rightX = editorPointCanvasX(visibleRight, view, pad, plotWidth),
    markerColor =
      getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() || '#69b0e0';
  ctx.save();
  ctx.fillStyle = 'rgba(105, 176, 224, 0.18)';
  ctx.fillRect(leftX, pad.t, Math.max(2 * pixelRatio, rightX - leftX), plotHeight);
  ctx.strokeStyle = markerColor;
  ctx.fillStyle = markerColor;
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.5 * pixelRatio;
  ctx.setLineDash([4 * pixelRatio, 3 * pixelRatio]);
  for (const markerIndex of new Set([selection.left, selection.right])) {
    if (markerIndex < view.start || markerIndex > view.end) continue;
    const markerX = editorPointCanvasX(markerIndex, view, pad, plotWidth),
      crosshairY = pad.t + plotHeight / 2,
      arm = 6 * pixelRatio;
    ctx.beginPath();
    ctx.moveTo(markerX, pad.t);
    ctx.lineTo(markerX, pad.t + plotHeight);
    ctx.moveTo(markerX - arm, crosshairY);
    ctx.lineTo(markerX + arm, crosshairY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(markerX - 5 * pixelRatio, pad.t);
    ctx.lineTo(markerX + 5 * pixelRatio, pad.t);
    ctx.lineTo(markerX, pad.t + 7 * pixelRatio);
    ctx.closePath();
    ctx.fill();
    ctx.setLineDash([4 * pixelRatio, 3 * pixelRatio]);
  }
  ctx.restore();
}

function updateEditorNavigation(view = currentEditorViewport()) {
  const fullRecord = view.pointsPerScreen >= view.total,
    viewportWindow = $('editorViewportWindow');
  $('editorPointsPerScreen').value = view.pointsPerScreen;
  $('editorPointsPerScreen').max = view.total;
  $('editorPointsDecrease').disabled = view.pointsPerScreen <= Math.min(2, view.total);
  $('editorPointsIncrease').disabled = fullRecord;
  $('editorPosition').value = view.center;
  $('editorPosition').min = Math.round((view.pointsPerScreen - 1) / 2);
  $('editorPosition').max = Math.round(view.maximumStart + (view.pointsPerScreen - 1) / 2);
  $('editorPosition').step = 1;
  $('editorPosition').disabled = fullRecord;
  $('editorPositionDecrease').disabled = view.start <= 0;
  $('editorPositionIncrease').disabled = view.start >= view.maximumStart;
  $('editorFullRecord').disabled = fullRecord;
  const recordWidthPercent = (view.pointsPerScreen / view.total) * 100,
    minimumWidthPercent = editorOverview.clientWidth ? (8 / editorOverview.clientWidth) * 100 : 0,
    windowWidthPercent = Math.min(100, Math.max(recordWidthPercent, minimumWidthPercent)),
    windowLeftPercent = view.maximumStart
      ? (view.start / view.maximumStart) * (100 - windowWidthPercent)
      : 0;
  viewportWindow.style.left = `${windowLeftPercent}%`;
  viewportWindow.style.width = `${windowWidthPercent}%`;
  viewportWindow.setAttribute('aria-valuemax', String(view.total - 1));
  viewportWindow.setAttribute('aria-valuenow', String(view.center));
  viewportWindow.setAttribute('aria-disabled', String(fullRecord));
  viewportWindow.setAttribute(
    'aria-valuetext',
    fullRecord ? 'Full record' : `Points ${view.start} through ${view.end}`,
  );
}

function drawEditorOverview() {
  const view = currentEditorViewport(),
    w = editorOverviewCanvas.width,
    h = editorOverviewCanvas.height,
    d = devicePixelRatio || 1;
  updateEditorNavigation(view);
  if (!w || !h) return;
  editorOverviewContext.clearRect(0, 0, w, h);
  editorOverviewContext.fillStyle = '#090d0f';
  editorOverviewContext.fillRect(0, 0, w, h);
  if (!state.data.length) return;
  const bounds = voltageBounds(),
    pad = 4 * d,
    drawWidth = Math.max(1, w - pad * 2),
    drawHeight = Math.max(1, h - pad * 2),
    sampleStep = Math.max(1, Math.floor(state.data.length / Math.max(1, w))),
    lastIndex = state.data.length - 1;
  editorOverviewContext.beginPath();
  const drawPoint = (index) => {
    const x = pad + (drawWidth * index) / Math.max(1, lastIndex),
      y = pad + ((bounds.high - state.data[index]) / (bounds.high - bounds.low)) * drawHeight;
    index ? editorOverviewContext.lineTo(x, y) : editorOverviewContext.moveTo(x, y);
  };
  for (let index = 0; index <= lastIndex; index += sampleStep) drawPoint(index);
  if (lastIndex % sampleStep !== 0) drawPoint(lastIndex);
  editorOverviewContext.strokeStyle = DEFAULT_VALUES.editorColor;
  editorOverviewContext.globalAlpha = 0.8;
  editorOverviewContext.lineWidth = 1.25 * d;
  editorOverviewContext.stroke();
  editorOverviewContext.globalAlpha = 1;
}
function draw() {
  const w = canvas.width,
    h = canvas.height,
    d = devicePixelRatio || 1,
    view = currentEditorViewport();
  drawEditorOverview();
  updateEditorSelectionReadout();
  if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#090d0f';
  ctx.fillRect(0, 0, w, h);
  const pad = { l: 58 * d, r: 18 * d, t: 20 * d, b: 39 * d },
    pw = w - pad.l - pad.r,
    ph = h - pad.t - pad.b,
    bounds = voltageBounds(),
    pointTicks = editorPointTicks(view.start, view.end),
    visiblePointSpan = Math.max(1, view.end - view.start),
    voltageUnit = axisVoltageUnitFor(bounds.low, bounds.high);
  $('editorPointAxisLabel').textContent = 'POINTS';
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
  for (const pointIndex of pointTicks) {
    const px = pad.l + (pw * (pointIndex - view.start)) / visiblePointSpan;
    ctx.strokeStyle = pointIndex === view.start ? '#405053' : '#1e2c2f';
    ctx.beginPath();
    ctx.moveTo(px, pad.t);
    ctx.lineTo(px, h - pad.b);
    ctx.stroke();
    ctx.fillStyle = '#718083';
    ctx.fillText(pointIndex, px, h - pad.b + 10 * d);
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
  const sampleStep = Math.max(1, Math.floor(view.pointsPerScreen / Math.max(1, (pw / d) * 2)));
  const drawVisiblePoint = (index, move = false) => {
    const x = pad.l + (pw * (index - view.start)) / visiblePointSpan,
      y = pad.t + ((bounds.high - state.data[index]) / (bounds.high - bounds.low)) * ph;
    if (state.waveformRenderMode === 'dots') {
      ctx.beginPath();
      ctx.arc(x, y, 2 * d, 0, Math.PI * 2);
      ctx.fill();
    } else if (move) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  };
  if (state.waveformRenderMode === 'dots') {
    ctx.fillStyle = DEFAULT_VALUES.editorColor;
    for (let index = view.start; index <= view.end; index += sampleStep)
      drawVisiblePoint(index);
    if ((view.end - view.start) % sampleStep !== 0) drawVisiblePoint(view.end);
  } else {
    ctx.beginPath();
    let firstVisiblePoint = true;
    for (let index = view.start; index <= view.end; index += sampleStep) {
      drawVisiblePoint(index, firstVisiblePoint);
      firstVisiblePoint = false;
    }
    if ((view.end - view.start) % sampleStep !== 0) drawVisiblePoint(view.end, firstVisiblePoint);
    ctx.stroke();
  }
  drawEditorSelection(view, pad, pw, ph, d);
  ctx.restore();
  if (!$('waveformView').classList.contains('hidden')) drawScope();
}
function setWaveformRenderMode(mode) {
  state.waveformRenderMode = mode === 'dots' ? 'dots' : 'vectors';
  globalThis.ARBDRAW_VIEW_MENU?.render();
  draw();
}
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect(),
    d = devicePixelRatio || 1,
    p = { l: 58 * d, r: 18 * d, t: 20 * d, b: 39 * d },
    x = (e.clientX - r.left) * d,
    y = (e.clientY - r.top) * d,
    pw = canvas.width - p.l - p.r,
    ph = canvas.height - p.t - p.b,
    bounds = voltageBounds(),
    view = currentEditorViewport(),
    pointRatio = Math.max(0, Math.min(1, (x - p.l) / pw));
  return {
    i: Math.max(view.start, Math.min(view.end, Math.round(view.start + pointRatio * (view.end - view.start)))),
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

  const view = currentEditorViewport();
  const samplePosition = view.start + ((x - pad.l) / plotWidth) * (view.end - view.start);
  const leftIndex = Math.floor(samplePosition);
  const rightIndex = Math.min(view.end, leftIndex + 1);
  const interpolation = samplePosition - leftIndex;
  const voltage =
    state.data[leftIndex] + (state.data[rightIndex] - state.data[leftIndex]) * interpolation;
  const bounds = voltageBounds();
  const waveformY =
    pad.t + ((bounds.high - voltage) / (bounds.high - bounds.low)) * plotHeight;
  return Math.abs(y - waveformY) <= 7 * d;
}

function editorEditIndexRange(firstIndex, secondIndex = firstIndex, selection = currentEditorSelection()) {
  const first = Math.round(Number(firstIndex)),
    second = Math.round(Number(secondIndex));
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  let lo = Math.max(0, Math.min(first, second)),
    hi = Math.min(state.data.length - 1, Math.max(first, second));
  if (selection) {
    lo = Math.max(lo, selection.left);
    hi = Math.min(hi, selection.right);
  }
  return lo <= hi ? { lo, hi } : null;
}

function editAt(pt, last) {
  if (globalThis.ARBDRAW_EDITOR_MODES?.isAdvanced() === false) return false;
  if (state.tool === 'pan') return false;
  if (state.tool === 'erase') pt.v = (state.high + state.low) / 2;
  if (state.tool === 'line' && state.lineStart) {
    const a = state.lineStart,
      b = pt,
      editRange = editorEditIndexRange(a.i, b.i);
    if (!editRange) return false;
    for (let i = editRange.lo; i <= editRange.hi; i++)
      state.data[i] = a.v + ((b.v - a.v) * (i - a.i)) / (b.i - a.i || 1);
  } else if (last) {
    const editRange = editorEditIndexRange(last.i, pt.i);
    if (!editRange) return false;
    for (let i = editRange.lo; i <= editRange.hi; i++)
      state.data[i] = last.v + ((pt.v - last.v) * (i - last.i)) / (pt.i - last.i || 1);
  } else {
    const editRange = editorEditIndexRange(pt.i);
    if (!editRange) return false;
    state.data[pt.i] = pt.v;
  }
  state.samplesEdited = true;
  draw();
  return true;
}
const dutyDisabledTypes = new Set([
  'sine',
  'triangle',
  'rc',
  'dc',
  'noise',
  'serial',
]);
function updateDutyAvailability(type) {
  const disabled = dutyDisabledTypes.has(type);
  $('dutyInput').disabled = disabled;
  $('dutyInput').closest('.range-label').classList.toggle('disabled', disabled);
}
function updateDcPropertyAvailability(type) {
  const disabled = type === 'dc';
  for (const id of ['highInput', 'lowInput', 'amplitudeInput']) {
    const input = $(id),
      label = input.closest('label'),
      unitButton = label.querySelector('.unit-button');
    input.disabled = disabled;
    if (unitButton) unitButton.disabled = disabled;
    label.classList.toggle('disabled', disabled);
  }
}
function updateTransitionPropertiesVisibility(type) {
  const visible = type === 'square' || type === 'pulse' || type === 'serial';
  document.querySelectorAll('.transition-property').forEach((property) => {
    property.hidden = !visible;
  });
}
function updateSymmetryVisibility(type) {
  $('symmetryProperty').hidden = type !== 'triangle';
  $('symmetryPresets').hidden = type !== 'triangle';
}
function updateRcVisibility(type) {
  $('rcProperty').hidden = type !== 'rc';
}
function updateNoisePropertiesVisibility(type) {
  $('noiseColorProperty').hidden = type !== 'noise';
}
$('noiseColorSelect').addEventListener('change', () => {
  const noiseColor = $('noiseColorSelect').value === 'pink' ? 'pink' : 'white';
  if (state.type === 'noise' && !confirmWaveformReplacement()) {
    $('noiseColorSelect').value = state.noiseColor;
    return;
  }
  state.noiseColor = noiseColor;
  if (state.type === 'noise') generate('noise', true, true, true, false);
  else persistCurrentSettings();
});
function selectPreset(type) {
  document.querySelector('.preset.active')?.classList.remove('active');
  document.querySelector(`.preset[data-wave="${type}"]`)?.classList.add('active');
  updateDutyAvailability(type);
  updateDcPropertyAvailability(type);
  updateTransitionPropertiesVisibility(type);
  updateNoisePropertiesVisibility(type);
  updateSymmetryVisibility(type);
  updateRcVisibility(type);
  updateSerialPropertiesVisibility(type);
  updateFunctionSelect(type);
}
function beginEditorSelection(event) {
  const point = canvasPoint(event),
    selection = currentEditorSelection(),
    view = currentEditorViewport(),
    canvasBounds = canvas.getBoundingClientRect(),
    markerTolerance = Math.max(
      1,
      Math.round((view.pointsPerScreen * 9) / Math.max(1, canvasBounds.width - 76)),
    );
  const leftDistance = selection ? Math.abs(point.i - selection.left) : Infinity,
    rightDistance = selection ? Math.abs(point.i - selection.right) : Infinity;
  if (selection?.left === selection?.right && leftDistance <= markerTolerance) {
    editorSelection.origin = selection.left;
    editorSelection.dragging = 'range';
  } else if (Math.min(leftDistance, rightDistance) <= markerTolerance) {
    editorSelection.dragging = leftDistance <= rightDistance ? 'left' : 'right';
  } else {
    editorSelection.left = point.i;
    editorSelection.right = point.i;
    editorSelection.origin = point.i;
    editorSelection.dragging = 'range';
  }
  canvas.setPointerCapture(event.pointerId);
  draw();
}

function moveEditorSelection(event) {
  if (!editorSelection.dragging) return;
  const pointIndex = canvasPoint(event).i;
  if (editorSelection.dragging === 'left') {
    editorSelection.left = Math.min(pointIndex, editorSelection.right);
  } else if (editorSelection.dragging === 'right') {
    editorSelection.right = Math.max(pointIndex, editorSelection.left);
  } else {
    editorSelection.left = Math.min(editorSelection.origin, pointIndex);
    editorSelection.right = Math.max(editorSelection.origin, pointIndex);
  }
  draw();
}

function finishEditorSelection() {
  editorSelection.dragging = null;
  editorSelection.origin = null;
}
canvas.addEventListener('pointerdown', (e) => {
  if (globalThis.ARBDRAW_EDITOR_MODES?.isAdvanced() === false) return;
  if (state.tool === 'pointer') return;
  if (state.tool === 'selection') {
    beginEditorSelection(e);
    return;
  }
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  globalThis.updateAudioPlaybackButton?.();
  state.drawing = true;
  state.drawingChanged = false;
  canvas.setPointerCapture(e.pointerId);
  const p = canvasPoint(e);
  if (state.high === state.low && state.tool !== 'pan' && editorEditIndexRange(p.i)) {
    state.high = Math.max(state.high, p.v);
    state.low = Math.min(state.low, p.v);
    $('highInput').value = displayVoltage('highInput', state.high);
    $('lowInput').value = displayVoltage('lowInput', state.low);
    $('amplitudeInput').value = displayAmplitude(state.high - state.low);
    $('offsetInput').value = displayVoltage('offsetInput', (state.high + state.low) / 2);
  }
  state.lineStart = state.tool === 'line' ? p : null;
  state.lastPoint = p;
  state.drawingChanged = editAt(p);
});
canvas.addEventListener('pointermove', (e) => {
  const p = canvasPoint(e);
  const bounds = voltageBounds();
  const voltageUnit = axisVoltageUnitFor(bounds.low, bounds.high);
  canvas.classList.toggle(
    'waveform-hover',
    (state.tool === 'pencil' || state.tool === 'erase') && pointerIsNearWaveform(e),
  );
  $('cursorReadout').style.display = 'block';
  $('cursorReadout').innerHTML =
    `${p.i} pts &nbsp; ${(p.v / voltageUnit.scaleV).toPrecision(5)} ${voltageUnit.label}`;
  if (editorSelection.dragging) {
    moveEditorSelection(e);
  } else if (state.drawing) {
    const changed = editAt(
      p,
      state.tool === 'pencil' || state.tool === 'erase' ? state.lastPoint : null,
    );
    state.drawingChanged = changed || state.drawingChanged;
    state.lastPoint = p;
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (editorSelection.dragging) {
    moveEditorSelection(e);
    finishEditorSelection();
    return;
  }
  if (state.drawing && state.tool === 'line')
    state.drawingChanged = editAt(canvasPoint(e)) || state.drawingChanged;
  if (state.drawingChanged) pushHistory();
  state.drawing = false;
  state.drawingChanged = false;
  state.lineStart = null;
});
canvas.addEventListener('pointercancel', finishEditorSelection);
canvas.addEventListener('pointerleave', () => {
  canvas.classList.remove('waveform-hover');
  $('cursorReadout').style.display = 'none';
});

function setEditorPointsPerScreen(value) {
  const view = currentEditorViewport(),
    requestedPoints = Number(value),
    normalized = normalizeEditorViewport(
      { pointsPerScreen: Number.isFinite(requestedPoints) ? requestedPoints : view.pointsPerScreen },
      view.total,
    );
  setEditorViewport({
    pointsPerScreen: normalized.pointsPerScreen,
    start: view.center - Math.round((normalized.pointsPerScreen - 1) / 2),
  });
}

function moveEditorViewport(direction) {
  const view = currentEditorViewport(),
    step = Math.max(1, Math.round(view.pointsPerScreen / 10));
  setEditorViewportCenter(view.center + direction * step);
}

function zoomEditorViewport(direction) {
  const view = currentEditorViewport();
  setEditorPointsPerScreen(
    direction < 0
      ? Math.max(2, Math.floor(view.pointsPerScreen / 2))
      : Math.min(view.total, view.pointsPerScreen * 2),
  );
}

function handleEditorNavigationKey(event) {
  if ((event.key !== 'Home' && event.key !== 'End') || event.ctrlKey || event.metaKey || event.altKey)
    return false;
  event.preventDefault();
  event.stopPropagation();
  const view = currentEditorViewport();
  if (event.shiftKey) setEditorViewportCenter(Math.round((view.total - 1) / 2));
  else setEditorViewport({ start: event.key === 'Home' ? 0 : view.maximumStart });
  return true;
}

$('editorPointsDecrease').addEventListener('click', () => {
  zoomEditorViewport(-1);
});
$('editorPointsIncrease').addEventListener('click', () => {
  zoomEditorViewport(1);
});
$('editorPointsPerScreen').addEventListener('change', (event) => {
  setEditorPointsPerScreen(event.target.value);
});
$('editorPosition').addEventListener('input', (event) => {
  setEditorViewportCenter(event.target.value);
});
$('editorPosition').addEventListener('wheel', (event) => {
  if (!event.shiftKey) return;
  event.preventDefault();
  moveEditorViewport(event.deltaY < 0 ? 1 : -1);
}, { passive: false });
$('editorPosition').addEventListener('keydown', handleEditorNavigationKey);
$('editorPositionIncrease').addEventListener('click', () => moveEditorViewport(1));
$('editorPositionDecrease').addEventListener('click', () => moveEditorViewport(-1));
$('editorFullRecord').addEventListener('click', () => {
  setEditorViewport({ start: 0, pointsPerScreen: editorRecordLength() });
});
$('editorSelectionClear').addEventListener('click', clearEditorSelection);
canvas.addEventListener('wheel', (event) => {
  if (!event.deltaY) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  if (event.altKey) zoomEditorViewport(direction > 0 ? -1 : 1);
  else if (event.shiftKey) moveEditorViewport(direction);
  else {
    const view = currentEditorViewport();
    setEditorViewportCenter(view.center + direction);
  }
}, { passive: false });

const editorOverview = $('editorRecordOverview');
const editorViewportWindow = $('editorViewportWindow');
let editorViewportDragOffset = 0;

function dragEditorViewport(clientX) {
  const view = currentEditorViewport(),
    overviewBounds = editorOverview.getBoundingClientRect(),
    windowBounds = editorViewportWindow.getBoundingClientRect(),
    availablePixels = Math.max(0, overviewBounds.width - windowBounds.width),
    viewportLeft = Math.max(
      0,
      Math.min(availablePixels, clientX - overviewBounds.left - editorViewportDragOffset),
    ),
    start = availablePixels
      ? Math.round((viewportLeft / availablePixels) * view.maximumStart)
      : 0;
  editorViewport.start = start;
  draw();
}

editorViewportWindow.addEventListener('pointerdown', (event) => {
  const view = currentEditorViewport();
  if (!view.maximumStart) return;
  event.preventDefault();
  event.stopPropagation();
  editorViewportDragOffset = event.clientX - editorViewportWindow.getBoundingClientRect().left;
  editorViewportWindow.setPointerCapture(event.pointerId);
});
editorViewportWindow.addEventListener('pointermove', (event) => {
  if (editorViewportWindow.hasPointerCapture(event.pointerId)) dragEditorViewport(event.clientX);
});
editorViewportWindow.addEventListener('pointerup', (event) => {
  if (editorViewportWindow.hasPointerCapture(event.pointerId))
    editorViewportWindow.releasePointerCapture(event.pointerId);
});
editorViewportWindow.addEventListener('pointercancel', (event) => {
  if (editorViewportWindow.hasPointerCapture(event.pointerId))
    editorViewportWindow.releasePointerCapture(event.pointerId);
});
editorViewportWindow.addEventListener('keydown', (event) => {
  if (handleEditorNavigationKey(event)) return;
  const view = currentEditorViewport(),
    step = event.shiftKey ? Math.max(1, Math.round(view.pointsPerScreen / 2)) : 1;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    event.preventDefault();
    setEditorViewport({ start: view.start - step });
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    event.preventDefault();
    setEditorViewport({ start: view.start + step });
  }
});
document.addEventListener('keydown', (event) => {
  if ($('editorView').classList.contains('hidden')) return;
  if (event.target.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  handleEditorNavigationKey(event);
});
editorOverview.addEventListener('pointerdown', (event) => {
  if (event.target === editorViewportWindow) return;
  const bounds = editorOverview.getBoundingClientRect(),
    ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    view = currentEditorViewport();
  setEditorViewportCenter(Math.round(ratio * (view.total - 1)));
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
    if (type === 'triangle') y = 0.8 - 0.6 * ARBDRAW_WAVEFORM_SHAPES.triangleVoltage({ phase: p, low: 0, high: 1, symmetryPercent: state.symmetry });
    if (type === 'rc') y = 0.8 - 0.6 * ARBDRAW_WAVEFORM_SHAPES.rcVoltage({ phase: p, low: 0, high: 1, tau: state.rcTau });

    if (type === 'dc') y = 0.5;
    if (type === 'noise') y = 0.2 + Math.random() * 0.6;
    i ? x.lineTo(i, y * h) : x.moveTo(i, y * h);
  }
  x.stroke();
}
function updateFunctionSelect(type) {
  const label = { rc: 'RC', dc: 'DC' }[type] || type.charAt(0).toUpperCase() + type.slice(1),
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
      if (!generate(type)) {
        selectPreset(state.type);
        closeFunctionSelectMenu();
        return;
      }
      selectPreset(type);
      refreshScopeTime();
      closeFunctionSelectMenu();
    };
  });
function setEditorTool(tool, persist = true) {
  if (tool !== 'pointer' && globalThis.ARBDRAW_EDITOR_MODES?.isAdvanced() === false) return false;
  const button = document.querySelector(`.tool[data-tool="${tool}"]`);
  if (!button) return false;
  document.querySelector('.tool.active')?.classList.remove('active');
  button.classList.add('active');
  state.tool = tool;
  if (persist) persistCurrentSettings();
  return true;
}
setEditorTool(state.tool, false);
document.querySelectorAll('.tool[data-tool]').forEach(
  (button) => (button.onclick = () => setEditorTool(button.dataset.tool)),
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
$('undoBtn').textContent = 'Undo';
$('redoBtn').textContent = 'Redo';
$('undoBtn').onclick = undoWaveform;
$('redoBtn').onclick = redoWaveform;
document.addEventListener('keydown', (event) => {
  const editing = event.target.matches?.('input, textarea, select, [contenteditable="true"]');
  if (editing) return;
  if (handleEditorSelectionEscape(event)) return;
  if (handleEditorToolShortcut(event)) return;
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
