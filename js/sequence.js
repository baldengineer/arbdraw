// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// A sequence is one uniformly sampled record with independently editable sources.
function sequenceSegments() {
  return projectDocument.waveform.segments || null;
}

function sequenceOverview() {
  return Boolean(sequenceSegments() && !sequenceSegments()[state.activeSegment]);
}

function sequenceSampleLimit() {
  return sampleLimitForProfile(selectedAwgProfile);
}

function sequenceCapacity(index = state.activeSegment) {
  return sequenceSampleLimit() - (sequenceSegments() || []).reduce(
    (sum, segment, i) => sum + (i === index ? 0 : segment.sampleCount), 0,
  );
}

let sequenceDataRevision = 0, sequenceMetadataRevision = 0;
let synchronizedWaveform = null, synchronizedDataRevision = -1, synchronizedMetadataRevision = -1;
const segmentRevisions = new WeakMap(), sequencePreviewCache = new WeakMap();

// In-place sample writers signal completion via state.samplesEdited = true.
// Structural writers must invalidate data explicitly; replacement documents are detected by identity.
function invalidateSequence(dataChanged = false, segment = editableWaveform()) {
  sequenceMetadataRevision++;
  if (dataChanged) sequenceDataRevision++;
  if (segment) segmentRevisions.set(segment, (segmentRevisions.get(segment) || 0) + 1);
}

function syncSequence() {
  const waveform = projectDocument.waveform, segments = sequenceSegments();
  if (!segments) return;
  if (waveform === synchronizedWaveform && sequenceMetadataRevision === synchronizedMetadataRevision) return;
  for (const segment of segments) segment.sampleRateMSa = waveform.sampleRateMSa;
  Object.assign(waveform, summarizeSegments(segments, waveform.sampleRateMSa,
    waveform !== synchronizedWaveform || sequenceDataRevision !== synchronizedDataRevision));
  synchronizedWaveform = waveform;
  synchronizedDataRevision = sequenceDataRevision;
  synchronizedMetadataRevision = sequenceMetadataRevision;
}

function setSequenceField(key, value) {
  const segments = sequenceSegments(), segment = segments?.[state.activeSegment];
  if (!segment || !['samples', 'frequency', 'cycles'].includes(key)) return false;
  const rate = projectDocument.waveform.sampleRateMSa * 1e6;
  if (key === 'cycles') segment.cycles = value;
  const count = key === 'samples' ? value
    : Math.round(rate * segment.cycles / (key === 'frequency' ? value : segment.frequencyHz));
  segment.sampleCount = Math.max(2, Math.min(Math.round(count), sequenceCapacity()));
  segment.frequencyHz = rate * segment.cycles / segment.sampleCount;
  segment.durationMs = segment.sampleCount / rate * 1000;
  invalidateSequence(false, segment);
  return true;
}

function proposedSequenceTiming(cycles, frequency) {
  if (!sequenceSegments()?.[state.activeSegment]) return null;
  const rate = projectDocument.waveform.sampleRateMSa * 1e6;
  const sampleCount = Math.max(2, Math.min(Math.round(rate * cycles / frequency), sequenceCapacity()));
  return { cycles, sampleCount, frequencyHz: rate * cycles / sampleCount, durationMs: sampleCount / rate * 1000 };
}

function setSequenceTiming(cycles, frequency) {
  const timing = proposedSequenceTiming(cycles, frequency);
  if (!timing) return false;
  Object.assign(editableWaveform(), timing);
  invalidateSequence();
  return true;
}

function selectSequenceSegment(index, commitDraft = true) {
  if (!sequenceSegments()) return false;
  // Commit any live field preview before changing its target.
  if (commitDraft) {
    document.activeElement?.blur();
    finishWaveformPreview();
  }
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  state.activeSegment = sequenceSegments()[index] ? index : null;
  clearEditorSelection(false);
  Object.assign(editorViewport, { start: 0, pointsPerScreen: null, total: null });
  renderDocument();
  refreshScope();
  return true;
}

