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

    async request(path, { method = 'GET', body, timeoutMs = this.timeoutMs } = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        const timedOut = error?.name === 'AbortError';
        throw new BridgeRequestError(
          timedOut
            ? `The Python bridge did not respond within ${timeoutMs} ms.`
            : 'Could not reach the Python bridge. Make sure it is running and the URL is correct.',
          { code: timedOut ? 'bridge_timeout' : 'bridge_unreachable', cause: error },
        );
      } finally {
        clearTimeout(timeout);
      }

      const text = await response.text();
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

    async listResources() {
      const payload = await this.request('/api/v1/visa/resources');
      if (!Array.isArray(payload?.resources)) {
        throw new BridgeRequestError('The bridge resource response is malformed.', {
          code: 'invalid_bridge_response',
        });
      }
      return payload.resources;
    }

    identify(resource, { timeoutMs = 5000 } = {}) {
      return this.request('/api/v1/visa/idn', {
        method: 'POST',
        body: { resource: normalizeVisaResource(resource), timeout_ms: timeoutMs },
        timeoutMs: timeoutMs + 1000,
      });
    }

    query(resource, command, { timeoutMs = 5000 } = {}) {
      return this.request('/api/v1/visa/query', {
        method: 'POST',
        body: { resource: normalizeVisaResource(resource), command, timeout_ms: timeoutMs },
        timeoutMs: timeoutMs + 1000,
      });
    }

    sendWaveform(resource, waveformDocument, { options = {}, timeoutMs = 60000 } = {}) {
      return this.request('/api/v1/waveforms/send', {
        method: 'POST',
        body: { resource: normalizeVisaResource(resource), waveform: waveformDocument, options },
        timeoutMs,
      });
    }
  }

  globalScope.ArbDrawBridge = Object.freeze({ BridgeClient, BridgeRequestError, normalizeVisaResource });
})(globalThis);
