// Project rendering, naming, import, export, and document validation.
function renderDocument() {
  document.querySelector('.document-name').value = projectDocument.name;
  document.querySelector('.document-name').readOnly = true;
  document.querySelector('.document-name').classList.remove('editing');
  $('highInput').value = displayVoltage('highInput', state.high);
  $('lowInput').value = displayVoltage('lowInput', state.low);
  $('offsetInput').value = displayVoltage('offsetInput', (state.high + state.low) / 2);
  $('amplitudeInput').value = displayAmplitude(state.high - state.low);
  $('cyclesInput').value = state.cycles;
  renderFrequency();
  $('phaseInput').value = state.phase;
  $('dutyInput').value = state.duty;
  $('dutyValue').textContent = state.duty + '%';
  renderTiming();
  document.querySelector('.preset.active')?.classList.remove('active');
  document.querySelector(`.preset[data-wave="${state.type}"]`)?.classList.add('active');
  updateDutyAvailability(state.type);
  renderSerialProperties();
  updateFunctionSelect(state.type);
  draw();
}
function parseProject(raw) {
  if (!raw || raw.schema !== 'arbdraw.waveform' || raw.version !== 1 || !raw.waveform)
    throw new Error('This is not a supported ArbDraw project.');
  const source = raw.waveform,
    number = (key, fallback) =>
      Number.isFinite(Number(source[key])) ? Number(source[key]) : fallback,
    defaults = createDefaultDocument().waveform;
  const sampleCount = Math.max(2, Math.round(number('sampleCount', defaults.sampleCount))),
    sampleRateMSa = Math.max(0.000001, number('sampleRateMSa', defaults.sampleRateMSa));
  const values =
    Array.isArray(source.values) &&
    source.values.length === sampleCount &&
    source.values.every(Number.isFinite)
      ? source.values.map(Number)
      : [];
  const importedType = source.type === 'free' ? 'custom' : source.type;
  const durationMs = sampleCount / (sampleRateMSa * 1000),
    cycles = Math.max(1, Math.round(number('cycles', defaults.cycles))),
    frequencyHz = Math.max(0.000001, number('frequencyHz', defaults.frequencyHz));
  return {
    schema: 'arbdraw.waveform',
    version: 1,
    name: String(raw.name || 'Imported waveform').slice(0, 120),
    waveform: {
      type: titles[importedType] ? importedType : 'custom',
      highVoltage: number('highVoltage', defaults.highVoltage),
      lowVoltage: number('lowVoltage', defaults.lowVoltage),
      durationMs,
      sampleRateMSa,
      frequencyHz,
      cycles,
      phaseDegrees: number('phaseDegrees', defaults.phaseDegrees),
      dutyCyclePercent: Math.min(
        95,
        Math.max(5, number('dutyCyclePercent', defaults.dutyCyclePercent)),
      ),
      serial: normalizeSerialSettings(source.serial, DEFAULT_VALUES),
      sampleCount,
      values,
    },
  };
}
function loadProject(raw) {
  projectDocument = parseProject(raw);
  state.history = [];
  state.redo = [];
  renderDocument();
  if (!state.data.length) generate();
  else pushHistory();
  showToast('Project opened');
}

const projectNameInput = document.querySelector('.document-name');
let projectNameBeforeEdit = projectDocument.name;
function beginProjectNameEdit() {
  if (!projectNameInput.readOnly) return;
  projectNameBeforeEdit = projectDocument.name;
  projectNameInput.readOnly = false;
  projectNameInput.classList.add('editing');
  projectNameInput.focus();
  projectNameInput.select();
}
function commitProjectNameEdit(cancel = false) {
  if (projectNameInput.readOnly) return;
  const nextName = cancel ? projectNameBeforeEdit : projectNameInput.value.trim();
  projectDocument.name = nextName || 'Untitled project';
  projectNameInput.value = projectDocument.name;
  projectNameInput.readOnly = true;
  projectNameInput.classList.remove('editing');
}
projectNameInput.addEventListener('click', beginProjectNameEdit);
projectNameInput.addEventListener('blur', () => commitProjectNameEdit());
projectNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    projectNameInput.blur();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    commitProjectNameEdit(true);
    projectNameInput.blur();
  }
});
$('newBtn').onclick = () => {
  projectDocument = createDefaultDocument();
  state.history = [];
  state.redo = [];
  renderDocument();
  generate();
  showToast('New project created');
};
$('saveBtn').onclick = () => {
  projectDocument.name =
    document.querySelector('.document-name').value.trim() || 'Untitled waveform';
  const json = JSON.stringify(projectDocument, null, 2),
    blob = new Blob([json], { type: 'application/json' }),
    a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download =
    projectDocument.name
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() + '.arbdraw.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Project JSON downloaded');
};
$('openBtn').onclick = () => {
  $('projectJsonInput').value = '';
  $('openError').textContent = '';
  $('projectFileInput').value = '';
  $('openDialog').showModal();
};
$('chooseProjectBtn').onclick = () => $('projectFileInput').click();
$('projectFileInput').onchange = async (event) => {
  const file = event.target.files[0];
  if (file) {
    $('projectJsonInput').value = await file.text();
    $('openError').textContent = '';
  }
};
$('importProjectBtn').onclick = () => {
  try {
    loadProject(JSON.parse($('projectJsonInput').value));
    $('openDialog').close();
  } catch (error) {
    $('openError').textContent =
      error instanceof SyntaxError ? 'The pasted text is not valid JSON.' : error.message;
  }
};
