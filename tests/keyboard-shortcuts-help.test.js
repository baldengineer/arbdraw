const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('keyboard shortcut dialog lists the editor tool shortcuts', () => {
  const help = fs.readFileSync(path.join(root, 'js/help.js'), 'utf8');

  assert.match(help, /keys: \['Space'\], description: 'Switch to Arbitrary mode'/);
  assert.match(help, /keys: \['A'\], description: 'Toggle Pointer \/ Select tools \(Arbitrary\)'/);
  assert.match(help, /keys: \['E'\], description: 'Switch to Edit tool \(Arbitrary\)'/);
  assert.match(help, /keys: \['D'\], description: 'Switch to Delete tool \(Arbitrary\)'/);
});

test('keyboard shortcut dialog explains the marker behavior for Escape', () => {
  const help = fs.readFileSync(path.join(root, 'js/help.js'), 'utf8');

  assert.match(
    help,
    /keys: \['Esc'\],[\s\S]*description: 'Close menus\/dialogs or clear markers and activate Select'/,
  );
});


test('sequence help describes the shape menu, destructive regeneration and fixed-total examples', () => {
  const help = fs.readFileSync(path.join(root, 'docs/help/sequences.html'), 'utf8');
  for (const behavior of [/choose the new segment.*waveshape from the menu/, /All segments are regenerated/,
    /keeps the total record points and shared clock fixed/, /16 points.*6\/5\/5/, /at least two points/,
    /increase the total record points/, /Cancel preserves the waveform/, /two 1,000-point segments/,
    /2 kHz source frequency/, /lasts 1 ms, and repeats at 1 kHz/]) assert.match(help, behavior);
  assert.doesNotMatch(help, /Two copies make a 4,000-point|reduce the sample count of an existing/);
});
