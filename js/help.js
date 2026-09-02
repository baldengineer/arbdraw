// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Help menu and in-app help window.
const helpItems = [
  { title: 'About', source: 'docs/help/about.html' },
  { title: 'How to use', source: 'docs/help/how-to-use.html' },
  { title: 'JSON format', source: 'docs/help/json-format.html' },
  { title: 'FAQ', source: 'docs/help/faq.html' },
];
const keyboardShortcuts = [
  { keys: ['?'], description: 'Show keyboard shortcuts' },
  { keys: ['Ctrl / ⌘', 'Z'], description: 'Undo' },
  {
    keys: ['Ctrl / ⌘', 'Shift', 'Z'],
    description: 'Redo',
  },
  { keys: ['Ctrl', 'Y'], description: 'Redo (Windows/Linux)' },
  { keys: ['Esc'], description: 'Close open menus and dialogs' },
];

const helpButton = document.createElement('button');
helpButton.id = 'helpBtn';
helpButton.className = 'ghost file-button';
helpButton.type = 'button';
helpButton.setAttribute('aria-haspopup', 'menu');
helpButton.setAttribute('aria-expanded', 'false');
helpButton.textContent = 'Help ▾';

const helpMenu = document.createElement('div');
helpMenu.id = 'helpMenu';
helpMenu.className = 'context-menu file-menu help-menu';
helpMenu.setAttribute('role', 'menu');
helpMenu.setAttribute('aria-label', 'Help');

const helpMenuAnchor = document.createElement('span');
helpMenuAnchor.className = 'help-menu-anchor';
helpMenuAnchor.append(helpButton, helpMenu);

const helpDialog = document.createElement('dialog');
helpDialog.id = 'helpDialog';
helpDialog.className = 'help-dialog';
helpDialog.innerHTML = `
  <div class="help-dialog-heading">
    <h2 id="helpDialogTitle"></h2>
    <button id="closeHelpBtn" class="icon-btn" type="button" aria-label="Close">×</button>
  </div>
  <iframe id="helpFrame" title="Help content"></iframe>
  <div class="help-dialog-actions">
    <button id="openHelpPageBtn" class="primary" type="button">Open ↗</button>
  </div>
`;

const shortcutDialog = document.createElement('dialog');
shortcutDialog.id = 'shortcutDialog';
shortcutDialog.className = 'shortcut-dialog';
shortcutDialog.setAttribute('aria-labelledby', 'shortcutDialogTitle');
shortcutDialog.innerHTML = `
  <form method="dialog" class="shortcut-dialog-form">
    <div class="help-dialog-heading">
      <div>
        <span class="eyebrow">KEYBOARD SHORTCUTS</span>
        <h2 id="shortcutDialogTitle">Keyboard shortcuts</h2>
      </div>
      <button class="icon-btn" value="cancel" aria-label="Close">×</button>
    </div>
    <p class="shortcut-dialog-intro">Use these shortcuts anywhere in the editor. Shortcuts are paused while typing in a field.</p>
    <div class="shortcut-list" role="list"></div>
    <div class="help-dialog-actions">
      <button value="cancel" class="ghost" type="submit">Close</button>
    </div>
  </form>
`;

document.querySelector('.project-actions').append(helpMenuAnchor);
document.body.append(helpDialog, shortcutDialog);

const shortcutList = shortcutDialog.querySelector('.shortcut-list');
keyboardShortcuts.forEach((shortcut) => {
  const row = document.createElement('div');
  row.className = 'shortcut-row';
  row.setAttribute('role', 'listitem');
  const keys = shortcut.keys;
  row.innerHTML = `
    <span class="shortcut-keys">${keys.map((key) => `<kbd>${key}</kbd>`).join('<span class="shortcut-plus">+</span>')}</span>
    <span>${shortcut.description}</span>
  `;
  shortcutList.append(row);
});

function closeHelpMenu() {
  helpMenu.classList.remove('open');
  helpButton.setAttribute('aria-expanded', 'false');
}

function openHelp(item) {
  closeHelpMenu();
  $('helpDialogTitle').textContent = item.title;
  $('helpFrame').src = item.source;
  helpDialog.dataset.source = item.source;
  helpDialog.showModal();
}

helpItems.forEach((item) => {
  const option = document.createElement('button');
  option.type = 'button';
  option.setAttribute('role', 'menuitem');
  option.textContent = item.title;
  option.onclick = () => openHelp(item);
  helpMenu.append(option);
});

helpButton.onclick = (event) => {
  event.stopPropagation();
  const isOpen = helpMenu.classList.toggle('open');
  helpButton.setAttribute('aria-expanded', String(isOpen));
};
$('closeHelpBtn').onclick = () => helpDialog.close();
$('openHelpPageBtn').onclick = () => {
  const source = helpDialog.dataset.source;
  if (source) window.open(source, '_blank', 'noopener');
};
helpDialog.addEventListener('click', (event) => {
  if (event.target === helpDialog) helpDialog.close();
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest?.('#helpMenu,#helpBtn')) closeHelpMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeHelpMenu();

  const editing = event.target.matches?.('input, textarea, select, [contenteditable="true"]');
  if (editing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === '?' || (event.code === 'Slash' && event.shiftKey)) {
    event.preventDefault();
    if (!shortcutDialog.open) shortcutDialog.showModal();
  }
});
