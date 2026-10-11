const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function projectContext() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'js/defaults.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/core.js'), 'utf8'), context);
  const projectSource = fs.readFileSync(path.join(root, 'js/project.js'), 'utf8');
  vm.runInContext(
    projectSource.slice(
      projectSource.indexOf('function parseProject('),
      projectSource.indexOf('function loadProject('),
    ),
    context,
  );
  return context;
}

test('Custom is not offered or retained as a waveshape', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const views = fs.readFileSync(path.join(root, 'js/views.js'), 'utf8');

  assert.doesNotMatch(html, /data-wave=["']custom["']/i);
  assert.doesNotMatch(editor, /markCustom|drawCustomPreview|type === ['"]custom['"]/);
  assert.doesNotMatch(views, /markCustom/);
});

test('waveshape selector and menu keep DC and RC uppercase without changing other labels', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'js/waveform-editor.js'), 'utf8');
  const options = new Map();
  const menu = html.match(/<div id="functionSelectMenu"[\s\S]*?<\/div>/)?.[0];
  assert.ok(menu);
  for (const [, type, label] of menu.matchAll(/<button data-wave="([^"]+)"[^>]*><canvas aria-hidden="true"><\/canvas><span>([^<]+)<\/span><\/button>/g)) {
    options.set(type, { label, checked: null, setAttribute(name, value) {
      if (name === 'aria-checked') this.checked = value;
    }, dataset: { wave: type } });
  }
  const expected = new Map([
    ['sine', 'Sine'], ['square', 'Square'], ['triangle', 'Triangle'],
    ['rc', 'RC'], ['serial', 'Serial'], ['pulse', 'Pulse'],
    ['dc', 'DC'], ['noise', 'Noise'],
  ]);
  assert.deepEqual(Array.from(options, ([type, option]) => [type, option.label]), Array.from(expected));
  assert.match(html, /id="functionSelectBtn"[^>]*><canvas aria-hidden="true"><\/canvas><span>Sine<\/span>/);
  assert.doesNotMatch(html.match(/<button id="functionSelectBtn"[^>]*>/)?.[0] || '', /aria-label=/);
  assert.doesNotMatch(menu, /aria-label=/);

  const selected = { textContent: '' };
  const button = { querySelector: (selector) => selector === 'span' ? selected : {} };
  const context = vm.createContext({
    $: (id) => id === 'functionSelectBtn' ? button : { querySelectorAll: () => [...options.values()] },
    drawMini() {},
  });
  vm.runInContext(editor.slice(editor.indexOf('function updateFunctionSelect('), editor.indexOf('function closeFunctionSelectMenu(')), context);
  for (const [type, label] of expected) {
    context.updateFunctionSelect(type);
    assert.equal(selected.textContent, label);
    for (const [optionType, option] of options) {
      assert.equal(option.checked, String(optionType === type));
    }
  }
});

test('removed and unknown waveshape types normalize to sine while preserving edited samples', () => {
  const context = projectContext();
  assert.equal(context.normalizeDefaults({ waveformType: 'custom' }).waveformType, 'sine');
  assert.equal(context.normalizeDefaults({ waveformType: 'free' }).waveformType, 'sine');

  for (const type of ['custom', 'free', 'ramp', 'not-a-wave', 'toString']) {
    const document = context.createDefaultDocument();
    document.waveform.type = type;
    document.waveform.samplesEdited = true;
    document.AWG.sampleCount = document.waveform.sampleCount = 4;
    document.waveform.values = [0, 0.25, -0.5, 1];
    const imported = context.parseProject(document).waveform;
    assert.equal(imported.type, 'sine');
    assert.equal(imported.samplesEdited, true);
    assert.deepEqual(Array.from(imported.values), document.waveform.values);
  }
});

test('known generated waveshapes do not become edited when imported', () => {
  const context = projectContext();
  const document = context.createDefaultDocument();
  document.waveform.type = 'square';
  document.AWG.sampleCount = document.waveform.sampleCount = 4;
  document.waveform.values = [-1, -1, 1, 1];

  assert.equal(context.parseProject(document).waveform.samplesEdited, false);
  document.waveform.samplesEdited = true;
  assert.equal(context.parseProject(document).waveform.samplesEdited, true);

  document.waveform.values = [];
  assert.equal(context.parseProject(document).waveform.samplesEdited, false);
});

test('source voltage levels survive filtering and project JSON round trips', () => {
  const context = projectContext();
  const document = context.createDefaultDocument();
  document.waveform.sourceHighVoltage = 5;
  document.waveform.sourceLowVoltage = -5;
  document.waveform.highVoltage = 5.8;
  document.waveform.lowVoltage = -5.6;
  document.waveform.filters.noiseEnabled = true;
  document.AWG.sampleCount = document.waveform.sampleCount = 4;
  document.waveform.values = [-5.6, -1, 2, 5.8];

  const imported = context.parseProject(JSON.parse(JSON.stringify(document))).waveform;
  assert.equal(imported.sourceHighVoltage, 5);
  assert.equal(imported.sourceLowVoltage, -5);
  assert.equal(imported.highVoltage, 5.8);
  assert.equal(imported.lowVoltage, -5.6);
});

test('legacy projects use their declared levels as filter source levels', () => {
  const context = projectContext();
  const document = context.createDefaultDocument();
  delete document.waveform.sourceHighVoltage;
  delete document.waveform.sourceLowVoltage;
  document.waveform.highVoltage = 5;
  document.waveform.lowVoltage = -5;

  const imported = context.parseProject(document).waveform;
  assert.equal(imported.sourceHighVoltage, 5);
  assert.equal(imported.sourceLowVoltage, -5);
});
