// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Stacked signal lanes share one horizontal coordinate system and viewport.
(() => {
  const enabled = () => (projectDocument.signals?.length || 0) > 1;
  const colors = ['#7bffb2', '#69b0e0', '#ffe45e', '#df9cff', '#ffac77', '#80e4e8'];
  const waveformFor = signal => signal === activeSignal() ? editableWaveform() : signal.waveform;
  const intervalFor = (signal, waveform = waveformFor(signal)) => signal.waveform.segments
    ? 1 / (signal.waveform.sampleRateMSa * 1e6)
    : Math.max(1, waveform.cycles) / waveform.frequencyHz / waveform.sampleCount;
  const coordinateScale = signal => editorAxisMode === 'time'
    ? intervalFor(signal) / intervalFor(activeSignal()) : 1;

  function recordLength() {
    if (!enabled()) return null;
    const last = projectDocument.signals.reduce((maximum, signal) => Math.max(maximum,
      (waveformFor(signal).sampleCount - 1) * coordinateScale(signal)), 0);
    return Math.ceil(last - Math.max(1, last) * Number.EPSILON * 4) + 1;
  }

  function captureView() {
    if (!enabled()) return null;
    const view = currentEditorViewport(), scale = editorAxisMode === 'time' ? intervalFor(activeSignal()) : 1;
    return { full: view.pointsPerScreen >= view.total, start: view.start * scale, end: view.end * scale };
  }

  function restoreView(view) {
    const scale = editorAxisMode === 'time' ? intervalFor(activeSignal()) : 1;
    Object.assign(editorViewport, { start: view.full ? 0 : Math.round(view.start / scale),
      pointsPerScreen: view.full ? null : Math.max(2, Math.round((view.end - view.start) / scale) + 1), total: null });
  }

  function refreshLayout() {
    const frame = canvas.parentElement;
    frame.style.minHeight = enabled() ? `${projectDocument.signals.length * 84 + 59}px` : '';
    frame.parentElement.classList.toggle('signal-grid-scroll', enabled());
    canvas.setAttribute('aria-label', enabled()
      ? 'Stacked signal grid. Click a signal row to select it, then edit that row. Use the Selected signal dropdown for keyboard selection.'
      : 'Waveform editor');
  }

  function geometry(width, height, d = 1) {
    const left = 108 * d, right = 18 * d, top = 20 * d, bottom = 39 * d;
    const laneHeight = (height - top - bottom) / projectDocument.signals.length;
    return { left, right, top, bottom, width: width - left - right, laneHeight,
      lanes: projectDocument.signals.map((signal, index) => ({ signal, index,
        top: top + index * laneHeight, bottom: top + (index + 1) * laneHeight,
        plotTop: top + index * laneHeight + 12 * d, plotHeight: Math.max(1, laneHeight - 24 * d) })) };
  }

  function revealActive() {
    if (!enabled()) return;
    const frame = canvas.parentElement, stage = frame.parentElement;
    if (!stage.clientHeight) return;
    const lane = geometry(frame.clientWidth, frame.clientHeight).lanes.find(lane => lane.signal === activeSignal());
    if (lane.top < stage.scrollTop) stage.scrollTop = lane.top;
    else if (lane.bottom > stage.scrollTop + stage.clientHeight)
      stage.scrollTop = lane.bottom - stage.clientHeight;
  }

  function boundsFor(waveform) {
    let low = waveform.lowVoltage, high = waveform.highVoltage;
    for (const value of waveform.values) { low = Math.min(low, value); high = Math.max(high, value); }
    if (low === high) { const span = Math.max(5, Math.abs(high)); low -= span; high += span; }
    return { low, high };
  }

  function trace(context, signal, bounds, view, left, top, width, height, d, color) {
    const waveform = waveformFor(signal), values = waveform.values, scale = coordinateScale(signal);
    const first = Math.max(0, Math.floor(view.start / scale));
    const last = Math.min(values.length - 1, Math.ceil(view.end / scale));
    if (last < first) return;
    const step = Math.max(1, Math.floor((last - first) / Math.max(1, width / d * 2)));
    context.save();
    context.beginPath(); context.rect(left, top, width, height); context.clip();
    context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 1.5 * d;
    context.beginPath();
    function point(index, move) {
      const x = left + (index * scale - view.start) / Math.max(1, view.end - view.start) * width;
      const y = top + (bounds.high - values[index]) / (bounds.high - bounds.low) * height;
      if (state.waveformRenderMode === 'dots') {
        context.beginPath(); context.arc(x, y, 1.5 * d, 0, Math.PI * 2); context.fill();
      } else if (move) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    for (let index = first; index <= last; index += step) point(index, index === first);
    if ((last - first) % step) point(last, false);
    if (state.waveformRenderMode !== 'dots') context.stroke();
    context.restore();
  }

  function draw(context, width, height, d, view) {
    if (!enabled()) return false;
    const grid = geometry(width, height, d), active = activeSignal();
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#090d0f'; context.fillRect(0, 0, width, height);
    const selectedLane = grid.lanes.find(lane => lane.signal === active);
    context.fillStyle = '#142322';
    context.fillRect(0, selectedLane.top, width, grid.laneHeight);
    context.font = `${10 * d}px ui-monospace`;
    context.lineWidth = d;
    const interval = intervalFor(active), unit = axisTimeUnitFor(view.end * interval * 1000);
    const ticks = editorAxisMode === 'time' ? editorTimeTicks(view, interval) : editorPointTicks(view.start, view.end);
    for (const index of ticks) {
      const x = grid.left + (index - view.start) / Math.max(1, view.end - view.start) * grid.width;
      context.strokeStyle = '#293739'; context.beginPath();
      context.moveTo(x, grid.top); context.lineTo(x, height - grid.bottom); context.stroke();
      context.fillStyle = '#91a4a6'; context.textAlign = 'center'; context.textBaseline = 'top';
      context.fillText(editorAxisMode === 'time'
        ? Number((index * interval * 1000 / unit.scaleMs).toPrecision(9)) : index, x, height - grid.bottom + 10 * d);
    }
    for (const lane of grid.lanes) {
      const waveform = waveformFor(lane.signal), bounds = boundsFor(waveform);
      const color = lane.signal === active ? editorWaveformColor() : colors[lane.index % colors.length];
      for (let division = 0; division <= 4; division++) {
        const y = lane.plotTop + lane.plotHeight * division / 4;
        context.strokeStyle = division === 2 ? '#405452' : '#202d30';
        context.beginPath(); context.moveTo(grid.left, y); context.lineTo(width - grid.right, y); context.stroke();
      }
      context.strokeStyle = '#3b4a4c'; context.beginPath();
      context.moveTo(0, lane.bottom); context.lineTo(width - grid.right, lane.bottom); context.stroke();
      context.textAlign = 'left'; context.textBaseline = 'middle'; context.fillStyle = color;
      const name = lane.signal.name.length > 14 ? lane.signal.name.slice(0, 13) + '…' : lane.signal.name;
      context.fillText(name, 8 * d, lane.top + grid.laneHeight / 2, 94 * d);
      const voltageUnit = axisVoltageUnitFor(bounds.low, bounds.high);
      context.fillStyle = '#91a4a6';
      context.fillText(`${Number((bounds.high / voltageUnit.scaleV).toPrecision(3))} ${voltageUnit.label}`, 8 * d, lane.plotTop);
      context.fillText(`${Number((bounds.low / voltageUnit.scaleV).toPrecision(3))} ${voltageUnit.label}`, 8 * d, lane.plotTop + lane.plotHeight);
      if (lane.signal === active) { context.fillStyle = color; context.fillRect(0, lane.top + 2 * d, 3 * d, grid.laneHeight - 4 * d); }
      trace(context, lane.signal, bounds, view, grid.left, lane.plotTop, grid.width, lane.plotHeight, d, color);
      if (lane.signal === active) drawEditorSelection(view,
        { l: grid.left, t: lane.plotTop }, grid.width, lane.plotHeight, d);
    }
    $('editorPointAxisLabel').textContent = editorAxisMode === 'time' ? `TIME (${unit.label})` : 'POINTS';
    $('editorVoltageAxisLabel').textContent = 'VOLTAGE (PER SIGNAL)';
    return true;
  }

  function drawOverview(context, width, height, d) {
    if (!enabled()) return false;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#090d0f'; context.fillRect(0, 0, width, height);
    const view = { start: 0, end: recordLength() - 1 };
    const laneHeight = height / projectDocument.signals.length;
    projectDocument.signals.forEach((signal, index) => trace(context, signal, boundsFor(waveformFor(signal)),
      view, 0, index * laneHeight + d, width, Math.max(1, laneHeight - 2 * d), d,
      signal === activeSignal() ? editorWaveformColor() : colors[index % colors.length]));
    return true;
  }

  function pointer(event) {
    const rect = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
    return { x: (event.clientX - rect.left) * d, y: (event.clientY - rect.top) * d,
      grid: geometry(canvas.width, canvas.height, d), d };
  }

  function selectLane(event) {
    if (!enabled()) return false;
    const { x, y, grid } = pointer(event);
    const lane = grid.lanes.find(lane => y >= lane.top && y < lane.bottom);
    if (!lane || x > canvas.width - grid.right) return true;
    if (lane.signal !== activeSignal()) { activateSignal(lane.signal.id); return true; }
    return x < grid.left || canvasPoint(event).outsideLane;
  }

  function canvasPoint(event) {
    if (!enabled()) return null;
    const { x, y, grid } = pointer(event), lane = grid.lanes.find(lane => lane.signal === activeSignal());
    const view = currentEditorViewport(), bounds = boundsFor(waveformFor(activeSignal()));
    const index = Math.round(view.start + Math.max(0, Math.min(1, (x - grid.left) / grid.width)) * (view.end - view.start));
    return { i: index,
      v: Math.max(bounds.low, Math.min(bounds.high, bounds.high - (y - lane.plotTop) / lane.plotHeight * (bounds.high - bounds.low))),
      outsideLane: y < lane.top || y >= lane.bottom || x < grid.left || x > canvas.width - grid.right
        || index >= state.data.length };
  }

  function nearWaveform(event) {
    const point = canvasPoint(event);
    if (point.outsideLane) return false;
    const { grid, d } = pointer(event), lane = grid.lanes.find(lane => lane.signal === activeSignal());
    const bounds = boundsFor(waveformFor(activeSignal()));
    return Math.abs(point.v - state.data[point.i]) / (bounds.high - bounds.low) * lane.plotHeight <= 7 * d;
  }

  globalThis.ARBDRAW_SIGNAL_GRID = { enabled, recordLength, captureView, restoreView, refreshLayout, revealActive,
    geometry, draw, drawOverview, selectLane, canvasPoint, nearWaveform };
})();
