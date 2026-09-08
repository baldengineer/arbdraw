# Consistent input controls for ArbDraw

Status: implementation plan with the foundation slice applied. The shared field runtime, definitions, styles, filter dialog binding, and inspector, serial, and AWG timing field lifecycles are implemented; remaining controls are listed in the migration phases below.

## Recommendation

Introduce a small field system using plain JavaScript, native form elements, and shared CSS. A field definition describes the control; a factory creates its markup and controller; a feature adapter connects it to ArbDraw's existing document and actions.

Keep the current compact instrument UI and dependency-free, open-from-disk deployment. This work does not require a framework, custom elements, Shadow DOM, a build step, or a general-purpose form engine. Use readable JavaScript objects with JSDoc types so routine edits have autocomplete and documentation without adding a compiler.

The key separation is between **editing a value** and **applying a change to the waveform**. A shared control should understand text, units, focus, validation feedback, and commit/cancel. It should not know how to generate serial samples, resize a buffer, or refresh an oscilloscope.

## What the current implementation shows

This review covers the current HTML, CSS, JavaScript, existing test structure, and checked-in screenshot. The screenshot predates some current controls; runtime browser interaction has not been tested for this planning change.

| Area | Current implementation | Consequence |
| --- | --- | --- |
| Shared appearance | `includes/styles.css` has `.unit-input`, then separate status, scope, filter, filename, bridge, and select styles. Focus treatments include both theme focus rings and orange borders. | A useful starting point exists, but new controls need contextual styling knowledge. Earlier scope/status size rules also compete with the later `.unit-input` rule. |
| Numeric editing | `js/properties.js` has inspector-wide blur/Enter listeners, special per-field handlers, and a separate timing commit loop. | Input behavior depends on location and selector membership. Serial inputs also inherit inspector listeners. |
| Live edits | `js/serial-properties.js` commits payload and post-idle on `input`, other fields on `change`. `js/scope-view.js` updates on both `input` and `change`, and may rewrite invalid drafts immediately. | Similar-looking fields have different editing and undo experiences. Intermediate text can be normalized before typing is complete. |
| Units | `js/properties.js` repeats unit scales, display functions, menus, and suffix key maps; the scope has additional versions. | Voltage/frequency menus reinterpret the displayed number; sample rate/count and transition-time menus preserve the quantity. |
| Validation | `propertiesValid()` uses numeric coercion, so an empty string can become zero. Several other handlers clamp, round, restore, or simply return. | Invalid input has no consistent explanation. A single unrelated invalid inspector value can block a change. |
| Defaults | `propertyDefaultMap` and custom context-menu handlers cover only selected inspector inputs. `DEFAULT_VALUES` incorporates configured defaults, saved settings, and URL overrides. | “Default” can mean startup state rather than the configured fallback. Serial, timing, and dialog controls differ. |
| State and side effects | Render functions write input values directly; some persistence reads unit button text. `generate()` records history by default and persists settings. | A new shared listener can accidentally overwrite a draft, create duplicate undo entries, or persist a preview. |

Specific integration points: `properties.js` functions `applyProperties`, `commitTimingInput`, `selectTimingUnit`, and `persistCurrentSettings`; `scope-view.js` control listeners; `serial-properties.js` function `commitSerialProperties`; `project.js` function `renderDocument`; and `waveform-editor.js` functions `generate` and `pushHistory`.

## Proposed interaction contract

Consistency means that the same action has a predictable meaning. Controls may explicitly opt into preview or form submission when the task requires it.