function addSequenceSegment(type = null) {
  document.activeElement?.blur();
  finishWaveformPreview();
  const segments = sequenceSegments(), source = segments
    ? segments[state.activeSegment] || segments.at(-1) : projectDocument.waveform;
  const count = segments ? segments.length + 1 : 2,
    total = Math.min(recordState().samples, sequenceSampleLimit());
  if (total < count * 2) {
    showToast(`Each segment needs at least 2 points. Increase the total sample count to at least ${count * 2} before adding a segment.`);
    return;
  }
  if ((segments || [source]).some((segment) => segment.samplesEdited)
    && !window.confirm('Adding a segment will divide the AWG’s total points equally among all segments and regenerate their waveforms. You will lose any arbitrary edits to the existing waveform samples. Continue?')) return;
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  if (!segments) {
    const original = cloneWaveform(source);
    // Preserve the current output period when establishing the shared clock.
    projectDocument.waveform.sampleRateMSa = original.sampleCount * original.frequencyHz
      / original.cycles / 1e6;
    original.sampleRateMSa = projectDocument.waveform.sampleRateMSa;
    original.durationMs = original.sampleCount / (original.sampleRateMSa * 1000);
    projectDocument.waveform.segments = [original, cloneWaveform(original)];
  } else segments.push(cloneWaveform(source));
  invalidateSequence(true);
  if (type) sequenceSegments().at(-1).type = type;
  // Keep the record length and shared clock; distribute leftover whole points.
  const points = Math.floor(total / count), remainder = total % count,
    rate = projectDocument.waveform.sampleRateMSa * 1e6;
  sequenceSegments().forEach((segment, index) => {
    segment.sampleCount = points + (index < remainder ? 1 : 0);
    segment.frequencyHz = rate * segment.cycles / segment.sampleCount;
    segment.durationMs = segment.sampleCount / rate * 1000;
  });
  sequenceSegments().forEach((segment, index) => {
    state.activeSegment = index;
    generate(segment.type, false, false, false, false, false, true);
  });
  setEditorMode('advanced', { render: false });
  selectSequenceSegment(sequenceSegments().length - 1, false);
  renderAwgTiming();
  pushHistory();
}

function moveSequenceSegment(from, to) {
  const segments = sequenceSegments();
  if (!Number.isInteger(from) || !Number.isInteger(to) || !segments?.[from]
    || !segments[to] || from === to) return false;
  document.activeElement?.blur();
  finishWaveformPreview();
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  const selected = segments[state.activeSegment];
  // Move the existing source and sample buffer intact. Only the record is rebuilt.
  segments.splice(to, 0, segments.splice(from, 1)[0]);
  state.activeSegment = selected ? segments.indexOf(selected) : null;
  invalidateSequence(true, null);
  renderDocument();
  renderAwgTiming();
  refreshScope();
  pushHistory();
  return true;
}

let segmentDrag = null;
function clearSegmentDropIndicators(strip) {
  strip.querySelectorAll('.segment-card').forEach((card) => {
    card.classList.remove('segment-drop-before', 'segment-drop-after');
  });
}

function finishSegmentDrag() {
  const strip = $('editorSegments');
  clearSegmentDropIndicators(strip);
  strip.querySelectorAll('.segment-dragging').forEach((card) => card.classList.remove('segment-dragging'));
  segmentDrag = null;
}

function bindSequenceSegmentDrag(select, index) {
  select.draggable = true;
  select.title = 'Drag to reorder. Alt+Left/Right moves this segment one position.';
  select.setAttribute('aria-keyshortcuts', 'Alt+ArrowLeft Alt+ArrowRight');
  select.ondragstart = (event) => {
    document.activeElement?.blur();
    finishWaveformPreview();
    segmentDrag = { segments: sequenceSegments(), segment: sequenceSegments()[index] };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `Segment ${index + 1}`);
    select.parentElement.classList.add('segment-dragging');
  };
  select.ondragend = finishSegmentDrag;
  select.addEventListener('keydown', (event) => {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowLeft' ? -1 : 1);
    if (moveSequenceSegment(index, to)) {
      const moved = $('editorSegments').querySelectorAll('.segment-select')[to];
      moved.focus();
      moved.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      showToast(`Segment moved to position ${to + 1}`);
    }
  });
}

function bindSequenceReordering(strip) {
  const dropPosition = (event) => {
    if (!segmentDrag || segmentDrag.segments !== sequenceSegments()) return null;
    const from = sequenceSegments().indexOf(segmentDrag.segment);
    if (from < 0) return null;
    const cards = [...strip.querySelectorAll('.segment-card')];
    let boundary = cards.findIndex((card) => {
      const rect = card.getBoundingClientRect();
      return event.clientX < rect.left + rect.width / 2;
    });
    if (boundary < 0) boundary = cards.length;
    return { cards, boundary, from, to: boundary > from ? boundary - 1 : boundary };
  };
  strip.ondragover = (event) => {
    const position = dropPosition(event);
    if (!position) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearSegmentDropIndicators(strip);
    const { cards, boundary } = position;
    (cards[boundary] || cards.at(-1)).classList.add(
      boundary === cards.length ? 'segment-drop-after' : 'segment-drop-before');
    const rect = strip.getBoundingClientRect();
    if (event.clientX < rect.left + 28) strip.scrollLeft -= 20;
    else if (event.clientX > rect.right - 28) strip.scrollLeft += 20;
  };
  strip.ondragleave = (event) => {
    if (!strip.contains(event.relatedTarget)) clearSegmentDropIndicators(strip);
  };
  strip.ondrop = (event) => {
    const position = dropPosition(event);
    if (!position) return;
    event.preventDefault();
    finishSegmentDrag();
    moveSequenceSegment(position.from, position.to);
  };
}

