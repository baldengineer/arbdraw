// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Properties disclosure state is a local UI preference, not project data.
const PROPERTY_PANELS_STORAGE_KEY = 'arbdraw-property-panels';
const propertyPanels = [...document.querySelectorAll('.inspector details[data-property-panel]')];

function readPropertyPanelState() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROPERTY_PANELS_STORAGE_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function savePropertyPanelState() {
  try {
    localStorage.setItem(
      PROPERTY_PANELS_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(propertyPanels.map((panel) => [panel.dataset.propertyPanel, panel.open]))),
    );
  } catch {
    // The controls remain usable when storage is unavailable.
  }
}

function resetPropertyPanels() {
  for (const panel of propertyPanels) panel.open = true;
  savePropertyPanelState();
}

const savedPropertyPanelState = readPropertyPanelState();
for (const panel of propertyPanels) {
  if (typeof savedPropertyPanelState[panel.dataset.propertyPanel] === 'boolean')
    panel.open = savedPropertyPanelState[panel.dataset.propertyPanel];
  panel.addEventListener('toggle', savePropertyPanelState);
}