| Capability | Default behavior |
| --- | --- |
| Typing | Keep a local draft. Permit temporary empty or incomplete text without changing the committed model. Do not reformat the active draft on every keystroke. |
| Commit | Enter or leaving the complete field commits a valid, changed value once. Tab keeps normal focus navigation. Enter followed by blur must not commit twice. |
| Cancel | Escape restores the last committed value and any linked preview. It creates no history entry or persistence write. If a field popup is open, the first Escape closes that popup. |
| Invalid input | Keep the draft and show a short field-level message on a commit attempt. Set `aria-invalid` and associate the error using `aria-describedby`. Keep the model unchanged and allow focus to leave. Empty numeric input is invalid unless explicitly optional. |
| Stepping | Arrow keys/native steppers use a declared step. The definition specifies whether that step is in display units or canonical units. For counts, enforce integers after unit conversion. |
| Wheel | Default off, allowing normal panel scrolling. Explicitly enabled numeric fields step only while focused. Batch a wheel gesture into one committed action. |
| Unit menu | Preserve the physical quantity: `1 V` becomes `1000 mV`. A valid draft is converted without a premature waveform commit; an invalid draft must be resolved or cancelled before unit conversion. |
| Unit shortcut | Preserve the existing instrument-style entry affordance: typing `5` then `m` can mean `5 mV`. Apply the shortcut to the draft; use the normal commit path afterward. Expose shortcuts in field help. |
| Reset | Offer a keyboard-accessible field action when a reset provider exists. Restore the normalized configured default, constrained by the current profile, through the same commit path. Keep the selected display unit. |
| Read-only | Show the same field family with a distinct calculated state. Keep values selectable/copyable; omit editing, reset, and step actions. |
| Disabled | Disable the input and all field actions together. Provide a reason in associated help text when useful. |
| Live preview | Explicit opt-in for sliders and viewer controls. Preview valid drafts without history or persistence; commit once at the end, and restore on cancel. |
| Dialog fields | Edit a form draft. Apply/Save commits the form after validation; Cancel discards it. Multiline fields retain Enter for newlines. A field must never implicitly send an instrument command. |
| Search | Update search results on input; do not apply waveform commit/history semantics. |

Moving focus from a numeric input into its unit selector or reset action stays within the same editing session. Treat owned popups as part of that field even if they are rendered elsewhere in the DOM. This prevents the existing blur-before-unit-selection ordering from producing two changes.

Use case-sensitive SI prefixes where necessary (`mHz` versus `MHz`), accept documented aliases such as `u` for micro, and preserve Ctrl/Cmd editing shortcuts and IME composition. Full pasted engineering expressions such as `2.5 kHz` can be a later extension; the first release can retain native number inputs and existing suffix shortcuts. Do not introduce a custom numeric text parser without a demonstrated need.

Menu-preserves-value, reset-to-configured-default, invalid-input feedback, and focused-only wheel behavior are intentional UX changes. Characterize the existing behavior first, then introduce these changes explicitly with regression coverage. If preserving an old behavior temporarily is necessary, declare it on that field rather than adding ID-based branches to the controller.

## Structure and ownership

### 1. Shared definitions and policies

Proposed files:

- `js/fields/units.js`: unit families, labels, aliases, conversion, and formatting helpers. Keep this independent of the DOM so defaults/import normalization can reuse it where appropriate.
- `js/fields/definitions.js`: shared behavior presets and named field definitions, grouped by feature. Split into feature files only when that improves navigation.
- `js/fields/control.js`: control factory, draft lifecycle, validation feedback, unit actions, stepping, focus, and cleanup.
- `includes/fields.css`: shared field styles and named size/layout variants.
- `docs/input-controls.md`: contributor guide, behavior contract, and examples created during implementation.

Feature bindings remain beside the relevant feature, initially in `properties.js`, `serial-properties.js`, `scope-view.js`, `filters.js`, and `project.js`.

A definition should contain identity, label/help, kind, unit family, formatting, constraints, step, behavior preset, optional reset capability, and visibility/availability metadata. Use named policies and simple values for common cases. Dynamic profile constraints and feature calculations belong in binding functions, not a string expression language or an accumulating list of arbitrary callbacks.

Use a small family of kinds: number, text, select, textarea, and range, with checkbox/toggle styling sharing the same label/help/error shell. Calculated values are a read-only mode. VISA resource lookup remains a composed feature control using the shared text/action shell; its discovery and filtering do not belong in the general field controller.

