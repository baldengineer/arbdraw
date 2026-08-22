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
  const connectButton = $('bridgeConnectBtn');
  const refreshButton = $('refreshResourcesBtn');
  const identifyButton = $('identifyResourceBtn');
  const sendButton = $('sendWaveformBtn');
  const channelSelect = $('instrumentChannel');
  const enableOutputCheckbox = $('instrumentEnableOutput');
  const statusElement = $('bridgeStatus');
  const resultElement = $('bridgeResult');
  let bridgeClient = null;
  let bridgeOnline = false;
  let busy = false;
  let keepAlivePending = false;
  let resources = [];

  try {
    bridgeUrlInput.value = localStorage.getItem(BRIDGE_URL_STORAGE_KEY) || defaultBridgeUrl;
  } catch {
    bridgeUrlInput.value = defaultBridgeUrl;
  }

  function selectedResource() {
    return ArbDrawBridge.normalizeVisaResource(resourceInput.value);
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
    resourceMenu.classList.remove('open');
    dropdownButton.setAttribute('aria-expanded', 'false');
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
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'bridge-resource-option';
      option.role = 'option';
      option.dataset.resource = resource;
      option.textContent = resource;
      resourceList.append(option);
    });
  }

  function updateActions() {
    const hasResource = Boolean(selectedResource());
    connectButton.disabled = busy;
    refreshButton.disabled = busy || !bridgeOnline;
    identifyButton.disabled = busy || !bridgeOnline || !hasResource;
    sendButton.disabled = busy || !bridgeOnline || !hasResource;
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

  async function connect() {
    let candidate;
    try {
      candidate = new ArbDrawBridge.BridgeClient(bridgeUrlInput.value);
    } catch (error) {
      setStatus('offline', 'Not connected');
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
    await loadResources({ preserveSelection: false });
  }

  async function checkBridgeHealth() {
    if (!bridgeClient || busy || keepAlivePending) return;
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

  $('instrumentsBtn').addEventListener('click', () => {
    closeFileMenu();
    bridgeDialog.showModal();
    if (!bridgeOnline) runBridgeAction(connect);
  });

  connectButton.addEventListener('click', () => runBridgeAction(connect));
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
    const isOpen = resourceMenu.classList.toggle('open');
    dropdownButton.setAttribute('aria-expanded', String(isOpen));
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
      const response = await bridgeClient.identify(selectedResource());
      setResult(response.identity || response.response || 'The instrument returned an empty response.', false, true);
    }),
  );

  sendButton.addEventListener('click', () =>
    runBridgeAction(async () => {
      const resource = selectedResource();
      setResult(`Sending ${state.data.length.toLocaleString()} samples to ${resource}…`);
      const response = await bridgeClient.sendWaveform(
        resource,
        JSON.parse(JSON.stringify(projectDocument)),
        {
          options: {
            channel: Number(channelSelect.value),
            enable_output: enableOutputCheckbox.checked,
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
  updateActions();
})();
