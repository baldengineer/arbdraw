// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
(function setupMathReference() {
  const dialog = document.getElementById('mathReferenceDialog');
  const trigger = document.getElementById('mathReferenceBtn');
  const handle = document.getElementById('mathReferenceHandle');
  const close = document.getElementById('closeMathReferenceBtn');
  let drag = null;

  function position(left, top) {
    const bounds = dialog.getBoundingClientRect(), margin = 12;
    dialog.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - bounds.width - margin))}px`;
    dialog.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - bounds.height - margin))}px`;
  }
  trigger.addEventListener('click', () => {
    // A modeless dialog keeps the waveform controls usable beside the reference.
    if (!dialog.open) dialog.show();
    trigger.setAttribute('aria-expanded', 'true');
    const bounds = dialog.getBoundingClientRect();
    position(bounds.left, bounds.top);
    close.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    if (trigger.getClientRects().length && !trigger.disabled) trigger.focus();
  });
  dialog.addEventListener('keydown', event => {
    // Reference navigation must not activate waveform editor shortcuts.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    }
  });
  handle.addEventListener('keydown', event => {
    if (event.target !== handle) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const bounds = dialog.getBoundingClientRect(), step = event.shiftKey ? 40 : 10;
    position(bounds.left + direction[0] * step, bounds.top + direction[1] * step);
  });
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const bounds = dialog.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    handle.setPointerCapture(event.pointerId);
    handle.focus();
    event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) position(event.clientX - drag.x, event.clientY - drag.y);
  });
  function endDrag(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('lostpointercapture', () => { drag = null; });
  window.addEventListener('resize', () => {
    if (!dialog.open) return;
    const bounds = dialog.getBoundingClientRect();
    position(bounds.left, bounds.top);
  });
})();