### 2. Factory and controller

Proposed API, illustrative rather than implemented:

```js
const frequencyDefinition = {
  id: 'frequencyInput',
  kind: 'number',
  label: 'Frequency',
  unitFamily: 'frequency',
  canonicalUnit: 'Hz',
  behavior: 'commitOnExit',
  constraints: { min: 1e-6 },
  step: { value: 1, basis: 'display' },
  precision: { significantDigits: 10 },
  reset: true,
};

const frequencyControl = Fields.create(frequencyDefinition, {
  read: () => state.frequency,
  commit: (hertz, edit) => waveformActions.setFrequency(hertz, edit),
  resetValue: () => configuredDefaults.frequencyHz,
  readUnit: () => displayPreferences.frequencyUnit,
  writeUnit: unit => { displayPreferences.frequencyUnit = unit; },
});

frequencyHost.append(frequencyControl.element);
frequencyControl.refresh();
```

`Fields.create()` generates a consistent label, input shell, optional unit/actions, help, and error markup. Return `element`, `refresh`, `commit`, `cancel`, `focus`, and `destroy`. An internal attachment path may temporarily support existing markup during migration; it must use the same controller and must not become a second permanent control system.

The commit adapter returns the accepted canonical value or a validation error. Programmatic refresh does not dispatch input/change events or call commit. Normal refresh preserves an active draft; document load, undo, or profile changes explicitly cancel or revalidate drafts according to their effect. Dispose listeners and popup ownership when a control is replaced.

Create elements with DOM APIs and assign user-provided text using `textContent`/`value`. Retain stable existing input IDs during migration. Replace the relevant HTML control with a host or progressively attach to it; do not retain duplicate editable fields.

### 3. Domain adapters and transactions

Field controllers own only draft and presentation state. `projectDocument` remains the persistent source of truth, and the existing `state` accessors remain usable. Display unit preferences are separate from physical values; stop reading button text as application data.

Use volts, seconds, hertz, and points at the field boundary. Preserve existing project/URL/storage formats. Adapters translate sample rate to/from existing `sampleRateMSa` and scope time to/from milliseconds. This avoids making a storage migration a prerequisite for consistent inputs.

Feature actions own coupled calculations and effects:

- Frequency/period update one canonical frequency and render both controls.
- High/low/amplitude/offset update a coherent voltage group in one transaction.
- Samples/rate/resolution enforce profile limits and existing timing formulas together.
- Serial edits normalize settings and adjust the waveform period to fit the payload.
- Scope time keeps its existing 1-2-5 stepping/normalization as an explicit feature policy.

Make shared domain validation authoritative for both UI commits and programmatic inputs where those rules already overlap. HTML min/max/step provide UI hints; they are not the only validation. Avoid introducing a conflicting second source of domain limits into field definitions.

One accepted document edit should produce one undoable transaction. Presentation-only changes produce none. Before enabling preview, account for `generate(type, false)` still persisting settings today: separate generation/rendering from final persistence, or add an explicit preview path. Restoring a cancelled random-noise preview requires the original sample snapshot, not regenerating different random samples.

Current history snapshots only the waveform. When editing AWG fields that also affect `projectDocument.AWG`, ensure undo restores or recomputes consistent AWG metadata. Do not silently expand this task into undo for all application preferences or instrument actions.

## Visual system

Extract the existing visual language into readable, scoped CSS. Define field tokens for height, padding, radius, border, value font, unit width, focus ring, invalid state, and disabled state. Reuse `--field`, `--ink`, `--line`, `--focus`, and theme variables rather than adding fixed colors.

Support explicit compact and regular densities, plus inline/stacked label layouts. Inspector and toolbars can remain compact; dialogs can be larger. Containers own available width; the field should fill it with `min-width: 0`. Unit labels should stay on one line and leave a usable value area. Numeric values can use monospace/tabular numerals while prose uses the application font.

