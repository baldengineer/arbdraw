const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('editor horizontal scale uses point indices', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const draw = source.slice(source.indexOf('function draw()'), source.indexOf('function updateWaveformModeButton()'));
  const pointerMove = source.slice(
    source.indexOf("canvas.addEventListener('pointermove'"),
    source.indexOf("canvas.addEventListener('pointerup'"),
  );
  const pointerMapping = source.slice(
    source.indexOf('function canvasPoint('),
    source.indexOf('function editAt('),
  );

  assert.match(html, /id="editorPointAxisLabel"[^>]*>POINTS<\/div>/);
  assert.match(html, /id="cursorReadout"[^>]*>0 pts &nbsp; 0\.000 V<\/div>/);
  assert.match(html, /id="editorRecordOverview"/);
  assert.match(html, /id="editorPointsPerScreen"/);
  assert.match(html, /id="editorPosition"/);
  assert.match(html, /id="editorPosition"[^>]*title="Shift\+wheel accelerates position changes"/);
  assert.match(html, /id="editorFullRecord"[^>]*>Full Record<\/button>/);
  assert.ok(html.indexOf('id="waveCanvas"') < html.indexOf('id="editorRecordOverview"'));
  assert.ok(html.indexOf('id="editorRecordOverview"') < html.indexOf('class="editor-navigation"'));
  assert.match(draw, /pointTicks = editorPointTicks\(view\.start, view\.end\)/);
  assert.match(draw, /for \(const pointIndex of pointTicks\)/);
  assert.match(draw, /\(pw \* \(pointIndex - view\.start\)\) \/ visiblePointSpan/);
  assert.match(draw, /ctx\.fillText\(pointIndex,/);
  assert.doesNotMatch(draw, /Math\.round/);
  assert.doesNotMatch(draw, /waveformDurationMs|axisTimeUnitFor/);
  assert.match(pointerMove, /`\$\{p\.i\} pts &nbsp;/);
  assert.doesNotMatch(pointerMove, /waveformDurationMs|axisTimeUnitFor/);
  assert.match(pointerMapping, /view = currentEditorViewport\(\)/);
  assert.match(pointerMapping, /view\.start \+ pointRatio \* \(view\.end - view\.start\)/);
  assert.match(pointerMapping, /samplePosition = view\.start \+/);
  assert.match(source, /editorPosition'\)\.addEventListener\('input'/);
});

test('editor point ticks are actual array indices', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helper = source.slice(
    source.indexOf('function editorPointTicks('),
    source.indexOf('function draw()'),
  );
  const ticksFor = (startIndex, endIndex) => [
    ...vm.runInNewContext(`${helper}\neditorPointTicks(${startIndex}, ${endIndex});`),
  ];

  assert.deepEqual(ticksFor(0, 1), [0, 1]);
  assert.deepEqual(ticksFor(0, 7), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ticksFor(0, 999), [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 999]);
  assert.deepEqual(ticksFor(125, 624), [125, 175, 225, 275, 325, 375, 425, 475, 525, 575, 624]);
});

test('editor viewport clamps zoom and pan to the memory record', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helper = source.slice(
    source.indexOf('function normalizeEditorViewport('),
    source.indexOf('function editorRecordLength()'),
  );
  const normalized = (viewport, totalPoints) =>
    vm.runInNewContext(
      `${helper}\nnormalizeEditorViewport(${JSON.stringify(viewport)}, ${totalPoints});`,
    );

  const full = normalized({ start: 500, pointsPerScreen: null }, 1000);
  assert.deepEqual(
    { start: full.start, end: full.end, pointsPerScreen: full.pointsPerScreen, center: full.center },
    { start: 0, end: 999, pointsPerScreen: 1000, center: 500 },
  );

  const middle = normalized({ start: 250, pointsPerScreen: 200 }, 1000);
  assert.deepEqual(
    { start: middle.start, end: middle.end, pointsPerScreen: middle.pointsPerScreen, center: middle.center },
    { start: 250, end: 449, pointsPerScreen: 200, center: 350 },
  );

  const clamped = normalized({ start: 999, pointsPerScreen: 2000 }, 1000);
  assert.deepEqual(
    { start: clamped.start, end: clamped.end, pointsPerScreen: clamped.pointsPerScreen },
    { start: 0, end: 999, pointsPerScreen: 1000 },
  );
});

test('editor navigation supports record keyboard shortcuts and accelerated wheel panning', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');

  assert.match(source, /function handleEditorNavigationKey\(event\)/);
  assert.match(source, /event\.key === 'Home' \? 0 : view\.maximumStart/);
  assert.match(source, /event\.shiftKey\) setEditorViewportCenter\(Math\.round\(\(view\.total - 1\) \/ 2\)\)/);
  assert.match(source, /editorPosition'\)\.step = 1/);
  assert.match(source, /editorPosition'\)\.addEventListener\('wheel'/);
  assert.match(source, /if \(!event\.shiftKey\) return/);
  assert.match(source, /Math\.round\(view\.pointsPerScreen \/ 10\)/);
  assert.match(source, /canvas\.addEventListener\('wheel'/);
  assert.match(source, /if \(event\.altKey\) zoomEditorViewport/);
  assert.match(source, /else if \(event\.shiftKey\) moveEditorViewport/);
  assert.match(source, /setEditorViewportCenter\(view\.center \+ direction\)/);
  assert.match(source, /function zoomEditorViewport\(direction\)/);
});

test('viewer horizontal scale remains time-based', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/scope-view.js'), 'utf8');

  assert.match(html, /id="scopeTimeAxisLabel"[^>]*>TIME \(ms\)<\/div>/);
  assert.match(source, /scopeTimeAxisLabel'\)\.textContent = `TIME \(\$\{timeUnit\.label\}\)`/);
  assert.match(source, /const time =\s*\(scopeState\.timeStartMs \+ point\.timeFraction \* timeSpan\) \/ timeUnit\.scaleMs/);
});
