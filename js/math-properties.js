// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Expression drafts are applied explicitly, so typing never replaces samples.
(function setupMathProperties() {
  const input = $('mathExpressionInput'), error = $('mathExpressionError'), preset = $('mathPreset');
  for (const item of ARBDRAW_MATH.presets) preset.add(new Option(item.name, item.expression));
  function setError(message = '') {
    error.textContent = message;
    input.setAttribute('aria-invalid', String(Boolean(message)));
  }
  function render(type = state.type) {
    $('mathProperties').hidden = type !== 'math';
    input.value = state.mathExpression;
    preset.value = ARBDRAW_MATH.presets.some(item => item.expression === state.mathExpression)
      ? state.mathExpression : '';
    setError();
  }
  function apply() {
    if ($('mathProperties').hidden || globalThis.ARBDRAW_SEQUENCE?.isOverview()) return false;
    const expression = input.value.trim();
    try {
      mathGenerationSamples({ mathExpression: expression });
    } catch (problem) {
      setError(problem.message);
      return false;
    }
    if (!confirmWaveformReplacement()) return false;
    state.mathExpression = expression;
    generate('math', true, true, true, false);
    renderWaveformProperties('math');
    refreshScopeVertical();
    return true;
  }
  preset.addEventListener('change', () => {
    if (preset.value) input.value = preset.value;
    setError();
  });
  input.addEventListener('input', () => { preset.value = ''; setError(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      apply();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      render();
    }
  });
  $('applyMathExpression').addEventListener('click', apply);
  function edit() {
    render('math');
    setError('Math could not be generated. Edit and apply the expression; the previous waveform is unchanged.');
  }
  globalThis.ARBDRAW_MATH_PROPERTIES = { render, apply, edit };
})();
