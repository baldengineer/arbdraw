const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildPages } = require('../scripts/build-pages.js');

test('published site stamps assets while the source remains standalone HTML', () => {
  const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(source, /^<!doctype html>/);

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arbdraw-pages-'));
  try {
    const revision = 'a'.repeat(40);
    const destination = path.join(temporaryRoot, 'site');
    buildPages(revision, destination);
    const published = fs.readFileSync(path.join(destination, 'index.html'), 'utf8');
    assert.match(published, new RegExp(`includes/styles\\.css\\?v=${revision}`));
    assert.match(published, new RegExp(`js/project\\.js\\?v=${revision}`));
    assert.doesNotMatch(published, /__ARBDRAW_BUILD_SHA__|site\.github\.build_revision/);
    for (const relativePath of ['app.js', 'docs/help/help.css', 'includes/ArbDraw.png', 'js/project.js', 'vendor/driver.js/1.8.0/driver.js.iife.js'])
      assert.ok(fs.existsSync(path.join(destination, relativePath)), `${relativePath} is missing`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
