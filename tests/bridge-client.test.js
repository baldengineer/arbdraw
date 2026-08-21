// Run with: node --test tests/bridge-client.test.js
const assert = require('node:assert/strict');
const test = require('node:test');
require('../js/bridge-client.js');

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => JSON.stringify(payload) };
}

test('normalizes the bridge URL and lists resources', async () => {
  const calls = [];
  const client = new ArbDrawBridge.BridgeClient('http://127.0.0.1:8876/', {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ resources: ['USB0::INSTR'] });
    },
  });
  assert.deepEqual(await client.listResources(), ['USB0::INSTR']);
  assert.equal(calls[0].url, 'http://127.0.0.1:8876/api/v1/visa/resources');
});

test('sends IDN through the dedicated endpoint', async () => {
  let request;
  const client = new ArbDrawBridge.BridgeClient('http://localhost:8876', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ identity: 'Vendor,Model,Serial,Firmware' });
    },
  });
  const result = await client.identify('TCPIP0::host::INSTR', { timeoutMs: 1000 });
  assert.equal(result.identity, 'Vendor,Model,Serial,Firmware');
  assert.deepEqual(JSON.parse(request.options.body), {
    resource: 'TCPIP0::host::INSTR',
    timeout_ms: 1000,
  });
});

test('wraps IPv4 addresses as TCPIP VISA resources', async () => {
  assert.equal(
    ArbDrawBridge.normalizeVisaResource('192.168.1.50'),
    'TCPIP0::192.168.1.50::INSTR',
  );
  assert.equal(
    ArbDrawBridge.normalizeVisaResource('USB0::INSTR'),
    'USB0::INSTR',
  );
  assert.equal(
    ArbDrawBridge.normalizeVisaResource('999.1.1.1'),
    '999.1.1.1',
  );
});

test('surfaces bridge error messages', async () => {
  const client = new ArbDrawBridge.BridgeClient('http://localhost:8876', {
    fetchImpl: async () =>
      response(
        { error: { code: 'waveform_handler_unconfigured', message: 'No handler configured.' } },
        { ok: false, status: 501 },
      ),
  });
  await assert.rejects(
    () => client.sendWaveform('USB0::INSTR', { schema: 'arbdraw.waveform' }),
    (error) => error.code === 'waveform_handler_unconfigured' && error.status === 501,
  );
});