function removeSequenceSegment(index) {
  const segments = sequenceSegments();
  if (!segments?.[index]) return;
  document.activeElement?.blur();
  finishWaveformPreview();
  globalThis.ARBDRAW_AUDIO_PLAYBACK?.stop();
  segments.splice(index, 1);
  invalidateSequence(true);
  if (segments.length === 1) {
    const remaining = segments[0];
    remaining.sampleRateMSa = projectDocument.waveform.sampleRateMSa;
    projectDocument.waveform = remaining;
    state.activeSegment = null;
    renderDocument();
  } else selectSequenceSegment(Math.min(index, segments.length - 1));
  renderAwgTiming();
  pushHistory();
}

function leaveSequence() {
  const segments = sequenceSegments();
  if (!segments) return;
  const waveform = cloneWaveform(segments[state.activeSegment] || segments[0]);
  waveform.sampleRateMSa = projectDocument.waveform.sampleRateMSa;
  projectDocument.waveform = waveform;
  state.activeSegment = null;
}

function drawSequencePreview(canvas, segment) {
  const revision = segmentRevisions.get(segment) || 0, previous = sequencePreviewCache.get(canvas);
  if (previous?.segment === segment && previous.revision === revision
    && previous.color === DEFAULT_VALUES.arbitraryEditorColor) return;
  sequencePreviewCache.set(canvas, { segment, revision, color: DEFAULT_VALUES.arbitraryEditorColor });
  const context = canvas.getContext('2d'), width = canvas.width = 160, height = canvas.height = 36;
  context.clearRect(0, 0, width, height);
  const span = Math.max(0.000001, segment.highVoltage - segment.lowVoltage);
  context.beginPath();
  // Min/max buckets preserve narrow pulses in a compact thumbnail.
  for (let x = 0; x < width; x++) {
    const start = Math.floor(x * segment.values.length / width),
      end = Math.min(segment.values.length, Math.max(start + 1, Math.floor((x + 1) * segment.values.length / width)));
    let low = Infinity, high = -Infinity;
    for (let i = start; i < end; i++) {
      low = Math.min(low, segment.values[i]); high = Math.max(high, segment.values[i]);
    }
    if (!Number.isFinite(low)) continue;
    const y = (value) => 3 + (segment.highVoltage - value) / span * (height - 6);
    context.lineTo(x, y(high)); context.lineTo(x, y(low));
  }
  context.strokeStyle = DEFAULT_VALUES.arbitraryEditorColor;
  context.lineWidth = 1;
  context.stroke();
}

