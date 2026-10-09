const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const styles = read('includes/menus.css');

test('custom menus and native selectors use the shared menu interface', () => {
  assert.match(html, /<link rel="stylesheet" href="includes\/menus\.css">/);

  const surfaces = [...html.matchAll(/<[^>]+role="(?:menu|listbox)"[^>]*>/g)].map(([tag]) => tag);
  assert.ok(surfaces.length > 10);
  for (const tag of surfaces) assert.match(tag, /class="[^"]*\bmenu-surface\b/);

  const selects = [...html.matchAll(/<select\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(selects.length > 5);
  for (const tag of selects) {
    assert.match(tag, /class="[^"]*\bmenu-select\b/);
    assert.equal([...tag.matchAll(/\bclass=/g)].length, 1);
  }

  for (const file of ['js/project.js', 'js/views.js', 'js/help.js']) {
    const dynamicMenus = [...read(file).matchAll(/className = '([^']*\bcontext-menu\b[^']*)'/g)];
    assert.ok(dynamicMenus.length, `${file} should define a menu`);
    for (const [, classes] of dynamicMenus) assert.match(classes, /\bmenu-surface\b/);
  }
  assert.match(read('js/fields.js'), /definition\.kind === 'select' \? 'field-input menu-select'/);
});

test('menu typography and interaction states have one shared definition', () => {
  const featureStyles = read('includes/styles.css');
  assert.match(styles, /--menu-font-size:\s*12px/);
  assert.match(styles, /--menu-line-height:\s*16px/);
  assert.match(styles, /\.menu-surface :is\(\[role\^="menuitem"\], \[role="option"\]\)\s*\{[^}]*font-family:\s*var\(--menu-font-family\);[^}]*font-size:\s*var\(--menu-font-size\);[^}]*line-height:\s*var\(--menu-line-height\);/);
  assert.match(styles, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
  assert.match(styles, /\[aria-disabled="true"\]/);
  assert.match(styles, /\[aria-checked="true"\]/);
  assert.match(styles, /\.menu-surface\.function-select-menu \[role="menuitem"\]\s*\{[^}]*display:\s*grid/);
  assert.doesNotMatch(featureStyles, /\.context-menu button\s*\{|\.bridge-resource-option\s*\{[^}]*font:/);
});
