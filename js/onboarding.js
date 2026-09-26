// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// First-run product tour powered by Driver.js after the asset loader is ready.
(function createOnboardingTour() {
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

  // Instruments Dialog Guide
  const instrumentSteps = [
    {
      element: '.bridge-connection-row',
      popover: {
        title: 'Connect to the bridge',
        description: 'Confirm the local bridge URL, then connect. ArbDraw uses this service to communicate with VISA instruments.',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '.bridge-adapter-field',
      popover: {
        title: 'Choose a waveform backend',
        description: 'Select the installed adapter that matches your instrument family. Available adapters appear after the bridge connects.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.bridge-resource-control',
      popover: {
        title: 'Select the instrument',
        description: 'Choose a discovered VISA resource, paste a resource string, or enter the instrument IP address.',
        side: 'bottom',
        align: 'center',
      },
    },
    {
      element: '.bridge-send-options',
      popover: {
        title: 'Set output options',
        description: 'Choose the destination channel and whether ArbDraw should enable the instrument output after transfer.',
        side: 'top',
        align: 'start',
      },
    },
    {
      element: '.bridge-actions',
      popover: {
        title: 'Identify or send',
        description: 'Identify checks the selected device with *IDN?. Send waveform transfers the current ArbDraw signal using the chosen settings.',
        side: 'top',
        align: 'end',
      },
    },
  ];

  let activeTour = null;
  let activeInstrumentGuide = null;
  let instrumentStartPromise = null;
  let startPromise = null;

  function driverReady() {
    return globalThis.ARBDRAW_DRIVER_READY
      || Promise.resolve(globalThis.driver?.js?.driver);
  }

  function reduceMotion() {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  function sharedOptions() {
    return {
      animate: !reduceMotion(),
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
    };
  }

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
    if (activeTour?.isActive()) return Promise.resolve(false);
    if (startPromise) return startPromise;
    startPromise = driverReady()
      .then((driverFactory) => {
        if (typeof driverFactory !== 'function') {
          throw new Error('Driver.js is unavailable.');
        }
        if (activeTour?.isActive()) return false;
        globalThis.closeFunctionSelectMenu?.();
        activeTour = driverFactory({
          ...sharedOptions(),
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
      })
      .catch((error) => {
        console.error('Unable to initialize onboarding.', error);
        return false;
      })
      .finally(() => {
        startPromise = null;
      });
    return startPromise;
  }

  function isModalDialog(dialog) {
    try {
      return dialog.matches(':modal');
    } catch (error) {
      return dialog.open;
    }
  }

  function startInstrumentGuide() {
    if (activeInstrumentGuide?.isActive()) return Promise.resolve(false);
    if (instrumentStartPromise) return instrumentStartPromise;
    const bridgeDialog = document.getElementById('bridgeDialog');
    if (!bridgeDialog?.open) return Promise.resolve(false);
    const restoreModal = isModalDialog(bridgeDialog);

    instrumentStartPromise = driverReady()
      .then((driverFactory) => {
        if (typeof driverFactory !== 'function') {
          throw new Error('Driver.js is unavailable.');
        }
        if (activeInstrumentGuide?.isActive()) return false;
        if (restoreModal) {
          // Driver.js renders at document level, so temporarily leave the top layer
          // while its overlay points to controls inside the dialog.
          bridgeDialog.close();
          bridgeDialog.show();
        }
        activeInstrumentGuide = driverFactory({
          ...sharedOptions(),
          steps: instrumentSteps,
          onCloseClick: (element, step, options) => options.driver.destroy(),
          onDoneClick: (element, step, options) => options.driver.destroy(),
          onDestroyed: () => {
            activeInstrumentGuide = null;
            if (restoreModal && bridgeDialog.open && !isModalDialog(bridgeDialog)) {
              bridgeDialog.close();
              bridgeDialog.showModal();
            }
          },
        });
        activeInstrumentGuide.drive();
        return true;
      })
      .catch((error) => {
        if (restoreModal && bridgeDialog.open && !isModalDialog(bridgeDialog)) {
          bridgeDialog.close();
          bridgeDialog.showModal();
        }
        console.error('Unable to initialize the instrument guide.', error);
        return false;
      })
      .finally(() => {
        instrumentStartPromise = null;
      });
    return instrumentStartPromise;
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
    startInstrumentGuide,
    storageKey,
    steps,
    instrumentSteps,
    get active() {
      return Boolean(activeTour?.isActive());
    },
  });

  document.getElementById('instrumentGuideBtn')?.addEventListener('click', startInstrumentGuide);

  const onboardArgument = new URLSearchParams(globalThis.location?.search || '').get('onboard');
  const urlOverride = onboardArgument === '1' ? true : onboardArgument === '0' ? false : null;
  const shouldAutoStart = urlOverride === true || (urlOverride !== false && storageValue() !== 'complete');
  if (shouldAutoStart) setTimeout(() => startTour(), 0);
})();