let segmentCardCount = -1;
let segmentCountFields = [];
function refreshSequence() {
  syncSequence();
  const segments = sequenceSegments(), overview = sequenceOverview(), strip = $('editorSegments');
  strip.hidden = !segments;
  $('editorSequenceControls').hidden = !segments;
  document.documentElement.dataset.sequenceOverview = String(overview);
  $('inspectorControls').disabled = overview || !$('waveformView').classList.contains('hidden');
  $('samplesEdit').disabled = overview;
  $('awgProfileSelect').disabled = Boolean(segments);
  $('awgProfileSelect').title = segments ? 'Remove the sequence before changing its AWG profile.' : '';
  $('sequenceHint').hidden = !segments;
  $('sequenceHint').textContent = overview
    ? 'Full sequence · select a segment to edit its source and samples'
    : `Segment ${(state.activeSegment ?? 0) + 1} · properties and samples apply to this segment`;
  if (!segments) { segmentCardCount = -1; return; }
  if (segmentCardCount !== segments.length) {
    segmentCountFields.forEach((field) => field.destroy());
    segmentCountFields = [];
    strip.replaceChildren();
    segments.forEach((segment, index) => {
      const card = document.createElement('div');
      card.className = 'segment-card';
      const select = document.createElement('button');
      select.type = 'button'; select.className = 'segment-select';
      bindSequenceSegmentDrag(select, index);
      const label = document.createElement('span'); label.textContent = `Segment ${index + 1}`;
      const preview = document.createElement('canvas'); preview.setAttribute('aria-hidden', 'true');
      const shape = document.createElement('span'); shape.className = 'segment-shape';
      select.append(label, preview, shape);
      select.onclick = () => selectSequenceSegment(index);
      const countLabel = document.createElement('label'); countLabel.textContent = 'pts';
      const count = document.createElement('input'); count.type = 'number'; count.min = 2; count.step = 1;
      count.id = `segmentCount${index}`;
      count.value = segment.sampleCount;
      count.setAttribute('aria-label', `Segment ${index + 1} sample count`);
      countLabel.prepend(count);
      const remove = document.createElement('button'); remove.type = 'button';
      remove.className = 'segment-remove'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove segment ${index + 1}`);
      remove.onclick = () => removeSequenceSegment(index);
      card.append(select, countLabel, remove); strip.append(card);
      segmentCountFields.push(ARBDRAW_FIELDS.attach(count, {
        id: count.id, kind: 'number', decimalPlaces: 0, liveUpdate: false,
        constraints: { min: 2, integer: true, validate: (value) => value <= sequenceCapacity(index)
          ? { valid: true, value } : { valid: false, message: 'Exceeds the AWG record limit.' } },
      }, {
        read: () => sequenceSegments()[index].sampleCount,
        commit: (value) => {
          if (value === sequenceSegments()[index].sampleCount) return;
          selectSequenceSegment(index, false);
          $('samplesEdit').value = value / sampleCountUnitScale;
          commitTimingInput('samples');
          if (sequenceSegments()[index].sampleCount !== value) {
            count.value = sequenceSegments()[index].sampleCount;
            return false;
          }
        },
      }));
    });
    const add = document.createElement('button'); add.type = 'button';
    add.className = 'segment-add'; add.textContent = '+';
    add.setAttribute('aria-label', 'Add segment');
    bindSegmentAddButton(add);
    strip.append(add); segmentCardCount = segments.length;
    bindSequenceReordering(strip);
  }
  [...strip.querySelectorAll('.segment-card')].forEach((card, index) => {
    const segment = segments[index], selected = index === state.activeSegment;
    card.classList.toggle('active', selected);
    card.querySelector('.segment-select').setAttribute('aria-pressed', String(selected));
    card.querySelector('.segment-shape').textContent = titles[segment.type];
    const input = card.querySelector('input');
    segmentCountFields[index].refresh();
    input.max = sequenceCapacity(index);
    drawSequencePreview(card.querySelector('canvas'), segment);
  });
}

function updateSequenceOverviewWindow() {
  const segments = sequenceSegments();
  if (!segments) return;
  const waveform = projectDocument.waveform, selected = segments[state.activeSegment];
  $('editorFullRecord').disabled = !selected && currentEditorViewport().pointsPerScreen >= waveform.sampleCount;
  if (!selected) return;
  const offset = segments.slice(0, state.activeSegment).reduce((sum, segment) => sum + segment.sampleCount, 0);
  $('editorViewportWindow').style.left = `${offset / waveform.sampleCount * 100}%`;
  $('editorViewportWindow').style.width = `${selected.sampleCount / waveform.sampleCount * 100}%`;
  $('editorViewportWindow').setAttribute('aria-valuetext', `Segment ${state.activeSegment + 1}; activate to show full sequence`);
  $('editorViewportWindow').setAttribute('aria-disabled', 'false');
}

globalThis.ARBDRAW_SEQUENCE = {
  hasSegments: () => Boolean(sequenceSegments()),
  sync: syncSequence, refresh: refreshSequence, setField: setSequenceField,
  invalidate: invalidateSequence,
  capacity: sequenceCapacity,
  proposedTiming: proposedSequenceTiming, setTiming: setSequenceTiming,
  updateOverviewWindow: updateSequenceOverviewWindow,
  isOverview: sequenceOverview, leave: leaveSequence,
  showOverview: () => {
    if (!sequenceSegments() || sequenceOverview()) return false;
    return selectSequenceSegment(null);
  },
};
function bindSegmentAddButton(button) {
  button.title = 'Choose a waveshape for the new segment';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-controls', 'functionSelectMenu');
  button.setAttribute('aria-expanded', 'false');
  const openMenu = () => openFunctionSelectMenu(button, (type) => addSequenceSegment(type));
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    openMenu();
  });
  button.onclick = openMenu;
}
bindSegmentAddButton($('addSegmentsBtn'));
