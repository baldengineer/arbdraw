const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('TekScope documentation covers installation, both backends, and current limits', () => {
  const bridgeHelp = read('docs/help/python-bridge.html');
  const tekHelp = read('docs/help/tekscope-adapter.html');
  const helpMenu = read('js/help.js');

  assert.match(tekHelp, /tekscope-mso2/);
  assert.match(tekHelp, /tekscope-mso6/);
  assert.match(tekHelp, /C:\/baldee/);
  assert.match(tekHelp, /8,000 bytes/);
  assert.match(tekHelp, /MSO6[\s\S]*hardware validation/i);
  assert.match(tekHelp, /131,072 points/i);
  assert.match(tekHelp, /250 MS\/s/i);
  assert.match(tekHelp, /25 MHz/i);
  assert.match(tekHelp, /verified[\s\S]*100,000(?:-point| points)/i);
  const repository = 'https://github.com/baldengineer/tekscope-arbdraw-adapter';
  for (const source of [read('README.md'), read('python_bridge/README.md'), tekHelp]) {
    assert.ok(source.includes(repository), 'documentation links to the independent adapter');
    assert.doesNotMatch(source, /adapters[\\/]tekscope[\\/]README\.md/);
  }
  assert.match(bridgeHelp, /TekScope adapter guide/);
  assert.match(bridgeHelp, /arbdraw-bridge-tray\.exe/);
  assert.match(helpMenu, /title: 'TekScope adapter', source: 'docs\/help\/tekscope-adapter\.html'/);
});

test('bridge documentation explains the Windows tray status and controls', () => {
  const sources = [
    read('README.md'),
    read('python_bridge/README.md'),
    read('docs/help/python-bridge.html'),
    read('packaging/RELEASE_README.txt'),
  ];

  for (const source of sources) {
    assert.match(source, /arbdraw-bridge-tray\.exe/);
    assert.match(source, /bridge version/i);
    assert.match(source, /available adapters/i);
    assert.match(source, /grey[\s\S]*blue/i);
  }
});
