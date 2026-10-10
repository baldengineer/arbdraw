const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/project.js'), 'utf8');
const helperSource = source.slice(
  source.indexOf('function buildCsvRows('),
  source.indexOf('function downloadCsv('),
);
const context = vm.createContext({});
vm.runInContext(helperSource, context);

test('CSV includes timestamp and voltage columns by default', () => {
  const rows = context.buildCsvRows({
    values: [1, 2, 3],
    durationSeconds: 1,
    metadata: [['Waveform name', 'Test']],
    includeHeader: true,
    includeTimestamps: true,
  });

  assert.deepEqual(Array.from(rows), [
    'Waveform name,Test',
    '',
    'Time (s),Voltage (V)',
    '0,1',
    '0.5,2',
    '1,3',
  ]);
});

test('CSV can export only voltage samples', () => {
  const rows = context.buildCsvRows({
    values: [1, 2, 3],
    durationSeconds: 1,
    includeHeader: false,
    includeTimestamps: false,
  });

  assert.deepEqual(Array.from(rows), ['1', '2', '3']);
});

test('CSV exports a million-point record with accurate extrema and sample order', async () => {
  const values = new Array(1_000_000).fill(0);
  values[0] = -4;
  values[500_000] = 9;
  values[values.length - 1] = 2;
  let downloadedBlob;
  const exportContext = vm.createContext({
    Blob,
    state: { data: values, duration: 1000, type: 'sine', high: 9, low: -4, frequency: 1 },
    titles: { sine: 'Sine wave' },
    document: { querySelector: () => ({ value: 'Large record' }) },
    downloadBlob(blob, filename) {
      downloadedBlob = blob;
      assert.equal(filename, 'large.csv');
    },
    showToast() {},
  });
  vm.runInContext(source.slice(source.indexOf('function buildCsvRows('), source.indexOf('function downloadSvg(')), exportContext);
  exportContext.downloadCsv(true, 'large.csv', false);
  const csv = await downloadedBlob.text();
  assert.ok(csv.includes('Voltage min (V),-4\r\nVoltage max (V),9\r\n'));
  const samples = csv.split('Voltage (V)\r\n')[1].trimEnd().split('\r\n');
  assert.equal(samples.length, values.length);
  assert.equal(samples[0], '-4');
  assert.equal(samples[500_000], '9');
  assert.equal(samples.at(-1), '2');
});

test('CSV dialog defaults timestamp column to enabled and hides it for other formats', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /id="includeCsvTimestamps" type="checkbox" checked/);
  assert.match(source, /csvTimestampsOption'\)\.hidden = !csv/);
  assert.match(source, /setIncludeCsvTimestampsPreference\(includeCsvTimestampsPreference, false\)/);
  assert.match(source, /downloadCsv\([\s\S]*includeCsvTimestamps'\)\.checked/);
});

test('CSV timestamp preference persists and resets for a new project', () => {
  const defaultsSource = fs.readFileSync(path.join(root, 'js/defaults.js'), 'utf8');
  const coreSource = fs.readFileSync(path.join(root, 'js/core.js'), 'utf8');
  const propertiesSource = fs.readFileSync(path.join(root, 'js/properties.js'), 'utf8');
  const settingsContext = vm.createContext({});
  vm.runInContext(defaultsSource, settingsContext);
  vm.runInContext(coreSource, settingsContext);

  assert.match(defaultsSource, /includeCsvTimestamps:\s*true/);
  assert.match(coreSource, /includeCsvTimestamps:\s*source\.includeCsvTimestamps !== false/);
  assert.equal(settingsContext.normalizeDefaults({}).includeCsvTimestamps, true);
  assert.equal(
    settingsContext.normalizeDefaults({ includeCsvTimestamps: false }).includeCsvTimestamps,
    false,
  );
  assert.match(
    source,
    /persistSettings\(\{ includeCsvTimestamps: includeCsvTimestampsPreference \}\)/,
  );
  assert.match(source, /includeCsvTimestamps'\)\.addEventListener\('change'/);
  assert.match(
    source,
    /confirmNewBtn'\)\.onclick[\s\S]*setIncludeCsvTimestampsPreference\(defaultIncludeCsvTimestamps\)/,
  );
  assert.match(
    propertiesSource,
    /defaultAllBtn'\)\.onclick[\s\S]*resetStoredSettings\(\)[\s\S]*location\.reload\(\)/,
  );
});
