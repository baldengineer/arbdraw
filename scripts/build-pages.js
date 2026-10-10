// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Stamp the published HTML while keeping the source index.html usable from disk.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const placeholder = '__ARBDRAW_BUILD_SHA__';

function buildPages(revision, destination) {
  if (!/^[0-9a-f]{40}$/i.test(revision || ''))
    throw new Error('Expected a 40-character Git commit SHA');
  if (!destination) throw new Error('Expected an output directory');

  const output = path.resolve(destination);
  if (fs.existsSync(output)) throw new Error(`Output directory already exists: ${output}`);

  const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const localAssets = [
    ...source.matchAll(/<link rel="stylesheet" href="(includes\/[^\"]+\.css[^\"]*)">/g),
    ...source.matchAll(/<script src="((?:js\/|app\.js)[^\"]*)"><\/script>/g),
  ].map((match) => match[1]);
  if (!localAssets.length || localAssets.some((url) => !url.endsWith(`?v=${placeholder}`)))
    throw new Error('Every local stylesheet and script must use the build SHA placeholder');

  fs.mkdirSync(output, { recursive: true });
  for (const entry of ['app.js', 'includes', 'js', 'docs/help', 'vendor/driver.js']) {
    fs.cpSync(path.join(root, entry), path.join(output, entry), { recursive: true });
  }
  fs.writeFileSync(path.join(output, 'index.html'), source.replaceAll(placeholder, revision));
  fs.writeFileSync(path.join(output, '.nojekyll'), '');
  return output;
}

if (require.main === module) buildPages(process.argv[2], process.argv[3]);

module.exports = { buildPages };
