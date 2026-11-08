// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Viewer-only measurements. These values never enter waveform or project state.
(function initializeScopeCursors() {
  const cursors = [
    { id: 'T1', axis: 'time', value: null, button: $('scopeT1Btn') },
    { id: 'T2', axis: 'time', value: null, button: $('scopeT2Btn') },
    { id: 'V1', axis: 'voltage', value: null, button: $('scopeV1Btn') },
    { id: 'V2', axis: 'voltage', value: null, button: $('scopeV2Btn') },
  ];
  const enabled = { time: false, voltage: false };
  let active = null, drag = null, plot = null;
  const editors = [
    { axis: 'time', label: 'X', input: $('scopeXInput'), target: $('scopeXCursor'), unit: $('scopeXUnit'),
      units: new Map([[1e-9, 'ps'], [1e-6, 'ns'], [0.001, 'µs'], [1, 'ms'], [1000, 's']]) },
    { axis: 'voltage', label: 'Y', input: $('scopeYInput'), target: $('scopeYCursor'), unit: $('scopeYUnit'),
      units: new Map([[0.001, 'mV'], [1, 'V']]) },
  ];
  for (const editor of editors) {
    editor.scale = 1;
    editor.unit.value = '1';
    editor.target.value = cursors.find(cursor => cursor.axis === editor.axis).id;
  }

  function selectedCursor(editor) {
    return cursors.find(cursor => cursor.id === editor.target.value && cursor.axis === editor.axis);
  }

  function clearCoordinateErrors() {
    for (const editor of editors) {
      editor.input.setCustomValidity('');
      editor.input.removeAttribute('aria-invalid');
    }
    $('scopeCoordinateError').hidden = true;
    $('scopeCoordinateError').textContent = '';
  }

  function displayCoordinate(editor, value) {
    editor.input.value = Number((value / editor.scale).toPrecision(15)).toString();
    // Retain the canonical value across unit conversions rather than repeatedly
    // parsing a rounded display value. Typing replaces this cached draft.
    editor.draft = { text: editor.input.value, value };
  }

  function renderCoordinates(force = false) {
    $('scopeCoordinateControls').hidden = !enabled.time && !enabled.voltage;
    $('scopeApplyCoordinatesBtn').disabled = !enabled.time && !enabled.voltage;
    for (const editor of editors) {
      for (const element of [editor.input, editor.target, editor.unit]) element.disabled = !enabled[editor.axis];
      const cursor = selectedCursor(editor);
      if (cursor.value === null) continue;
      const { min, span } = range(editor.axis);
      editor.input.min = String(min / editor.scale);
      editor.input.max = String((min + span) / editor.scale);
      // Keep a typed draft on ordinary redraws; a moved or newly selected cursor
      // is authoritative and immediately synchronizes the coordinate field.
      if (force || editor.lastCursor !== cursor || editor.lastValue !== cursor.value) {
        displayCoordinate(editor, cursor.value);
        editor.lastCursor = cursor;
        editor.lastValue = cursor.value;
        clearCoordinateErrors();
      }
    }
  }

  function coordinateValue(editor) {
    const text = editor.input.value.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return NaN;
    return editor.draft?.text === editor.input.value ? editor.draft.value : Number(text) * editor.scale;
  }

  function coordinateError(editor, message) {
    editor.input.setCustomValidity(message);
    editor.input.setAttribute('aria-invalid', 'true');
    $('scopeCoordinateError').textContent = `${editor.label} (${editor.target.value}): ${message}`;
    $('scopeCoordinateError').hidden = false;
    editor.input.reportValidity();
  }

  function applyCoordinates() {
    clearCoordinateErrors();
    const changes = [];
    for (const editor of editors) {
      if (!enabled[editor.axis]) continue;
      const value = coordinateValue(editor), { min, span } = range(editor.axis);
      if (!Number.isFinite(value)) {
        coordinateError(editor, 'Enter a finite number.');
        return;
      }
      if (value < min || value > min + span) {
        coordinateError(editor, `Use a value from ${Number((min / editor.scale).toPrecision(12))} to ${Number(((min + span) / editor.scale).toPrecision(12))} ${editor.units.get(editor.scale)} in the current view.`);
        return;
      }
      changes.push({ cursor: selectedCursor(editor), value });
    }
    if (drag) cancel({ pointerId: drag.pointerId });
    for (const { cursor, value } of changes) cursor.value = value;
    renderCoordinates(true);
    drawScope();
  }

  function selectCursor(cursor) {
    active = cursor;
    editors.find(editor => editor.axis === cursor.axis).target.value = cursor.id;
  }

  function range(axis) {
    return axis === 'time'
      ? { min: scopeState.timeStartMs, span: scopeState.timePerDivMs * 10 }
      : { min: scopeState.verticalPosition - scopeState.voltsPerDiv * scopeState.verticalDivisions / 2,
          span: scopeState.voltsPerDiv * scopeState.verticalDivisions };
  }

  function fraction(cursor) {
    const { min, span } = range(cursor.axis);
    return (cursor.value - min) / span;
  }

  function format(value, axis) {
    const unit = axis === 'time' ? axisTimeUnitFor(Math.abs(value)) : axisVoltageUnitFor(value, value);
    const scaled = value / (axis === 'time' ? unit.scaleMs : unit.scaleV);
    return `${Number(scaled.toPrecision(6))} ${unit.label}`;
  }

  function renderControls() {
    $('scopeTimeCursorsBtn').setAttribute('aria-pressed', String(enabled.time));
    $('scopeVoltageCursorsBtn').setAttribute('aria-pressed', String(enabled.voltage));
    $('scopeTimeMeasurements').hidden = !enabled.time;
    $('scopeVoltageMeasurements').hidden = !enabled.voltage;
    $('scopeCursorHint').hidden = !enabled.time && !enabled.voltage;
    $('scopeResetCursorsBtn').disabled = !enabled.time && !enabled.voltage;
    for (const cursor of cursors) {
      cursor.button.setAttribute('aria-pressed', String(active === cursor));
      if (cursor.value === null) continue;
      const position = fraction(cursor), outside = position < -1e-12 || position > 1 + 1e-12;
      cursor.button.textContent = `${cursor.id}: ${format(cursor.value, cursor.axis)}${outside ? ' (outside view)' : ''}`;
    }
    if (enabled.time) $('scopeTimeDelta').textContent = `Δt: ${format(cursors[1].value - cursors[0].value, 'time')}`;
    if (enabled.voltage) $('scopeVoltageDelta').textContent = `ΔV: ${format(cursors[3].value - cursors[2].value, 'voltage')}`;
    renderCoordinates();
  }

  function reset(axis) {
    const { min, span } = range(axis);
    cursors.filter(cursor => cursor.axis === axis).forEach((cursor, index) => {
      cursor.value = min + span * (index ? 0.75 : 0.25);
    });
  }

  function draw(geometry) {
    plot = geometry;
    renderControls();
    const { ctx, pad, pw, ph, d } = plot;
    if (pw <= 0 || ph <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t, pw, ph);
    ctx.clip();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.font = `bold ${11 * d}px ui-monospace`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    // Paint the selected cursor last so coincident lines remain selectable.
    const ordered = cursors.filter(cursor => cursor !== active).concat(active ? [active] : []);
    for (const cursor of ordered) {
      if (!enabled[cursor.axis]) continue;
      const f = fraction(cursor);
      if (f < 0 || f > 1) continue;
      const vertical = cursor.axis === 'time', selected = cursor === active;
      const x = vertical ? pad.l + f * pw : pad.l;
      const y = vertical ? pad.t : pad.t + (1 - f) * ph;
      ctx.setLineDash(cursor.id.endsWith('2') ? [7 * d, 4 * d] : [2 * d, 3 * d]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(vertical ? x : pad.l + pw, vertical ? pad.t + ph : y);
      ctx.strokeStyle = '#090d0f';
      ctx.lineWidth = (selected ? 5 : 4) * d;
      ctx.stroke();
      ctx.strokeStyle = cursor.axis === 'time' ? '#7edcff' : '#ffbc7a';
      ctx.lineWidth = (selected ? 2 : 1) * d;
      ctx.stroke();
      const labelX = Math.min(x + 5 * d, pad.l + pw - 28 * d);
      const labelY = Math.min(y + 4 * d, pad.t + ph - 18 * d);
      ctx.fillStyle = selected ? '#f0f5f7' : '#172127';
      ctx.fillRect(labelX - 2 * d, labelY - d, 25 * d, 16 * d);
      ctx.fillStyle = selected ? '#090d0f' : ctx.strokeStyle;
      ctx.fillText(cursor.id, labelX, labelY);
    }
    ctx.restore();
  }

  function hitTest(event, point) {
    if (!plot || plot.pw <= 0 || plot.ph <= 0) return null;
    const bounds = scopeCanvas.getBoundingClientRect(), { pad, pw, ph, d } = plot;
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    if (x < pad.l / d || x > (pad.l + pw) / d || y < pad.t / d || y > (pad.t + ph) / d) return null;
    return cursors.filter(cursor => enabled[cursor.axis]).map(cursor => {
      const f = fraction(cursor);
      const vertical = cursor.axis === 'time';
      const labelX = Math.min((vertical ? pad.l + f * pw : pad.l) / d + 5, (pad.l + pw) / d - 28);
      const labelY = Math.min((vertical ? pad.t : pad.t + (1 - f) * ph) / d + 4, (pad.t + ph) / d - 18);
      const onLabel = x >= labelX - 2 && x <= labelX + 23 && y >= labelY - 1 && y <= labelY + 15;
      const distance = onLabel ? 0 : vertical
        ? Math.abs(f - point.timeFraction) * pw / d
        : Math.abs(1 - f - point.voltageFraction) * ph / d;
      return { cursor, distance: f >= 0 && f <= 1 ? distance : Infinity };
    }).filter(hit => hit.distance <= (event.pointerType === 'touch' ? 16 : 8))
      .sort((a, b) => a.distance - b.distance || Number(b.cursor === active) - Number(a.cursor === active))[0]?.cursor;
  }

  function pointerDown(event, point) {
    if (drag) return true;
    const cursor = hitTest(event, point);
    if (!cursor) return false;
    selectCursor(cursor);
    const pointerFraction = cursor.axis === 'time' ? point.timeFraction : 1 - point.voltageFraction;
    drag = { pointerId: event.pointerId, cursor, original: cursor.value, offset: fraction(cursor) - pointerFraction };
    scopeCanvas.focus({ preventScroll: true });
    scopeCanvas.setPointerCapture(event.pointerId);
    drawScope();
    return true;
  }

  function pointerMove(event, point) {
    if (!drag) return false;
    if (event.pointerId !== drag.pointerId) return true;
    const { min, span } = range(drag.cursor.axis);
    const f = drag.cursor.axis === 'time' ? point.timeFraction : 1 - point.voltageFraction;
    drag.cursor.value = min + Math.max(0, Math.min(1, f + drag.offset)) * span;
    drawScope();
    return true;
  }

  function finish(event, point, cancel = false) {
    if (!drag || event.pointerId !== drag.pointerId) return false;
    if (cancel) drag.cursor.value = drag.original;
    else pointerMove(event, point);
    drag = null;
    if (scopeCanvas.hasPointerCapture(event.pointerId)) scopeCanvas.releasePointerCapture(event.pointerId);
    drawScope();
    return true;
  }

  function cancel(event) { return finish(event, null, true); }

  function keydown(event) {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      cancel({ pointerId: drag.pointerId });
      return;
    }
    if (!active || !enabled[active.axis] || !plot || event.ctrlKey || event.metaKey || event.altKey) return;
    const directions = active.axis === 'time' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowDown: -1, ArrowUp: 1 };
    if (!directions[event.key] && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const { min, span } = range(active.axis);
    const pixels = (active.axis === 'time' ? plot.pw : plot.ph) / plot.d;
    if (pixels <= 0) return;
    const next = event.key === 'Home' ? min : event.key === 'End' ? min + span
      : active.value + directions[event.key] * span / pixels * (event.shiftKey ? 10 : 1);
    active.value = Math.max(min, Math.min(min + span, next));
    drawScope();
  }

  for (const [axis, id] of [['time', 'scopeTimeCursorsBtn'], ['voltage', 'scopeVoltageCursorsBtn']]) {
    $(id).addEventListener('click', () => {
      if (drag) cancel({ pointerId: drag.pointerId });
      enabled[axis] = !enabled[axis];
      if (enabled[axis]) {
        if (cursors.find(cursor => cursor.axis === axis).value === null) reset(axis);
        selectCursor(cursors.find(cursor => cursor.axis === axis));
      } else if (active?.axis === axis) active = cursors.find(cursor => enabled[cursor.axis]) || null;
      renderCoordinates(true);
      drawScope();
    });
  }
  $('scopeResetCursorsBtn').addEventListener('click', () => {
    if (drag) cancel({ pointerId: drag.pointerId });
    for (const axis of ['time', 'voltage']) if (enabled[axis]) reset(axis);
    renderCoordinates(true);
    drawScope();
  });
  for (const cursor of cursors) {
    cursor.button.addEventListener('click', () => { selectCursor(cursor); drawScope(); });
    cursor.button.addEventListener('keydown', event => { selectCursor(cursor); keydown(event); });
  }
  for (const editor of editors) {
    editor.input.addEventListener('input', () => {
      editor.draft = null;
      clearCoordinateErrors();
    });
    editor.input.addEventListener('keydown', event => {
      if (!['Enter', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Enter') applyCoordinates();
      else { clearCoordinateErrors(); renderCoordinates(true); }
    });
    editor.target.addEventListener('change', () => {
      selectCursor(selectedCursor(editor));
      drawScope();
    });
    editor.unit.addEventListener('change', () => {
      const scale = Number(editor.unit.value), value = coordinateValue(editor);
      if (!editor.units.has(scale) || !Number.isFinite(value)) {
        editor.unit.value = String(editor.scale);
        coordinateError(editor, 'Enter a finite number before changing units.');
        return;
      }
      editor.scale = scale;
      displayCoordinate(editor, value);
      clearCoordinateErrors();
      renderCoordinates();
    });
  }
  $('scopeApplyCoordinatesBtn').addEventListener('click', applyCoordinates);
  globalThis.ARBDRAW_SCOPE_CURSORS = { draw, pointerDown, pointerMove,
    pointerUp: (event, point) => finish(event, point), cancel, keydown };
  renderControls();
})();
