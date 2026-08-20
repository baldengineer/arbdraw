// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// ArbDraw UI for the local Python instrument bridge.
(function initializeInstrumentControls() {
  const BRIDGE_URL_STORAGE_KEY = 'arbdraw-bridge-url';
  const defaultBridgeUrl = globalThis.ARBDRAW_DEFAULTS?.bridgeUrl || 'http://127.0.0.1:8876';
  const bridgeDialog = $('bridgeDialog');
  const bridgeUrlInput = $('bridgeUrlInput');
  const resourceSelect = $('visaResourceSelect');
  const connectButton = $('bridgeConnectBtn');
  const refreshButton = $('refreshResourcesBtn');
  const identifyButton = $('identifyResourceBtn');
  const sendButton = $('sendWaveformBtn');
  const statusElement = $('bridgeStatus');
  const resultElement = $('bridgeResult');
  let bridgeClient = null;
  let busy = false;

  try {
    bridgeUrlInput.value = localStorage.getItem(BRIDGE_URL_STORAGE_KEY) || defaultBridgeUrl;
  } catch {
    bridgeUrlInput.value = defaultBridgeUrl;
  }

  function selectedResource() {
    return resourceSelect.value;
  }

  function setStatus(kind, message) {
    statusElement.dataset.status = kind;
    statusElement.textContent = message;
  }

  function setResult(message = '', isError = false) {
    resultElement.textContent = message;
    resultElement.classList.toggle('error', isError);
  }

  function updateActions() {
    const hasResource = Boolean(selectedResource());
    connectButton.disabled = busy;
    refreshButton.disabled = busy || !bridgeClient;
    identifyButton.disabled = busy || !bridgeClient || !hasResource;
    sendButton.disabled = busy || !bridgeClient || !hasResource;
  }

  async function runBridgeAction(action) {
    if (busy) return;
    busy = true;
    updateActions();
    try {
      await action();
    } catch (error) {
      setResult(error.message || 'The bridge request failed.', true);
    } finally {
      busy = false;
      updateActions();
    }
  }

  async function loadResources({ preserveSelection = true } = {}) {
    const previous = preserveSelection ? selectedResource() : '';
    setResult('Scanning VISA resources…');
    const resources = await bridgeClient.listResources();
    resourceSelect.replaceChildren();
    if (!resources.length) {
      resourceSelect.add(new Option('No VISA resources found', ''));
      setResult('The bridge is online, but VISA reported no resources.');
      return;
    }
    resources.forEach((resource) => resourceSelect.add(new Option(resource, resource)));
    if (resources.includes(previous)) resourceSelect.value = previous;
    setResult(`Found ${resources.length} VISA resource${resources.length === 1 ? '' : 's'}.`);
  }

  async function connect() {
    let candidate;
    bridgeClient = null;
    try {
      candidate = new ArbDrawBridge.BridgeClient(bridgeUrlInput.value);
    } catch (error) {
      setStatus('offline', 'Not connected');
      throw error;
    }
    setStatus('connecting', 'Connecting…');
    let health;
    try {
      health = await candidate.health();
    } catch (error) {
      setStatus('offline', 'Bridge offline');
      throw error;
    }
    bridgeClient = candidate;
    bridgeUrlInput.value = candidate.baseUrl;
    try {
      localStorage.setItem(BRIDGE_URL_STORAGE_KEY, candidate.baseUrl);
    } catch {
      // The connection still works if browser storage is unavailable.
    }
    setStatus('online', `Connected · API ${health.api_version || 'v1'}`);
    await loadResources({ preserveSelection: false });
  }

  $('instrumentsBtn').addEventListener('click', () => {
    closeFileMenu();
    bridgeDialog.showModal();
    if (!bridgeClient) runBridgeAction(connect);
  });

  connectButton.addEventListener('click', () => runBridgeAction(connect));
  refreshButton.addEventListener('click', () => runBridgeAction(loadResources));
  resourceSelect.addEventListener('change', () => {
    setResult('');
    updateActions();
  });

  identifyButton.addEventListener('click', () =>
    runBridgeAction(async () => {
      setResult(`Querying ${selectedResource()}…`);
      const response = await bridgeClient.identify(selectedResource());
      setResult(response.identity || response.response || 'The instrument returned an empty response.');
    }),
  );

  sendButton.addEventListener('click', () =>
    runBridgeAction(async () => {
      const resource = selectedResource();
      setResult(`Sending ${state.data.length.toLocaleString()} samples to ${resource}…`);
      const response = await bridgeClient.sendWaveform(
        resource,
        JSON.parse(JSON.stringify(projectDocument)),
      );
      const message = response?.message || `Waveform sent to ${resource}.`;
      setResult(message);
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
  updateActions();
})();
