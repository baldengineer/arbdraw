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

test('passes profile PyVISA options to IDN and waveform requests', async () => {
  const bodies = [];
  const client = new ArbDrawBridge.BridgeClient('http://localhost:8876', {
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return response(url.endsWith('/visa/idn') ? { identity: 'Rigol' } : { status: 'sent' });
    },
  });
  const pyvisaOptions = {
    read_termination: '\n',
    write_termination: '\r\n',
    query_delay: 5,
    send_end: true,
  };

  await client.identify('USB0::INSTR', { pyvisaOptions });
  await client.sendWaveform(
    'USB0::INSTR',
    { schema: 'arbdraw.waveform', version: 1 },
    { adapter: 'rigol-dg1022', pyvisaOptions },
  );

  assert.deepEqual(bodies[0].pyvisa_options, pyvisaOptions);
  assert.deepEqual(bodies[1].pyvisa_options, pyvisaOptions);
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

test('lists installed adapters', async () => {
  const client = new ArbDrawBridge.BridgeClient('http://localhost:8876', {
    fetchImpl: async () => response({ adapters: [{ id: 'owon-xdg3000', name: 'OWON XDG3000' }] }),
  });
  assert.deepEqual(await client.listAdapters(), [{ id: 'owon-xdg3000', name: 'OWON XDG3000' }]);
});

test('sends adapter channel and output options with a waveform', async () => {
  let request;
  const client = new ArbDrawBridge.BridgeClient('http://localhost:8876', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ status: 'sent' });
    },
  });
  await client.sendWaveform(
    'USB0::INSTR',
    { schema: 'arbdraw.waveform', version: 1 },
    { options: { channel: 2, enable_output: true } },
  );
  const body = JSON.parse(request.options.body);
  assert.equal(body.adapter, 'default');
  assert.deepEqual(body.options, {
    channel: 2,
    enable_output: true,
  });
});
const delayedFetch = ({ stall = false, text = '{"status":"ok"}', fail = false, ok = true, status = 200 } = {}) =>
  async (_url, { signal }) => ({ ok, status, text: () => new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    if (!stall) setTimeout(() => {
      signal.removeEventListener('abort', abort);
      if (fail) reject(new TypeError('body transport failed'));
      else resolve(text);
    }, 5);
  }) });

test('request deadline covers an abort-aware body that stalls after headers', async () => {
  let signal;
  const fetchImpl = delayedFetch({ stall: true });
  const client = new ArbDrawBridge.BridgeClient('http://localhost:8876', { timeoutMs: 20,
    fetchImpl: (url, options) => { signal = options.signal; return fetchImpl(url, options); } });
  await assert.rejects(client.health(), { code: 'bridge_timeout' });
  assert.equal(signal.aborted, true);
});

test('body consumption preserves success, malformed JSON, transport and HTTP errors', async () => {
  for (const [options, expected] of [
    [{}, null], [{ text: 'not json' }, 'invalid_bridge_response'],
    [{ fail: true }, 'bridge_unreachable'],
    [{ ok: false, status: 403, text: '{"error":{"code":"origin_not_allowed","message":"Denied"}}' }, 'origin_not_allowed'],
  ]) {
    const client = new ArbDrawBridge.BridgeClient('http://localhost:8876', { timeoutMs: 1000, fetchImpl: delayedFetch(options) });
    if (expected) await assert.rejects(client.health(), { code: expected });
    else assert.deepEqual(await client.health(), { status: 'ok' });
  }
});

test('a stalled body releases instrument action and keepalive state', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../js/instruments.js'), 'utf8');
  const extract = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
  const client = new ArbDrawBridge.BridgeClient('http://localhost:8876', { timeoutMs: 10, fetchImpl: delayedFetch({ stall: true }) });
  let offline = 0;
  const context = vm.createContext({ bridgeClient: client, bridgeDialog: { open: true }, busy: false, keepAlivePending: false,
    updateActions() {}, setResult() {}, isConnectionError: () => true,
    markBridgeOnline() {}, markBridgeOffline() { offline++; } });
  vm.runInContext(extract('  async function runBridgeAction(', '  async function loadResources(')
    + extract('  async function checkBridgeHealth(', '  function openSendToAwgDialog('), context);
  await context.runBridgeAction(() => client.health());
  assert.equal(context.busy, false);
  await context.checkBridgeHealth();
  assert.equal(context.keepAlivePending, false);
  await context.checkBridgeHealth();
  assert.equal(offline, 3);
});
