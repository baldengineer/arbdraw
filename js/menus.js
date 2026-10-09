// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Small construction and state API for custom menus. Feature code owns placement.
function prepareMenuItem(item, role = 'menuitem') {
  item.setAttribute('role', role);
  if (item.tagName === 'BUTTON') item.type = 'button';
  return item;
}

globalThis.ARBDRAW_MENU = Object.freeze({
  create({ id, label, className = '' }) {
    const menu = document.createElement('div');
    if (id) menu.id = id;
    menu.className = `context-menu menu-surface ${className}`.trim();
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    return menu;
  },

  prepareItem: prepareMenuItem,

  item({ text, id, className = '', role = 'menuitem', externalHref, onClick, checked, disabled = false }) {
    const item = document.createElement(externalHref ? 'a' : 'button');
    if (id) item.id = id;
    item.className = className;
    item.textContent = text;
    prepareMenuItem(item, role);
    if (externalHref) {
      item.href = externalHref;
      item.target = '_blank';
      item.rel = 'noopener noreferrer';
    }
    if (onClick) item.addEventListener('click', onClick);
    if (checked !== undefined) item.setAttribute('aria-checked', String(checked));
    if (disabled) item.disabled = true;
    return item;
  },

  separator() {
    const separator = document.createElement('div');
    separator.className = 'menu-divider';
    separator.setAttribute('role', 'separator');
    return separator;
  },

  setOpen(menu, trigger, open) {
    menu.classList.toggle('open', open);
    trigger?.setAttribute('aria-expanded', String(open));
    return open;
  },
});
