const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('TekScope documentation covers installation, both backends, and current limits', () => {
  const adapterReadme = read('adapters/tekscope/README.md');
  const bridgeHelp = read('docs/help/python-bridge.html');
  const tekHelp = read('docs/help/tekscope-adapter.html');
  const helpMenu = read('js/help.js');

  for (const source of [adapterReadme, tekHelp]) {
    assert.match(source, /tekscope-mso2/);
    assert.match(source, /tekscope-mso6/);
    assert.match(source, /C:\/baldee/);
    assert.match(source, /8,000 bytes/);
    assert.match(source, /MSO6[\s\S]*hardware validation/i);
    assert.match(source, /131,072 points/i);
    assert.match(source, /250 MS\/s/i);
    assert.match(source, /25 MHz/i);
    assert.match(source, /verified[\s\S]*100,000(?:-point| points)/i);
  }
  assert.match(adapterReadme, /install\.py --adapter tekscope/);
  assert.match(adapterReadme, /python -m python_bridge --idn 192\.168\.128\.233/);
  assert.match(bridgeHelp, /TekScope adapter guide/);
  assert.match(bridgeHelp, /arbdraw-bridge-tray\.exe/);
  assert.match(helpMenu, /title: 'TekScope adapter', source: 'docs\/help\/tekscope-adapter\.html'/);
});
