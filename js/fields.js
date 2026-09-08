// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// Shared input definitions and lifecycle helpers.

(function exposeFields(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ARBDRAW_FIELDS = api;
})(typeof globalThis === 'object' ? globalThis : this, function createFields() {
  if (typeof document !== 'undefined') {
    // Unit menus belong to the active field. Keeping focus on the value until
    // the menu action runs prevents a blur commit using the previous unit.
    document.addEventListener(
      'mousedown',
      (event) => {
        if (event.target.closest?.('.unit-button, .unit-menu')) event.preventDefault();
      },
      true,
    );
    document.addEventListener(
      'focusout',
      (event) => formatInput(event.target),
      true,
    );
  }

  const unitFamilies = {
    voltage: { V: 1, mV: 1e-3, µV: 1e-6 },
    amplitude: { Vpp: 1, mVpp: 1e-3, µVpp: 1e-6 },
    frequency: { mHz: 1e-3, Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 },
    period: { Ms: 1e6, s: 1, ms: 1e-3, µs: 1e-6, ns: 1e-9 },
    time: { s: 1, ms: 1e-3, µs: 1e-6, ns: 1e-9, ps: 1e-12 },
    sampleRate: { 'Sa/s': 1e-6, 'kSa/s': 1e-3, 'MSa/s': 1, 'GSa/s': 1e3, 'pts/s': 1e-6, 'Kpts/s': 1e-3, 'Mpts/s': 1 },
    sampleCount: { pts: 1, Kpts: 1e3, Mpts: 1e6 },
    scopeVoltage: { 'V/div': 1, 'mV/div': 1e-3 },
    scopePosition: { V: 1, mV: 1e-3 },
    scopeTime: { 's/div': 1000, 'ms/div': 1, 'µs/div': 1e-3, 'ns/div': 1e-6, 'ps/div': 1e-9 },
  };

  const defaultDecimalPlaces = Number.isInteger(Number(globalThis.ARBDRAW_DEFAULTS?.inputDecimalPlaces))
    ? Math.max(0, Number(globalThis.ARBDRAW_DEFAULTS.inputDecimalPlaces))
    : 4;

  function truncateNumber(value, decimalPlaces = defaultDecimalPlaces) {
    const number = Number(value), places = Math.max(0, Math.floor(Number(decimalPlaces)));
    if (!Number.isFinite(number) || !Number.isFinite(places) || places > 20) return number;
    const factor = 10 ** places;
    return Math.trunc(number * factor) / factor;
  }

  function formatNumber(value, decimalPlaces = defaultDecimalPlaces) {
    const number = truncateNumber(value, decimalPlaces);
    return Number.isFinite(number) ? String(number) : '';
  }

  function formatInput(input, decimalPlaces) {
    if (!input || input.type !== 'number' || input.closest?.('#samplesView, .samples-view')) return;
    if (input.ownerDocument?.activeElement === input) return;
    const value = Number(input.value);
    if (Number.isFinite(value)) input.value = formatNumber(value, decimalPlaces ?? input.dataset.decimalPlaces);
  }

  function formatInputs(root = typeof document === 'undefined' ? null : document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('input[type="number"]').forEach((input) => formatInput(input));
  }

  function units(family) {
    return { ...(unitFamilies[family] || {}) };
  }

  function convert(value, from, to, family) {
    const scales = unitFamilies[family];
    if (!scales || !Object.hasOwn(scales, from) || !Object.hasOwn(scales, to))
      throw new RangeError(`Unknown ${family || 'unit'} conversion: ${from} to ${to}`);
    return (Number(value) * scales[from]) / scales[to];
  }

  function validNumber(value, constraints = {}) {
    const number = Number(value);
    if (value === '' || !Number.isFinite(number)) return { valid: false, message: 'Enter a number.' };
    if (Number.isFinite(constraints.min) && number < constraints.min)
      return { valid: false, message: `Use a value of at least ${constraints.min}.` };
    if (Number.isFinite(constraints.max) && number > constraints.max)
      return { valid: false, message: `Use a value of at most ${constraints.max}.` };
    if (constraints.integer && !Number.isInteger(number))
      return { valid: false, message: 'Use a whole number.' };
    if (typeof constraints.validate === 'function') return constraints.validate(number);
    return { valid: true, value: number };
  }

  function makeErrorElement(input, definition) {
    const doc = input.ownerDocument;
    if (!doc) return null;
    let error = doc.getElementById(`${input.id || definition.id}-error`);
    if (!error) {
      error = doc.createElement('div');
      error.id = `${input.id || definition.id}-error`;
      error.className = 'field-error';
      error.setAttribute('role', 'alert');
      const anchor = input.closest('.unit-input, .filter-value-input') || input;
      anchor.insertAdjacentElement('afterend', error);
    }
    const describedBy = new Set((input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    describedBy.add(error.id);
    input.setAttribute('aria-describedby', [...describedBy].join(' '));
    return error;
  }

  function applyDefinition(input, definition = {}) {
    if (!input) return input;
    input.dataset.field = definition.id || input.id || '';
    input.dataset.fieldKind = definition.kind || input.type || 'text';
    if (definition.kind === 'number')
      input.dataset.decimalPlaces = String(definition.decimalPlaces ?? defaultDecimalPlaces);
    if (definition.label && !input.getAttribute('aria-label')) input.setAttribute('aria-label', definition.label);
    const title = definition.title ?? definition.tooltip;
    if (title) input.title = title;
    return input;
  }

  function attach(input, definition = {}, adapter = {}) {
    if (!input) throw new TypeError('Fields.attach requires an input element.');
    const config = {
      kind: 'text',
      behavior: 'commitOnExit',
      constraints: {},
      ...definition,
    };
    const error = makeErrorElement(input, config);
    const committed = { value: input.type === 'checkbox' ? input.checked : input.value };
    let composing = false;
    let disposed = false;
    let skipBlurCommit = false;

    applyDefinition(input, config);

    function setError(message = '') {
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      input.classList.toggle('field-invalid', Boolean(message));
      if (error) {
        error.textContent = message;
        error.hidden = !message;
      }
      return !message;
    }

    function parse() {
      if (config.kind === 'checkbox') return { valid: true, value: input.checked };
      if (config.kind !== 'number') return { valid: true, value: input.value };
      return validNumber(input.value, config.constraints);
    }

    function commit(reason = 'programmatic') {
      if (disposed) return false;
      const result = parse();
      if (!result.valid) {
        setError(result.message);
        return false;
      }
      const next = typeof config.normalize === 'function' ? config.normalize(result.value, input) : result.value;
      if (typeof adapter.commit === 'function') {
        const accepted = adapter.commit(next, { reason, input, definition: config });
        if (accepted === false) return false;
      }
      if (config.kind === 'number') input.value = formatNumber(next, config.decimalPlaces);
      committed.value = input.type === 'checkbox' ? input.checked : input.value;
      setError('');
      return true;
    }

    function cancel(reason = 'cancel') {
      if (disposed) return;
      if (input.type === 'checkbox') input.checked = Boolean(committed.value);
      else input.value = committed.value;
      setError('');
      adapter.cancel?.({ reason, input, definition: config });
    }

    function refresh(value) {
      if (input.ownerDocument?.activeElement === input && value === undefined) return;
      const next = value === undefined ? adapter.read?.() : value;
      if (next !== undefined && next !== null) {
        if (config.kind === 'checkbox') input.checked = Boolean(next);
        else input.value = config.format
          ? config.format(next)
          : config.kind === 'number'
            ? formatNumber(next, config.decimalPlaces)
            : String(next);
      }
      committed.value = input.type === 'checkbox' ? input.checked : input.value;
      setError('');
    }

    function onInput(event) {
      setError('');
      const draft = parse();
      adapter.preview?.(draft.valid ? draft.value : draft, { event, input, definition: config });
    }
    function onChange() {
      if (config.behavior === 'commitOnChange') commit('change');
    }
    function onBlur() {
      if (skipBlurCommit) {
        skipBlurCommit = false;
        return;
      }
      if (config.behavior === 'commitOnExit') commit('blur');
    }
    function onKeydown(event) {
      if (composing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      } else if (event.key === 'Enter' && config.kind !== 'textarea' && config.behavior !== 'manual') {
        event.preventDefault();
        commit('enter');
        skipBlurCommit = true;
        input.blur();
      }
    }
    function onCompositionStart() { composing = true; }
    function onCompositionEnd() { composing = false; }

    input.addEventListener('input', onInput);
    input.addEventListener('change', onChange);
    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('compositionstart', onCompositionStart);
    input.addEventListener('compositionend', onCompositionEnd);

    return {
      element: input,
      input,
      definition: config,
      refresh,
      commit,
      cancel,
      setError,
      getValue: () => input.value,
      destroy() {
        disposed = true;
        input.removeEventListener('input', onInput);
        input.removeEventListener('change', onChange);
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('keydown', onKeydown);
        input.removeEventListener('compositionstart', onCompositionStart);
        input.removeEventListener('compositionend', onCompositionEnd);
      },
    };
  }

  function create(definition, adapter = {}, options = {}) {
    const doc = options.document || document;
    const host = doc.createElement('label');
    host.className = `field ${definition.layout || 'field-inline'}`;
    host.dataset.fieldId = definition.id || '';
    if (definition.label) {
      const label = doc.createElement('span');
      label.className = 'field-label';
      label.textContent = definition.label;
      host.append(label);
    }
    const input = doc.createElement(definition.kind === 'textarea' ? 'textarea' : definition.kind === 'select' ? 'select' : 'input');
    input.id = definition.id || '';
    input.type = definition.kind === 'number' ? 'number' : definition.kind === 'range' ? 'range' : definition.kind === 'checkbox' ? 'checkbox' : 'text';
    input.className = 'field-input';
    if (definition.attributes) Object.entries(definition.attributes).forEach(([key, value]) => input.setAttribute(key, value));
    if (definition.options) definition.options.forEach(option => input.add(new Option(option.label ?? option, option.value ?? option)));
    host.append(input);
    if (definition.unit) {
      const unit = doc.createElement('span');
      unit.className = 'field-unit';
      unit.textContent = definition.unit;
      host.append(unit);
    }
    const control = attach(input, definition, adapter);
    control.host = host;
    return control;
  }

  return {
    unitFamilies,
    units,
    convert,
    validNumber,
    truncateNumber,
    formatNumber,
    formatInput,
    formatInputs,
    applyDefinition,
    attach,
    create,
  };
});
