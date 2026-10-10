const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/project.js'), 'utf8');
const helper = source.slice(source.indexOf('function downloadBlob('), source.indexOf('function buildCsvRows('));

for (const failClick of [false, true]) {
  test(`downloads release their object URL ${failClick ? 'when the click fails' : 'after the click'}`, () => {
    const blob = new Blob(['waveform']);
    const events = [];
    const link = {
      click() {
        assert.equal(this.href, 'blob:test');
        assert.equal(this.download, 'waveform.csv');
        events.push('click');
        if (failClick) throw new Error('Download failed');
      },
    };
    const context = vm.createContext({
      document: { createElement: () => link },
      URL: {
        createObjectURL(value) {
          assert.equal(value, blob);
          return 'blob:test';
        },
        revokeObjectURL(url) {
          assert.equal(url, 'blob:test');
          events.push('release');
        },
      },
    });
    vm.runInContext(helper, context);
    if (failClick) assert.throws(() => context.downloadBlob(blob, 'waveform.csv'), /Download failed/);
    else context.downloadBlob(blob, 'waveform.csv');
    assert.deepEqual(events, ['click', 'release']);
  });
}
