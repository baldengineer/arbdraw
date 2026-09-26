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

test('removed and unknown waveshape types normalize to sine while preserving samples', () => {
  const context = projectContext();
  assert.equal(context.normalizeDefaults({ waveformType: 'custom' }).waveformType, 'sine');
  assert.equal(context.normalizeDefaults({ waveformType: 'free' }).waveformType, 'sine');

  for (const type of ['custom', 'free', 'not-a-wave']) {
    const document = context.createDefaultDocument();
    document.waveform.type = type;
    document.AWG.sampleCount = document.waveform.sampleCount = 4;
    document.waveform.values = [0, 0.25, -0.5, 1];
    const imported = context.parseProject(document).waveform;
    assert.equal(imported.type, 'sine');
    assert.deepEqual(Array.from(imported.values), document.waveform.values);
  }
});
