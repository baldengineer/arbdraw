const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('keyboard shortcut dialog lists the editor tool shortcuts', () => {
  const help = fs.readFileSync(path.join(root, 'js/help.js'), 'utf8');

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
