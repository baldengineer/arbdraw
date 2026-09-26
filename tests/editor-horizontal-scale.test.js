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

  assert.match(html, /id="editorPointAxisLabel"[^>]*>POINTS<\/div>/);
  assert.match(html, /id="cursorReadout"[^>]*>0 pts &nbsp; 0\.000 V<\/div>/);
  assert.match(draw, /pointTicks = editorPointTicks\(state\.samples\)/);
  assert.match(draw, /for \(const pointIndex of pointTicks\)/);
  assert.match(draw, /\(pw \* pointIndex\) \/ \(lastPointIndex \|\| 1\)/);
  assert.match(draw, /ctx\.fillText\(pointIndex,/);
  assert.doesNotMatch(draw, /Math\.round/);
  assert.doesNotMatch(draw, /waveformDurationMs|axisTimeUnitFor/);
  assert.match(pointerMove, /`\$\{p\.i\} pts &nbsp;/);
  assert.doesNotMatch(pointerMove, /waveformDurationMs|axisTimeUnitFor/);
});

test('editor point ticks are actual array indices', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helper = source.slice(
    source.indexOf('function editorPointTicks('),
    source.indexOf('function draw()'),
  );
  const ticksFor = (pointCount) => [
    ...vm.runInNewContext(`${helper}\neditorPointTicks(${pointCount});`),
  ];

  assert.deepEqual(ticksFor(2), [0, 1]);
  assert.deepEqual(ticksFor(8), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ticksFor(1000), [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 999]);
  assert.deepEqual(ticksFor(1001), [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
});

test('viewer horizontal scale remains time-based', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/scope-view.js'), 'utf8');

  assert.match(html, /id="scopeTimeAxisLabel"[^>]*>TIME \(ms\)<\/div>/);
  assert.match(source, /scopeTimeAxisLabel'\)\.textContent = `TIME \(\$\{timeUnit\.label\}\)`/);
  assert.match(source, /const time =\s*\(scopeState\.timeStartMs \+ point\.timeFraction \* timeSpan\) \/ timeUnit\.scaleMs/);
});
