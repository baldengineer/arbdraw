// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Application-wide theme, toast, menu-dismissal, and lifecycle behavior.
function setTheme(theme) {
  const selected = ['dark', 'light', 'contrast'].includes(theme) ? theme : 'dark';
  document.documentElement.dataset.theme = selected;
  localStorage.setItem('arbdraw-theme', selected);
  globalThis.ARBDRAW_VIEW_MENU?.render();
}
setTheme(localStorage.getItem('arbdraw-theme') || 'dark');
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
    !event.target.closest?.('#frequencyUnitMenu,#periodUnitMenu,#transitionTimeUnitMenu,#tsResolutionUnitMenu,#sampleRateUnitMenu,#sampleCountUnitMenu,#frequencyUnitBtn,#periodUnitBtn,.transition-time-unit-button,#tsResolutionUnitBtn,#sampleRateUnitBtn,#sampleCountUnitBtn')
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
  if (!event.target.closest?.('#audioVolumeControl')) globalThis.closeAudioVolumeControl?.();
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
    globalThis.closeAudioVolumeControl?.();
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
