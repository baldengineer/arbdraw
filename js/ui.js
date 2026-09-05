// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Application-wide theme, toast, menu-dismissal, and lifecycle behavior.
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('arbdraw-theme', theme);
  document
    .querySelectorAll('.theme-option[data-theme]')
    .forEach((button) => button.classList.toggle('active', button.dataset.theme === theme));
}
setTheme(localStorage.getItem('arbdraw-theme') || 'dark');
document
  .querySelectorAll('.theme-option[data-theme]')
  .forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.theme)));
function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2200);
}
document.addEventListener('pointerdown', (event) => {
  if (!$('propertyContextMenu').contains(event.target)) closePropertyContextMenu();
  if (!$('amplitudeUnitMenu').contains(event.target) && event.target !== $('amplitudeUnitBtn'))
    closeAmplitudeUnitMenu();
  if (
    !$('voltageUnitMenu').contains(event.target) &&
    !event.target.closest?.('.voltage-unit-button')
  )
    closeVoltageUnitMenu();
  if (
    !event.target.closest?.('#frequencyUnitMenu,#periodUnitMenu,#tsResolutionUnitMenu,#sampleRateUnitMenu,#sampleCountUnitMenu,#frequencyUnitBtn,#periodUnitBtn,#tsResolutionUnitBtn,#sampleRateUnitBtn,#sampleCountUnitBtn')
  )
    closeTimingUnitMenus();
  if (!event.target.closest?.('#scopeVoltageUnitMenu,#scopeVoltageUnitBtn'))
    closeScopeVoltageUnitMenu();
  if (!event.target.closest?.('#scopePositionUnitMenu,#scopePositionUnitBtn'))
    closeScopePositionUnitMenu();
  if (!event.target.closest?.('#scopeTimeUnitMenu,#scopeTimeUnitBtn')) closeScopeTimeUnitMenu();
  if (!event.target.closest?.('#scopeDivisionMenu,#scopeVerticalControl')) closeScopeDivisionMenu();
  if (!event.target.closest?.('#scopeZoomMenu')) closeScopeZoomMenu();
  if (!event.target.closest?.('#functionSelectMenu,#functionSelectBtn')) closeFunctionSelectMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closePropertyContextMenu();
    closeAmplitudeUnitMenu();
    closeVoltageUnitMenu();
    closeTimingUnitMenus();
    closeScopeVoltageUnitMenu();
    closeScopePositionUnitMenu();
    closeScopeTimeUnitMenu();
    closeScopeDivisionMenu();
    closeScopeZoomMenu();
    closeFunctionSelectMenu();
  }
});
window.addEventListener('blur', () => {
  closePropertyContextMenu();
  closeAmplitudeUnitMenu();
  closeVoltageUnitMenu();
  closeTimingUnitMenus();
  closeScopeVoltageUnitMenu();
  closeScopePositionUnitMenu();
  closeScopeTimeUnitMenu();
  closeScopeDivisionMenu();
  closeScopeZoomMenu();
  closeFunctionSelectMenu();
});
