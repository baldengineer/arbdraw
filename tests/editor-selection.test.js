const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('selection tool and marker readout are placed in the editor', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'js/core.js'), 'utf8');
  const properties = fs.readFileSync(path.join(root, 'js/properties.js'), 'utf8');
  const pointerIndex = html.indexOf('data-tool="pointer"');
  const selectionIndex = html.indexOf('data-tool="selection"');
  const pencilIndex = html.indexOf('data-tool="pencil"');

  assert.ok(pointerIndex >= 0 && pointerIndex < selectionIndex);
  assert.ok(selectionIndex < pencilIndex);
  assert.match(html, /id="editorSelectionReadout"[^>]*hidden/);
  assert.match(html, /id="editorSelectionLeft"/);
  assert.match(html, /id="editorSelectionRight"/);
  assert.match(html, /id="editorSelectionClear"[^>]*aria-label="Clear point selection"/);
  assert.match(core, /Select: 'selection'/);
  assert.match(properties, /selection: 'Select'/);
});

test('selection bounds are ordered and clamped to the memory record', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const helper = source.slice(
    source.indexOf('function normalizeEditorSelection('),
    source.indexOf('function currentEditorSelection()'),
  );
  const normalize = (selection, totalPoints) =>
    vm.runInNewContext(
      `${helper}\nnormalizeEditorSelection(${JSON.stringify(selection)}, ${totalPoints});`,
    );

  assert.equal(normalize({ left: null, right: null }, 1000), null);
  const ordered = normalize({ left: 700, right: 200 }, 1000);
  assert.deepEqual({ left: ordered.left, right: ordered.right }, { left: 200, right: 700 });
  const clamped = normalize({ left: -50, right: 1200 }, 1000);
  assert.deepEqual({ left: clamped.left, right: clamped.right }, { left: 0, right: 999 });
});

test('selection interaction shades the range and supports movable markers and clearing', () => {
  const source = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');

  assert.match(source, /function drawEditorSelection\(/);
  assert.match(source, /ctx\.fillRect\(leftX, pad\.t/);
  assert.match(source, /for \(const markerIndex of new Set\(\[selection\.left, selection\.right\]\)\)/);
  assert.match(source, /function beginEditorSelection\(event\)/);
  assert.match(source, /leftDistance <= rightDistance \? 'left' : 'right'/);
  assert.match(source, /editorSelection\.dragging = 'range'/);
  assert.match(source, /editorSelectionClear'\)\.addEventListener\('click', clearEditorSelection\)/);
});
