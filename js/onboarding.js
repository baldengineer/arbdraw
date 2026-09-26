// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// First-run product tour powered by the vendored Driver.js browser build.
(function createOnboardingTour() {
  const driverFactory = globalThis.driver?.js?.driver;
  if (typeof driverFactory !== 'function') {
    console.error('Unable to initialize onboarding: Driver.js is unavailable.');
    return;
  }

  const storageKey = 'arbdraw-onboarding-driverjs-v1';
  const steps = [
    {
      element: '#editorView',
      popover: {
        title: 'Waveform area',
        description: 'Draw directly on the canvas to shape the signal, or use the editor tools to select, edit, and delete points.',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '#toolrail',
      popover: {
        title: 'Editor tools',
        description: 'Choose Pointer, Edit, or Delete, then use the zoom controls to adjust your view of the waveform.',
        side: 'right',
        align: 'start',
      },
    },
    {
      element: '.function-section',
      popover: {
        title: 'Choose a waveform',
        description: 'Start with a sine, square, triangle, RC, serial, pulse, DC, or noise waveform. You can still edit the generated points afterward.',
        side: 'left',
        align: 'start',
      },
    },
    {
      element: '.inspector',
      popover: {
        title: 'Shape the signal',
        description: 'Use the Properties panel to adjust amplitude, offset, timing, phase, duty cycle, and waveform-specific settings.',
        side: 'left',
        align: 'center',
      },
    },
    {
      element: '#editorControls',
      popover: {
        title: 'Configure the generator',
        description: 'Select an AWG profile and review the sample rate, sample count, timing resolution, frequency, and period before exporting or sending the waveform.',
        side: 'top',
        align: 'center',
      },
    },
  ];

  let activeTour = null;

  function storageValue() {
    try {
      return localStorage.getItem(storageKey);
    } catch (error) {
      return null;
    }
  }

  function markComplete() {
    try {
      localStorage.setItem(storageKey, 'complete');
    } catch (error) {
      // Local storage may be unavailable in private or file:// contexts.
    }
  }

  function resetCompletion() {
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      // Local storage may be unavailable in private or file:// contexts.
    }
  }

  function finishTour(element, step, options) {
    markComplete();
    options.driver.destroy();
  }

  function startTour() {
    if (activeTour?.isActive()) return false;
    globalThis.closeFunctionSelectMenu?.();
    const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    activeTour = driverFactory({
      animate: !reduceMotion,
      allowClose: true,
      allowKeyboardControl: true,
      allowScroll: true,
      disableActiveInteraction: true,
      doneBtnText: 'Done',
      nextBtnText: 'Next',
      overlayClickBehavior: 'close',
      overlayColor: '#050809',
      overlayOpacity: 0.78,
      popoverClass: 'arbdraw-tour-popover',
      prevBtnText: 'Back',
      progressText: 'Step {{current}} of {{total}}',
      showProgress: true,
      skipMissingElement: true,
      smoothScroll: true,
      stagePadding: 7,
      stageRadius: 8,
      steps,
      onCloseClick: finishTour,
      onDoneClick: finishTour,
      onDestroyed: () => {
        globalThis.closeFunctionSelectMenu?.();
        activeTour = null;
      },
    });
    activeTour.drive();
    return true;
  }

  function closeTour() {
    if (!activeTour?.isActive()) return false;
    activeTour.destroy();
    return true;
  }

  globalThis.ARBDRAW_ONBOARDING = Object.freeze({
    close: closeTour,
    resetCompletion,
    start: startTour,
    storageKey,
    steps,
    get active() {
      return Boolean(activeTour?.isActive());
    },
  });

  const onboardArgument = new URLSearchParams(globalThis.location?.search || '').get('onboard');
  const urlOverride = onboardArgument === '1' ? true : onboardArgument === '0' ? false : null;
  const shouldAutoStart = urlOverride === true || (urlOverride !== false && storageValue() !== 'complete');
  if (shouldAutoStart) setTimeout(startTour, 0);
})();
