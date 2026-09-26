const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('Driver.js is vendored at an exact version with its MIT license', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const license = fs.readFileSync(path.join(root, 'vendor/driver.js/1.8.0/LICENSE'), 'utf8');

  assert.match(html, /vendor\/driver\.js\/1\.8\.0\/driver\.css/);
  assert.match(html, /vendor\/driver\.js\/1\.8\.0\/driver\.js\.iife\.js/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net|unpkg\.com/);
  assert.match(license, /The MIT License/);
  assert.match(license, /Copyright \(c\) Kamran Ahmed/);
});

test('onboarding defines the starter tour through Driver.js', () => {
  const source = fs.readFileSync(path.join(root, 'js/onboarding.js'), 'utf8');

  assert.match(source, /globalThis\.driver\?\.js\?\.driver/);
  assert.match(source, /element: '#editorView'/);
  assert.match(source, /element: '#toolrail'/);
  assert.match(source, /element: '\.function-section'/);
  assert.match(source, /element: '\.inspector'/);
  assert.match(source, /element: '#editorControls'/);
  assert.match(source, /showProgress: true/);
  assert.match(source, /localStorage\.setItem\(storageKey, 'complete'\)/);
  assert.match(source, /get\('onboard'\)/);
});

test('Help menu provides a permanent way to restart onboarding', () => {
  const source = fs.readFileSync(path.join(root, 'js/help.js'), 'utf8');

  assert.match(source, /title: 'Getting started'/);
  assert.match(source, /ARBDRAW_ONBOARDING\?\.start\(\)/);
  assert.match(source, /if \(item\.action\)/);
});
