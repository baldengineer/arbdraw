const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

async function runDriverLoader({ search = '', failCdn = false } = {}) {
  const source = fs.readFileSync(path.join(root, 'js/driver-loader.js'), 'utf8');
  const attempts = [];
  const elements = new Map();
  let context;
  const document = {
    createElement(tagName) {
      return {
        tagName,
        remove() {
          if (elements.get(this.id) === this) elements.delete(this.id);
        },
      };
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    head: {
      append(element) {
        const url = element.href || element.src;
        attempts.push(url);
        elements.set(element.id, element);
        queueMicrotask(() => {
          if (failCdn && url.includes('cdn.jsdelivr.net')) {
            element.onerror();
            return;
          }
          if (element.tagName === 'script') {
            context.driver = { js: { driver: function driverFactory() {} } };
          }
          element.onload();
        });
      },
    },
  };
  context = vm.createContext({
    clearTimeout,
    console: { error() {}, warn() {} },
    document,
    location: { search },
    Promise,
    queueMicrotask,
    setTimeout,
    URLSearchParams,
  });
  vm.runInContext(source, context);
  const driverFactory = await context.ARBDRAW_DRIVER_READY;
  return { attempts, driverFactory, source: context.ARBDRAW_DRIVER_SOURCE };
}

test('Driver.js loader defaults to a pinned CDN release with a local fallback', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const loader = fs.readFileSync(path.join(root, 'js/driver-loader.js'), 'utf8');
  const license = fs.readFileSync(path.join(root, 'vendor/driver.js/1.8.0/LICENSE'), 'utf8');

  assert.match(html, /js\/driver-loader\.js/);
  assert.match(loader, /const version = '1\.8\.0'/);
  assert.match(loader, /cdn\.jsdelivr\.net\/npm\/driver\.js@\$\{version\}/);
  assert.match(loader, /cssIntegrity: 'sha384-/);
  assert.match(loader, /scriptIntegrity: 'sha384-/);
  assert.match(loader, /element\.crossOrigin = 'anonymous'/);
  assert.match(loader, /vendor\/driver\.js\/\$\{version\}/);
  assert.match(loader, /return await loadSource\('cdn'\)/);
  assert.match(loader, /return loadSource\('local'\)/);
  assert.match(loader, /preference === 'local'/);
  assert.match(loader, /ARBDRAW_DRIVER_READY = selectSource\(\)/);
  assert.match(license, /The MIT License/);
  assert.match(license, /Copyright \(c\) Kamran Ahmed/);
});

test('Driver.js loader selects CDN, fallback, and forced-local paths correctly', async () => {
  const cdn = await runDriverLoader();
  assert.equal(cdn.source, 'cdn');
  assert.equal(typeof cdn.driverFactory, 'function');
  assert.equal(cdn.attempts.length, 2);
  assert.ok(cdn.attempts.every((url) => url.includes('cdn.jsdelivr.net/npm/driver.js@1.8.0')));

  const fallback = await runDriverLoader({ failCdn: true });
  assert.equal(fallback.source, 'local');
  assert.match(fallback.attempts[0], /cdn\.jsdelivr\.net/);
  assert.deepEqual(
    fallback.attempts.slice(-2),
    ['vendor/driver.js/1.8.0/driver.css', 'vendor/driver.js/1.8.0/driver.js.iife.js'],
  );

  const local = await runDriverLoader({ search: '?driver=local' });
  assert.equal(local.source, 'local');
  assert.ok(local.attempts.every((url) => url.startsWith('vendor/driver.js/1.8.0/')));
});

test('onboarding defines the starter tour through Driver.js', () => {
  const source = fs.readFileSync(path.join(root, 'js/onboarding.js'), 'utf8');
  const starterTourSource = source.slice(
    source.indexOf('const steps = ['),
    source.indexOf('// Instruments Dialog Guide'),
  );
  const starterTourTargets = [...starterTourSource.matchAll(/element: '([^']+)'/g)]
    .map((match) => match[1]);

  assert.match(source, /globalThis\.ARBDRAW_DRIVER_READY/);
  assert.deepEqual(starterTourTargets, [
    '#toolrail',
    '.function-section',
    '.inspector',
    '#editorControls',
    '#editorView',
  ]);
  assert.match(source, /showProgress: true/);
  assert.match(source, /localStorage\.setItem\(storageKey, 'complete'\)/);
  assert.match(source, /get\('onboard'\)/);
  assert.match(source, /matchMedia\?\.\('\(max-width: 900px\)'\)\.matches/);
  assert.match(source, /urlOverride !== false && !compactViewport/);
});

test('Help menu provides a permanent way to restart onboarding', () => {
  const source = fs.readFileSync(path.join(root, 'js/help.js'), 'utf8');

  assert.match(source, /title: 'Getting started'/);
  assert.match(source, /ARBDRAW_ONBOARDING\?\.start\(\)/);
  assert.match(source, /if \(item\.action\)/);
});

test('Instruments dialog provides a Driver.js guide', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/onboarding.js'), 'utf8');
  const instruments = fs.readFileSync(path.join(root, 'js/instruments.js'), 'utf8');

  assert.match(html, /id="instrumentGuideBtn"[^>]*>Guide<\/button>/);
  assert.match(html, /class="bridge-control-group bridge-connection-group"/);
  assert.match(html, /<legend>Bridge connection<\/legend>/);
  assert.match(html, /id="bridgeInstrumentControls" class="bridge-control-group bridge-instrument-group" disabled/);
  assert.match(html, /<legend>Instrument &amp; waveform<\/legend>/);
  assert.match(instruments, /instrumentControls\.disabled = !bridgeOnline/);
  assert.match(source, /element: '\.bridge-connection-row'/);
  assert.match(source, /element: '\.bridge-adapter-field'/);
  assert.match(source, /element: '\.bridge-resource-control'/);
  assert.match(source, /element: '\.bridge-send-options'/);
  assert.match(source, /element: '\.bridge-actions'/);
  assert.match(source, /bridgeDialog\.show\(\)/);
  assert.match(source, /bridgeDialog\.showModal\(\)/);
  assert.match(source, /instrumentGuideBtn'\)\?\.addEventListener\('click', startInstrumentGuide\)/);
});

test('Instrument controls follow the bridge connection state', () => {
  const source = fs.readFileSync(path.join(root, 'js/instruments.js'), 'utf8');
  const updateActionsSource = source.match(/  function updateActions\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(updateActionsSource);

  const instrumentControls = { disabled: false };
  const context = vm.createContext({
    bridgeOnline: false,
    busy: false,
    connectButton: {},
    refreshButton: {},
    identifyButton: {},
    instrumentControls,
    selectedResource: () => 'USB0::INSTR',
    sendButton: {},
  });
  vm.runInContext(`${updateActionsSource}\nupdateActions();`, context);
  assert.equal(instrumentControls.disabled, true);

  context.bridgeOnline = true;
  vm.runInContext('updateActions();', context);
  assert.equal(instrumentControls.disabled, false);

  context.bridgeOnline = false;
  vm.runInContext('updateActions();', context);
  assert.equal(instrumentControls.disabled, true);
});
