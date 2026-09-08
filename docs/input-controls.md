# ArbDraw field controls

ArbDraw fields have three layers:

1. `js/field-definitions.js` contains editable, named defaults for labels, kinds, and constraints.
2. `js/fields.js` owns the draft lifecycle, validation state, keyboard handling, and canonical unit conversion.
3. Feature files own model reads, coupled values, rendering, persistence, and undo.

Numeric inputs use `ARBDRAW_DEFAULTS.inputDecimalPlaces` from `js/defaults.js`, which defaults to `4`. A field definition can override it with `decimalPlaces`. Values are truncated when they are committed or leave focus; intermediate drafts remain editable. Inputs inside the Samples view are excluded so sample data keeps its existing precision.

Use `ARBDRAW_FIELDS.attach(existingInput, definition, adapter)` when migrating existing markup. Use `ARBDRAW_FIELDS.create(definition, adapter)` when a feature owns the markup. The adapter should accept canonical values and return `false` when a commit is rejected.

```js
const control = ARBDRAW_FIELDS.attach(input, {
  id: 'cutoffInput',
  kind: 'number',
  behavior: 'commitOnExit',
  constraints: { min: 0.000001 },
}, {
  commit: value => setCutoff(value),
});
```

`commitOnExit` commits on Enter or blur. `commitOnChange` commits on the native change event. `manual` is for dialog fields whose Apply button calls `control.commit('dialog')`. Escape restores the last committed draft. Use `control.refresh(value)` after importing, undoing, or changing the owning document.

Values crossing the field boundary should use canonical units. For example:

```js
ARBDRAW_FIELDS.convert(1, 'V', 'mV', 'voltage'); // 1000
```

Unit labels and display preferences belong to the feature adapter. Do not read a unit button's text as persistent application data when a canonical value is available. Keep coupled updates in one feature action so one accepted edit creates one undo entry.

Avoid adding selector-wide keyboard or blur listeners for migrated fields. If a control needs preview, use the adapter's `preview` callback and add an explicit final commit path. Preview must not persist settings or create history entries until it is accepted.
