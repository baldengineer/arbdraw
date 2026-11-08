// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// ArbDraw UI for the local Python instrument bridge.
(function initializeInstrumentControls() {
  const BRIDGE_URL_STORAGE_KEY = 'arbdraw-bridge-url';
  const BRIDGE_KEEP_ALIVE_MS = 10000;
  const defaultBridgeUrl = globalThis.ARBDRAW_DEFAULTS?.bridgeUrl || 'http://127.0.0.1:8876';
  const bridgeDialog = $('bridgeDialog');
  const bridgeUrlInput = $('bridgeUrlInput');
  const resourceInput = $('visaResourceInput');
  const clearResourceButton = $('clearVisaResourceBtn');
  const dropdownButton = $('visaResourceDropdownBtn');
  const resourceMenu = $('visaResourceMenu');
  const resourceFilter = $('visaResourceFilter');
  const resourceList = $('visaResourceList');
  const instrumentControls = $('bridgeInstrumentControls');
  const adapterSelect = $('instrumentAdapter');
  const backendHelp = $('instrumentBackendHelp');
  const connectButton = $('bridgeConnectBtn');
  const refreshButton = $('refreshResourcesBtn');
  const identifyButton = $('identifyResourceBtn');
  const sendButton = $('sendWaveformBtn');
  const channelSelect = $('instrumentChannel');
  const fileOptions = $('instrumentFileOptions');
  const directoryInput = $('instrumentDirectory');
  const overwriteCheckbox = $('instrumentOverwrite');
  const enableOutputCheckbox = $('instrumentEnableOutput');
  const statusElement = $('bridgeStatus');
  const resultElement = $('bridgeResult');
  const errorHelpElement = $('bridgeErrorHelp');
  let bridgeClient = null;
  let bridgeOnline = false;
  let busy = false;
  let keepAlivePending = false;
  let resources = [];

  directoryInput.value = DEFAULT_VALUES.tekScopeDirectory;
  overwriteCheckbox.checked = DEFAULT_VALUES.tekScopeOverwrite;

  function isTekScopeBackend() {
    return ['tekscope-mso2', 'tekscope-mso6'].includes(adapterSelect.value);
  }

  function updateBackendControls() {
    const tekScope = isTekScopeBackend();
    fileOptions.hidden = !tekScope;
    channelSelect.disabled = tekScope;
    if (tekScope) channelSelect.value = '1';
    const profile = selectedAwgProfile?.name || selectedAwgProfile?.id || 'Selected profile';
    const preferred = selectedAwgProfile?.preferredBackend;
    if (!adapterSelect.value) {
      backendHelp.textContent = preferred
        ? `${profile}: backend "${preferred}" is unavailable. Identify remains available; install the matching adapter or select an installed backend to send.`
        : `${profile} has no preferred waveform backend. Identify remains available; select an installed backend to send.`;
    } else if (preferred && adapterSelect.value !== preferred) {
      backendHelp.textContent = `${profile}: manually selected backend "${adapterSelect.value}" differs from "${preferred}". Profile-specific VISA options will not be used.`;
    } else {
      backendHelp.textContent = `${profile}: using backend "${adapterSelect.value}".`;
    }
    updateActions();
  }

  function saveFileSettings() {
    persistSettings({
      tekScopeDirectory: directoryInput.value.trim(),
      tekScopeOverwrite: overwriteCheckbox.checked,
    });
  }

  try {
    bridgeUrlInput.value = localStorage.getItem(BRIDGE_URL_STORAGE_KEY) || defaultBridgeUrl;
  } catch {
    bridgeUrlInput.value = defaultBridgeUrl;
  }

  function selectedResource() {
    return ArbDrawBridge.normalizeVisaResource(resourceInput.value);
  }

  function selectedPyVisaOptions() {
    // Identify-only uses the chosen profile; manual overrides must not inherit
    // connection settings intended for a different backend.
    if (adapterSelect.value && adapterSelect.value !== selectedAwgProfile?.preferredBackend) return {};
    const options = selectedAwgProfile?.pyvisaOptions;
    return options && typeof options === 'object' ? { ...options } : {};
  }

  function setStatus(kind, message) {
    statusElement.dataset.status = kind;
    statusElement.textContent = message;
  }

  function setResult(message = '', isError = false, isSuccess = false) {
    const prefix = isError ? '✖ ' : isSuccess ? '✔ ' : '';
    resultElement.textContent = `${prefix}${message}`;
    resultElement.classList.toggle('error', isError);
    resultElement.classList.toggle('success', isSuccess && !isError);
    errorHelpElement.hidden = !isError;
  }

  function markBridgeOnline(health) {
    bridgeOnline = true;
    setStatus('online', `Connected · API ${health?.api_version || 'v1'}`);
    updateActions();
  }

  function markBridgeOffline() {
    bridgeOnline = false;
    setStatus('offline', 'Bridge offline');
    updateActions();
  }

  function isConnectionError(error) {
    return error?.code === 'bridge_unreachable' || error?.code === 'bridge_timeout';
  }

  function closeResourceMenu() {
    ARBDRAW_MENU.setOpen(resourceMenu, dropdownButton, false);
  }

  function renderResourceList() {
    const filter = resourceFilter.value.trim().toLowerCase();
    const visibleResources = resources.filter((resource) => resource.toLowerCase().includes(filter));
    resourceList.replaceChildren();
    if (!visibleResources.length) {
      const empty = document.createElement('div');
      empty.className = 'bridge-resource-empty';
      empty.textContent = resources.length ? 'No matching resources' : 'No VISA resources found';
      resourceList.append(empty);
      return;
    }
    visibleResources.forEach((resource) => {
      const option = ARBDRAW_MENU.item({ text: resource, role: 'option', className: 'bridge-resource-option' });
      option.dataset.resource = resource;
      resourceList.append(option);
    });
  }

  function updateActions() {
    const hasResource = Boolean(selectedResource());
    instrumentControls.disabled = !bridgeOnline;
    connectButton.disabled = busy;
    refreshButton.disabled = busy || !bridgeOnline;
    identifyButton.disabled = busy || !bridgeOnline || !hasResource;
    sendButton.disabled = busy || !bridgeOnline || !hasResource || !hasSelectedAdapter();
  }

  function hasSelectedAdapter() {
    return Boolean(adapterSelect.value) &&
      Array.from(adapterSelect.options).some(option => option.value === adapterSelect.value);
  }

  async function runBridgeAction(action) {
    if (busy) return;
    busy = true;
    updateActions();
    try {
      await action();
    } catch (error) {
      if (isConnectionError(error)) markBridgeOffline();
      setResult(error.message || 'The bridge request failed.', true);
    } finally {
      busy = false;
      updateActions();
    }
  }

  async function loadResources({ preserveSelection = true } = {}) {
    const previous = preserveSelection ? selectedResource() : '';
    setResult('Scanning VISA resources…');
    resources = await bridgeClient.listResources();
    if (!resources.length) {
      resourceInput.value = '';
      renderResourceList();
      setResult('The bridge is online, but VISA reported no resources.');
      return;
    }
    resourceInput.value = resources.includes(previous) ? previous : resources[0];
    renderResourceList();
    setResult(`Found ${resources.length} VISA resource${resources.length === 1 ? '' : 's'}.`, false, true);
  }

  async function loadAdapters() {
    const adapters = await bridgeClient.listAdapters();
    adapterSelect.replaceChildren();
    adapterSelect.add(new Option('Identify only (no waveform backend)', ''));
    adapters.forEach((adapter) => adapterSelect.add(new Option(adapter.name || adapter.id, adapter.id)));
    adapterSelect.disabled = !adapters.length;
    selectPreferredAdapter();
  }

  function selectPreferredAdapter() {
    const preferred = selectedAwgProfile?.preferredBackend;
    const available = preferred && Array.from(adapterSelect.options).some((option) => option.value === preferred);
    adapterSelect.value = available ? preferred : '';
    updateBackendControls();
  }
  globalThis.ARBDRAW_INSTRUMENTS = { syncProfile: selectPreferredAdapter };

  async function connect() {
    let candidate;
    try {
      candidate = new ArbDrawBridge.BridgeClient(bridgeUrlInput.value);
    } catch (error) {
      bridgeOnline = false;
      setStatus('offline', 'Not connected');
      updateActions();
      throw error;
    }
    bridgeClient = candidate;
    bridgeOnline = false;
    setStatus('connecting', 'Connecting…');
    updateActions();
    let health;
    try {
      health = await candidate.health();
    } catch (error) {
      markBridgeOffline();
      throw error;
    }
    bridgeUrlInput.value = candidate.baseUrl;
    try {
      localStorage.setItem(BRIDGE_URL_STORAGE_KEY, candidate.baseUrl);
    } catch {
      // The connection still works if browser storage is unavailable.
    }
    markBridgeOnline(health);
    await loadAdapters();
    await loadResources({ preserveSelection: false });
  }

  async function checkBridgeHealth() {
    if (!bridgeDialog.open || !bridgeClient || busy || keepAlivePending) return;
    const client = bridgeClient;
    keepAlivePending = true;
    try {
      const health = await client.health();
      if (client === bridgeClient) markBridgeOnline(health);
    } catch {
      if (client === bridgeClient) markBridgeOffline();
    } finally {
      keepAlivePending = false;
    }
  }

  function openSendToAwgDialog() {
    closeFileMenu();
    bridgeDialog.showModal();
    if (!bridgeOnline) runBridgeAction(connect);
  }

  globalThis.openSendToAwgDialog = openSendToAwgDialog;
  $('instrumentsBtn').addEventListener('click', openSendToAwgDialog);

  connectButton.addEventListener('click', () => runBridgeAction(connect));
  adapterSelect.addEventListener('change', updateBackendControls);
  directoryInput.addEventListener('input', saveFileSettings);
  overwriteCheckbox.addEventListener('change', saveFileSettings);
  refreshButton.addEventListener('click', () => runBridgeAction(loadResources));
  resourceInput.addEventListener('input', () => {
    setResult('');
    updateActions();
  });

  clearResourceButton.addEventListener('click', () => {
    resourceInput.value = '';
    resourceInput.focus();
    setResult('');
    updateActions();
  });

  dropdownButton.addEventListener('click', () => {
    const isOpen = ARBDRAW_MENU.setOpen(resourceMenu, dropdownButton, !resourceMenu.classList.contains('open'));
    if (isOpen) {
      resourceFilter.value = '';
      renderResourceList();
      resourceFilter.focus();
    }
  });
  resourceFilter.addEventListener('input', renderResourceList);
  resourceList.addEventListener('click', (event) => {
    const option = event.target.closest('.bridge-resource-option');
    if (!option) return;
    resourceInput.value = option.dataset.resource;
    closeResourceMenu();
    setResult('');
    updateActions();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest?.('.bridge-resource-control')) closeResourceMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeResourceMenu();
  });

  identifyButton.addEventListener('click', () =>
    runBridgeAction(async () => {
      setResult(`Querying ${selectedResource()}…`);
      const response = await bridgeClient.identify(selectedResource(), {
        pyvisaOptions: selectedPyVisaOptions(),
      });
      setResult(response.identity || response.response || 'The instrument returned an empty response.', false, true);
    }),
  );

  sendButton.addEventListener('click', () =>
    runBridgeAction(async () => {
      if (!hasSelectedAdapter()) throw new Error('Select an installed waveform backend before sending.');
      const resource = selectedResource();
      globalThis.ARBDRAW_SEQUENCE?.sync();
      if (globalThis.ARBDRAW_SEQUENCE?.hasSegments()) renderAwgTiming();
      const sampleCount = globalThis.ARBDRAW_SEQUENCE?.hasSegments() ? recordState().samples : state.data.length;
      setResult(`Sending ${sampleCount.toLocaleString()} samples to ${resource}…`);
      const response = await bridgeClient.sendWaveform(
        resource,
        JSON.parse(JSON.stringify(projectDocument)),
        {
          adapter: adapterSelect.value,
          pyvisaOptions: selectedPyVisaOptions(),
          options: {
            channel: isTekScopeBackend() ? 1 : Number(channelSelect.value),
            enable_output: enableOutputCheckbox.checked,
            ...(isTekScopeBackend() ? {
              directory: directoryInput.value.trim(),
              overwrite: overwriteCheckbox.checked,
            } : {}),
          },
        },
      );
      const message = response?.message || `Waveform sent to ${resource}.`;
      setResult(message, false, true);
      showToast(message);
    }),
  );

  bridgeUrlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runBridgeAction(connect);
    }
  });

  bridgeDialog.addEventListener('close', () => setResult(''));
  setInterval(checkBridgeHealth, BRIDGE_KEEP_ALIVE_MS);
  updateBackendControls();
  updateActions();
})();
