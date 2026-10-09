const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const styles = read('includes/menus.css');

test('custom menus and native selectors use the shared menu interface', () => {
  assert.match(html, /<link rel="stylesheet" href="includes\/menus\.css\?v=2">/);
  assert.ok(html.indexOf('src="js/menus.js"') < html.indexOf('src="js/views.js'));

  const surfaces = [...html.matchAll(/<[^>]+role="(?:menu|listbox)"[^>]*>/g)].map(([tag]) => tag);
  assert.ok(surfaces.length > 10);
  for (const tag of surfaces) assert.match(tag, /class="[^"]*\bmenu-surface\b/);

  const selects = [...html.matchAll(/<select\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(selects.length > 5);
  for (const tag of selects) {
    assert.match(tag, /class="[^"]*\bmenu-select\b/);
    assert.equal([...tag.matchAll(/\bclass=/g)].length, 1);
  }

  for (const file of ['js/project.js', 'js/views.js', 'js/help.js'])
    assert.match(read(file), /ARBDRAW_MENU\.create\(/, `${file} should use the shared menu constructor`);
  assert.match(read('js/instruments.js'), /ARBDRAW_MENU\.item\(\{ text: resource, role: 'option'/);
  assert.match(read('js/project.js'), /const exportButton = ARBDRAW_MENU\.item\(/);
  assert.doesNotMatch(read('js/project.js'), /exportMenu/);
  assert.match(read('js/fields.js'), /definition\.kind === 'select' \? 'field-input menu-select'/);
});

test('menu typography and interaction states have one shared definition', () => {
  const featureStyles = read('includes/styles.css');
  assert.match(styles, /--menu-font-size:\s*12px/);
  assert.match(styles, /--menu-line-height:\s*16px/);
  assert.match(styles, /\.menu-surface :is\(\[role\^="menuitem"\], \[role="option"\], button, a\)\s*\{[^}]*font-family:\s*var\(--menu-font-family\);[^}]*font-size:\s*var\(--menu-font-size\);[^}]*line-height:\s*var\(--menu-line-height\);/);
  assert.match(styles, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
  assert.match(styles, /\[aria-disabled="true"\]/);
  assert.match(styles, /\[aria-checked="true"\]/);
  assert.match(styles, /\.menu-surface\.function-select-menu button\s*\{[^}]*display:\s*grid/);
  assert.doesNotMatch(featureStyles, /\.context-menu button\s*\{|\.bridge-resource-option\s*\{[^}]*font:/);
});

test('menu API gives actions consistent roles, links, and open state', () => {
  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.attributes = new Map();
      this.classes = new Set();
      this.classList = {
        toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
      };
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name); }
    addEventListener(name, handler) { this[name] = handler; }
  }
  const context = vm.createContext({ document: { createElement: (name) => new Element(name) } });
  vm.runInContext(read('js/menus.js'), context);
  const menus = context.ARBDRAW_MENU;
  const menu = menus.create({ id: 'exampleMenu', label: 'Example', className: 'file-menu' });
  assert.equal(menu.className, 'context-menu menu-surface file-menu');
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(menu.getAttribute('aria-label'), 'Example');

  let clicked = false;
  const action = menus.item({ text: 'Export', onClick: () => { clicked = true; } });
  assert.equal(action.tagName, 'BUTTON');
  assert.equal(action.type, 'button');
  assert.equal(action.getAttribute('role'), 'menuitem');
  action.click();
  assert.equal(clicked, true);

  const link = menus.item({ text: 'Website', externalHref: 'https://example.com/' });
  assert.equal(link.tagName, 'A');
  assert.equal(link.getAttribute('role'), 'menuitem');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');

  const existing = new Element('button');
  menus.prepareItem(existing, 'menuitemradio');
  assert.equal(existing.getAttribute('role'), 'menuitemradio');
  assert.equal(existing.type, 'button');
  assert.equal(menus.separator().getAttribute('role'), 'separator');

  const trigger = new Element('button');
  menus.setOpen(menu, trigger, true);
  assert.equal(menu.classes.has('open'), true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  menus.setOpen(menu, trigger, false);
  assert.equal(menu.classes.has('open'), false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});