Use one focus treatment across inputs, selects, textareas, and action buttons. Distinguish error, disabled, and calculated states without relying only on opacity or color. Associate visible labels explicitly using `for`/`id`, and label unit selectors separately. Prefer native selects for ordinary unit choices; use a single accessible popup implementation only where custom actions/presentation require it. Preserve keyboard operation, focus return, viewport placement, and dialog containment.

## Implementation sequence

| Phase | Deliverable | Completion check |
| --- | --- | --- |
| 1. Inventory and contract | Record each current field's type, units, constraints, commit mode, reset source, dependencies, persistence, and history effects. Add targeted characterization tests for linked quantities, unit conversion, and timing. | Current behaviors and planned intentional changes are distinguishable. Mixed storage units and profile limits have fixtures. |
| 2. Foundation and pilot | Implement unit helpers, shared CSS, number/text/select controllers, and definition validation. Pilot symmetry, phase, and a filter dialog value to exercise numeric, fixed-suffix, and explicit-submit modes. | Pilot controls share styling and commit/cancel/error semantics in dark, light, and contrast themes; direct file opening still works. |
| 3. Linked numeric fields | Extract feature actions and migrate voltage/frequency groups, transition times, then AWG timing. Route model refresh through controllers. | One logical edit produces one correct state update; no duplicate legacy listeners remain; unit menus and shortcuts follow the documented contract. |
| 4. Remaining controls | Migrate serial fields, viewer fields, range/toggles, project name, dialogs, and shared bridge input styling. Add the explicit live-preview path before migrating live controls. | Typing intermediate text is safe; cancellation restores previews; form submission and instrument actions remain explicit. |
| 5. Consolidation and guide | Remove superseded maps, input CSS, selector-wide listeners, and unit-popup dismissal lists. Add the contributor guide and a small development-only field gallery. | Adding a conventional field needs a definition, host, and feature binding, with no new CSS or custom keyboard/menu handlers. |

Keep each phase reviewable and the app working between migrations. Do not carry both old and new event handlers on a migrated field. Pure unit helpers must load before their consumers; the DOM factory must load before feature bindings. Retain ordered classic scripts and follow the existing browser-global/CommonJS export pattern for testable helpers.

## Verification and acceptance

Use the existing Node test approach for pure conversion, parsing, constraint, and transaction logic. Add focused browser-level interaction coverage for event ordering; DOM stubs alone cannot establish that blur, menus, native number editing, and keyboard handling work correctly. Browser test tooling may be development-only; runtime stays dependency-free.

Priority cases:

- Enter followed by blur commits once; Escape followed by blur commits nothing.
- Empty text, a temporary minus sign, incomplete exponent, nonfinite values, and out-of-range values never silently replace committed data.
- `1 V` to `mV` displays `1000`; suffix entry can still turn `5` into `5 mV`; `mHz` and `MHz` remain distinct.
- Moving from an input into its unit control does not commit using the old unit first.
- `1 Kpts` is 1000 integer points; dynamic sample limits apply in canonical points across unit changes.
- Frequency/period and voltage groups remain coherent after edit, cancel, reset, import, and undo.
- Wheel scrolling over unfocused controls does not change values; a preview gesture produces at most one history entry and no intermediate persistence.
- Reset uses configured defaults, including current profile constraints, independently of saved startup values and URL overrides.
- Dialog Cancel leaves the model unchanged; typing a bridge address never initiates instrument transmission.
- Keyboard navigation, labels, error announcements, copyable calculated values, all three themes, narrow layouts, and both local-file and served loading are checked.

Run the existing JavaScript suite after runtime changes, especially profile, serial, waveform, and export tests. This documentation-only planning change does not require running application tests.

The implementation is complete when every ordinary input belongs to this shared family, intentional behavioral differences are declared, and a new field can be added without reproducing event handling, unit conversion, validation feedback, or styling.
