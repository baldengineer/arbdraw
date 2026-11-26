// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// REST client for the local ArbDraw Python bridge.
(function initializeBridgeClient(globalScope) {
  function normalizeVisaResource(resource) {
    const value = String(resource || '').trim();
    const octets = value.split('.');
    const isIpv4 = octets.length === 4 && octets.every((octet) =>
      /^\d{1,3}$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255,
    );
    return isIpv4 ? `TCPIP0::${value}::INSTR` : value;
  }

  function addPyVisaOptions(payload, pyvisaOptions) {
    if (pyvisaOptions && typeof pyvisaOptions === 'object' && Object.keys(pyvisaOptions).length) {
      payload.pyvisa_options = { ...pyvisaOptions };
    }
    return payload;
  }

  function queryDelayMilliseconds(pyvisaOptions) {
    const delay = Number(pyvisaOptions?.query_delay);
    return Number.isFinite(delay) && delay > 0 ? delay * 1000 : 0;
  }

  class BridgeRequestError extends Error {
    constructor(message, { status = 0, code = 'bridge_request_failed', cause } = {}) {
      super(message, { cause });
      this.name = 'BridgeRequestError';
      this.status = status;
      this.code = code;
    }
  }

  class BridgeClient {
    constructor(baseUrl, { fetchImpl = globalScope.fetch, timeoutMs = 10000 } = {}) {
      if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
      this.fetchImpl = fetchImpl === globalScope.fetch ? fetchImpl.bind(globalScope) : fetchImpl;
      this.timeoutMs = timeoutMs;
      this.setBaseUrl(baseUrl);
    }

    setBaseUrl(baseUrl) {
      const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
      let parsed;
      try {
        parsed = new URL(normalized);
      } catch {
        throw new BridgeRequestError('Enter a valid bridge URL, such as http://127.0.0.1:8876.', {
          code: 'invalid_bridge_url',
        });
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new BridgeRequestError('The bridge URL must use HTTP or HTTPS.', {
          code: 'invalid_bridge_url',
        });
      }
      this.baseUrl = parsed.toString().replace(/\/$/, '');
    }

    async request(path, { method = 'GET', body, binary = false, timeoutMs = this.timeoutMs } = {}) {
      if (globalScope.location?.protocol === 'file:') {
        throw new BridgeRequestError('Open ArbDraw at http://127.0.0.1:8876 after starting the bridge with --serve-app .; file:// pages cannot control instruments.', {
          code: 'origin_not_allowed',
        });
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response, text;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' },
          body: body === undefined || binary ? body : JSON.stringify(body),
          signal: controller.signal,
        });
        text = await response.text();
      } catch (error) {
        const timedOut = controller.signal.aborted || error?.name === 'AbortError';
        throw new BridgeRequestError(
          timedOut
            ? `The Python bridge did not respond within ${timeoutMs} ms.`
            : 'Could not reach the Python bridge. Make sure it is running and the URL is correct.',
          { code: timedOut ? 'bridge_timeout' : 'bridge_unreachable', cause: error },
        );
      } finally {
        clearTimeout(timeout);
      }

      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw new BridgeRequestError('The Python bridge returned invalid JSON.', {
            status: response.status,
            code: 'invalid_bridge_response',
          });
        }
      }

      if (!response.ok) {
        throw new BridgeRequestError(
          payload?.error?.message || `The Python bridge returned HTTP ${response.status}.`,
          {
            status: response.status,
            code: payload?.error?.code || 'bridge_request_failed',
          },
        );
      }
      return payload;
    }

    health() {
      return this.request('/api/v1/health');
    }

    discover(path) {
      // Same-origin GET omits Origin in browsers. JSON POST carries it through
      // the bridge's normal admission checks when the bridge serves the app.
      const local = globalScope.location?.origin === new URL(this.baseUrl).origin;
      return local ? this.request(path, { method: 'POST', body: {} }) : this.request(path);
    }

    async listResources() {
      const payload = await this.discover('/api/v1/visa/resources');
      if (!Array.isArray(payload?.resources)) {
        throw new BridgeRequestError('The bridge resource response is malformed.', {
          code: 'invalid_bridge_response',
        });
      }
      return payload.resources;
    }

    async listAdapters() {
      const payload = await this.discover('/api/v1/adapters');
      if (!Array.isArray(payload?.adapters)) {
        throw new BridgeRequestError('The bridge adapter response is malformed.', { code: 'invalid_bridge_response' });
      }
      return payload.adapters;
    }

    identify(resource, { timeoutMs = 5000, pyvisaOptions = {} } = {}) {
      return this.request('/api/v1/visa/idn', {
        method: 'POST',
        body: addPyVisaOptions(
          { resource: normalizeVisaResource(resource), timeout_ms: timeoutMs },
          pyvisaOptions,
        ),
        timeoutMs: timeoutMs + queryDelayMilliseconds(pyvisaOptions) + 1000,
      });
    }

    query(resource, command, { timeoutMs = 5000, pyvisaOptions = {} } = {}) {
      return this.request('/api/v1/visa/query', {
        method: 'POST',
        body: addPyVisaOptions(
          { resource: normalizeVisaResource(resource), command, timeout_ms: timeoutMs },
          pyvisaOptions,
        ),
        timeoutMs: timeoutMs + queryDelayMilliseconds(pyvisaOptions) + 1000,
      });
    }

    sendPackedWaveform(resource, file, { adapter, channel, enable, rate, low, high, profileId }) {
      const count = file.size / 2;
      if (!Number.isInteger(count) || count < 168 || count > 134217728)
        throw new BridgeRequestError('Select a signed 16-bit little-endian file with 168 to 134,217,728 samples.');
      if (!Number.isFinite(rate) || rate < 0.000001 || rate > 2e9 ||
          !Number.isFinite(low) || !Number.isFinite(high) || low < -5 || high > 5 || low > high)
        throw new BridgeRequestError('Enter a valid playback sample rate and voltage interval.');
      const metadata = { resource: normalizeVisaResource(resource), adapter, sample_encoding: 's16le',
        options: { channel, enable_output: enable },
        waveform: { schema: 'arbdraw.waveform', version: 1,
          AWG: { profileId, sampleCount: count, frequencyHz: rate / count },
          waveform: { sampleCount: count, highVoltage: high, lowVoltage: low } } };
      return this.request('/api/v1/waveforms/send-packed', { method: 'POST', binary: true,
        body: new Blob([JSON.stringify(metadata) + '\n', file]), timeoutMs: 1800000 });
    }

    sendWaveform(
      resource,
      waveformDocument,
      { adapter = 'default', options = {}, pyvisaOptions = {}, timeoutMs = 180000 } = {},
    ) {
      return this.request('/api/v1/waveforms/send', {
        method: 'POST',
        body: addPyVisaOptions(
          { resource: normalizeVisaResource(resource), waveform: waveformDocument, adapter, options },
          pyvisaOptions,
        ),
        timeoutMs,
      });
    }
  }

  globalScope.ArbDrawBridge = Object.freeze({ BridgeClient, BridgeRequestError, normalizeVisaResource });
})(globalThis);
