# ArbDraw code review and repair plan

Reviewed: 2026-11-01. Source revision: `e570ae129cfad40b665a791a8b803d302095637f`.
Review branch: `codex/full-code-review-plan`.
Fork worktree: `C:/Users/balde/.codex/worktrees/0e45/ArbDraw`.

## Implementation status — 2026-11-01

All nine findings below have been implemented on `codex/full-code-review-plan`, with one commit per finding. The original findings and source line ranges are retained as historical review evidence; they are not line ranges in the repaired source.

| Finding | Commit | Implemented repair |
| --- | --- | --- |
| H1 | `9a295ca` | Admission before API dispatch; exact trusted origins; JSON-only command bodies; no opaque-origin access; Origin-less REST clients require an environment-configured token. The local UI uses `--serve-app`; browser error messages and setup instructions explain the change. |
| M1 | `738b2c3` | Predict the clamped segment count before confirmation; couple frequency/cycles updates; preserve selection-scoped generation only for compatible counts; prevent destructive live previews; one history step per preview transaction. |
| M2 | `b0a7410` | Refresh Samples through document rendering, invalidate queued chunks, update readonly state, and reject stale/noninteger/out-of-bounds indices. |
| M4 | `2e4e3d1` | Reject unknown sequence profiles atomically, resolve legacy IDs, and validate against the same profile restored by import. |
| M3 | `4b502b5` | Store timing quantities in display units with schema version 1; migrate old canonical settings once; unify count-unit aliases; bound startup and unrestricted timing allocations. |
| M6 | `73d481e` | Keep deadlines active through response-body consumption and map abort/transport failures consistently. |
| M5 | `6d33dd1` | Cache aggregate samples using data/metadata revisions, invalidate in-place edits, cache card previews, and batch segment generation before rendering. |
| L2 | `b381f89` | Share pure segment summaries and waveform/output projection between import, runtime and export. |
| L1 | `1af7c05` | Update sequence help for shape selection, inherited settings, regeneration warnings, fixed totals, remainder distribution, and corrected timing examples. |

### Final verification

- Full JavaScript suite: `node --test tests/*.test.js` — **174 passed, 0 failed**.
- Full Python suite: `python -m unittest discover -s tests -p 'test_*.py'` — **33 passed, 0 failed**. Full suites ran outside sandbox process/temporary-directory restrictions.
- Added regression coverage in `tests/test_python_bridge.py`, `tests/sequence.test.js`, `tests/settings-persistence.test.js`, `tests/bridge-client.test.js`, and `tests/keyboard-shortcuts-help.test.js`. Existing waveform-warning assertions were updated for the proposed-range guard.
- Security tests use fake VISA/adapter backends for query, IDN and send routes. Rejected origins, opaque origins, missing/invalid tokens, and non-JSON POSTs produce no backend calls. Approved browser origins, token-authenticated Origin-less clients, and preflights are covered.
- Sequence tests cover canceled/accepted timing replacements, previews, clamping/rounding, history isolation, real Samples rendering across Undo/Redo, stale indices, pending chunks, profile import, cache invalidation, unchanged neighboring segments, and full/segment output behavior.
- Local one-million-point probe: initial aggregation **32.91 ms**; **1,000 unchanged reads in 9.34 ms**, reusing the same sample array. This is a local measurement, not a CI threshold or a frame-rate claim.
- Browser verification used the worktree served explicitly on `127.0.0.1:19287`: shape menu and segment cards; the 2,000-point example becoming two 1,000-point segments at 2 kHz with the full record still 1 ms; Samples **8 → 16 → 8** across menu Undo/Redo; selected-segment export dialog reporting 8 points; corrected help layout/encoding; and a one-million-point sequence with zoom/pan/full-record navigation. No console errors were reported during those checks.
- Confirmation cancellation and exact history preservation are covered by automated application-function tests. Native browser confirmation cancel/accept behavior was not independently verified. No real instrument operations, native tray/menu-bar interaction, or screen-reader audit was performed.

### Compatibility and follow-up

Direct `file://` instrument control is intentionally replaced by the existing loopback `--serve-app` workflow. Other local servers require an exact `--allow-origin` including their port. Origin-less REST clients set `ARBDRAW_BRIDGE_TOKEN` in the bridge environment and send the same value in `X-ArbDraw-Token`; health and direct one-shot CLI operations remain available without it. This is a browser-origin boundary, not authentication against non-browser clients that forge an approved Origin, so the default loopback binding remains important.

The finite application ceiling is 1,000,000 samples, including Other and URL/default startup values; smaller profile limits still apply. Direct in-place sequence sample writers must finish with `state.samplesEdited = true` (as pencil/table writers do), or explicitly invalidate sequence data. Undo snapshots retain independent arrays.

The remaining work is verification on real instruments and native application surfaces, plus the browser confirmation interaction noted above; no reviewed code repair is intentionally deferred.

## Scope and result

The source checkout was clean on `main`. With no PR or comparison revision supplied, this review uses `8eab7e1..e570ae1`: the complete sequence feature, export-scope menu, redistribution/overwrite warning, waveshape picker, and close-button changes. All 24 changed files were reviewed, together with the first-party code they depend on. Existing issues found in those dependencies are explicitly distinguished from regressions. The review covers correctness, boundary cases, unsafe inputs, dependent behavior, performance, and opportunities to combine duplicate functions.

Result: **1 High, 6 Medium, and 2 Low findings**. Fix H1 before treating the local bridge's origin policy as a security boundary. Fix M1-M4 before relying on sequence editing and persistence for important work. L2 is a refactoring opportunity, not an independently reproduced malfunction.

Only this plan was changed by the original review commit. The implementation commits listed above subsequently repaired the findings. No dependency upgrades, uploads, instrument operations, or releases were performed.

All line ranges below refer to the reviewed source revision, not to this document. Paths are absolute paths in the review fork; the suffix after `ArbDraw/` is the repository-relative path for another checkout.

## Evidence and coverage

- `node --test tests/*.test.js`: **156 passed, 0 failed**.
- `python -m unittest discover -s tests -p 'test_*.py'`: **32 passed, 0 failed** after rerunning outside the filesystem sandbox. The initial run had two temporary-directory permission errors, not application failures.
- Additional Node probes reused the harness from `tests/sequence.test.js` and loaded the actual affected functions. They reproduced selection overwrite, stale table/history behavior, settings scaling, unknown-profile import, repeated buffer allocation, and response-body timeout behavior. These were transient diagnostic probes, not added regression tests.
- A temporary HTTP server using an injected fake VISA backend confirmed unauthorized-origin dispatch. No real VISA backend or instrument was used.
- Review coverage: document/state mapping; segment add/remove/select; property and serial editing; waveform generation and filters; undo/redo; editor, Samples, JSON and Viewer views; save/CSV/SVG/WAV exports; browser playback; bridge client/server; profile restoration; menu/CSS/help changes. Release-builder and desktop-controller boundaries were inspected as adjacent infrastructure; their existing tests passed.
- Limits: no interactive browser or screen-reader verification, native tray/menu-bar execution, actual hardware upload, or independent audit of external adapter repositories. Passing unit tests do not certify those paths.

## High

### H1 — Reject unauthorized requests before dispatching instrument commands

**Classification:** Existing security defect in a dependent module; not introduced by the sequence commits.

**Locations:**

- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/python_bridge/server.py`, lines **345-350**: dispatch occurs without an authorization/origin check.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/python_bridge/server.py`, lines **360-375**: JSON is accepted regardless of request Content-Type.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/python_bridge/server.py`, lines **387-399**: CORS only controls response headers and unconditionally trusts `Origin: null`.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/python_bridge/server.py`, lines **193-208**: the accepted payload reaches the arbitrary VISA query endpoint.

**Problem and impact:** A disallowed origin does not stop server-side execution. A POST containing JSON but labeled `text/plain` reaches `BridgeService.dispatch`; omitting `Access-Control-Allow-Origin` afterwards only prevents a browser from exposing the response. Because instrument commands can have side effects, a caller does not need to read that response. The `null` origin allowance also cannot distinguish the intended local file UI from an untrusted opaque-origin document. Browser local-network protections vary; the confirmed finding is the missing server-side boundary, not a claim that every browser permits every attack route.

**Reproduction:** Start `create_server('127.0.0.1', 0, BridgeService(fake_visa))` and POST `{"resource":"FAKE::INSTR","command":"*IDN?"}` to `/api/v1/visa/query` with `Origin: https://untrusted.example` and `Content-Type: text/plain`. Observed HTTP **200**, no allow-origin response header, and **one fake backend call**. Repeating with `Origin: null` and JSON Content-Type returned **200** and `Access-Control-Allow-Origin: null`.

The browser premise is defined by the [Fetch Standard's CORS-safelisted request-header rules](https://fetch.spec.whatwg.org/#cors-safelisted-request-header): `text/plain` is a safelisted MIME type. CORS response permission is not authorization for the command itself.

**Repair instructions:**

1. Add one request-admission function before reading/dispatching POST bodies. Reject a present, untrusted Origin with 403; require `application/json` for JSON command endpoints and reject simple form/text bodies with 415.
2. Use the same exact-origin policy for preflight and actual requests. Do not solve this only by changing response headers.
3. Remove implicit trust in opaque `null` origins. Preserve the supported file UI through an explicit pairing/capability credential, or provide the UI from a trusted loopback origin. If adding pairing, carry the credential in a request header and update the browser client and bridge setup instructions together.
4. Define intentional behavior for Origin-less CLI clients; ensure the resulting policy cannot be bypassed by simply omitting Origin from an unauthenticated network request. Keep loopback binding as the default.

**Acceptance tests:** Using only fake backends, rejected origins, `null` without the required capability, invalid credentials, and `text/plain` requests must produce zero backend/adapter calls. Approved hosted/local UI and intentional CLI paths must work. Test `/visa/query`, `/visa/idn`, and `/waveforms/send`, including preflight, not only `/health` response headers.

## Medium

### M1 — Determine the new generation range before deciding whether to warn

**Classification:** New sequence correctness/data-loss regression.

**Locations:**

- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/properties.js`, lines **561-588**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/sequence.js`, lines **37-46**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/waveform-editor.js`, lines **129-138** and **164-170**.

**Problem and reproduction:** The overwrite guard examines the current sample count and sees a valid selection, so it decides no warning is necessary. `syncInputs()` then changes frequency/cycles, whose new sequence setter changes the sample count. `generate()` sees the old array length no longer equals the new count and regenerates the entire segment, with its own confirmation explicitly disabled. With a 16-point, 1 kHz source split into two 8-point segments, set the selected segment's sample 0 to 123 V, mark samples edited, select indices 2-4, and change source frequency from 2 kHz to 1 kHz. The guard returned false; generation expanded to 16 points and changed sample 0 from **123 to 0** without warning. Live preview can take this path too.

**Repair instructions:** Compute proposed frequency/cycles/sample-count changes without mutating the document. If the resulting count differs, treat generation as full-segment replacement and use `confirmWaveformReplacement(false)` before any destructive mutation. Do not apply destructive live preview before confirmation. Preserve selection-scoped behavior when count and buffer length remain compatible. Commit coupled fields and generation as one transaction and one undo step.

**Acceptance tests:** Exercise actual `applyProperties` for frequency, period and cycle edits with edited samples outside a selection. Cancel must preserve samples, metadata, selection, history and redo; accept must produce one undoable full replacement. Include clamping to remaining capacity and changes that round to the existing count. Verify previews cannot silently erase the outside sample.

### M2 — Refresh visible sample rows when restoring history, and reject stale indices

**Classification:** Existing restoration gap exposed by new sequence history transitions.

**Locations:**

- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/waveform-editor.js`, lines **296-311** and **1078-1090**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/views.js`, lines **10-34** and **207-224**.

**Problem and reachable reproduction:** `restoreWaveform()` renders properties/editor but does not rebuild the Samples table or cancel its queued render. Start with 16 points, add two 8-point segments, and open Samples with a segment selected. Undo using the Edit menu: the document returns to 16 points but the table still has 8. Switch away and back to rebuild 16 rows; redo the sequence creation: the selected segment is 8 points, but the table remains 16 editable rows. Editing stale index 12 sets `state.data[12]` without a bounds check. The diagnostic produced **declared count 8, array length 13**, with four holes serialized as null. This invalid document can then be saved or sent downstream. Segment remove buttons themselves are in the Editor view; the demonstrated cross-view trigger is Undo/Redo.

**Repair instructions:** Centralize document-restoration refresh so Undo/Redo and project replacement invalidate pending Samples chunks and render the current target if Samples is visible. Refresh its readonly state as well. Independently require an integer index within both the declared sample count and current array length in `updateSampleVoltage`; stale DOM must never extend a buffer. Include generation/selection changes that swap the editing target.

**Acceptance tests:** Reproduce the sequence above with real history and sample-render functions. Rows and displayed values must immediately match the restored target. Attempt stale, negative, fractional, and out-of-range indices and assert no mutation/history change. Test a pending multi-chunk render across restoration and transitions into/out of sequence overview.

### M3 — Make stored numeric values agree with their display-unit contract

**Classification:** Existing dependent persistence defect; can also affect settings saved while editing a segment.

**Locations:**

- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/properties.js`, lines **132-135** and **996-1018**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/core.js`, lines **51-55**, **73-74**, and **107-120**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/app.js`, lines **69-71**.

**Problem and reproduction:** `persistCurrentSettings()` stores canonical sample count and MSa/s alongside the chosen display units. `normalizeDefaults()` interprets those values as display-unit quantities and multiplies again. Saving 1,000 points with `sampleCountUnit: 'Mpts'` reloads as **1,000,000,000 points**; startup calls `generate()` on that count, risking a frozen tab or allocation failure. Saving 0.048 MSa/s with `sampleRateUnit: 'Kpts/s'` reloads as **0.000048 MSa/s**. Separately, `Kpts` is emitted by the UI but the normalizer only recognizes `kpts`.

**Repair instructions:** Choose and document one storage representation. For a minimal compatible change, serialize the sample count and rate in the selected units, just as voltage/frequency already are, so existing normalization converts exactly once. Normalize the `Kpts`/`kpts` aliases through one unit table. Add a settings schema version: when reading unversioned settings produced by the current writer, treat stored sampleCount and sampleRateMSa as canonical, convert them to the chosen display-unit quantities once, and then run normalization. Persist the new version so this migration never repeats. Keep defaults/URL quantities on their documented input-unit contract rather than running them through the stored-settings migration. Bound generated sample allocations before startup using the resolved profile and a finite application limit for unrestricted profiles/URL settings.

**Acceptance tests:** Round-trip points in pts/Kpts/Mpts and sample rates in every menu unit; canonical values must be unchanged. Test old stored settings, defaults and URL overrides separately. Verify selecting a display unit alone and reloading never changes waveform timing or allocates an unexpectedly large array. Inspect proposed counts without allocating billion-point test buffers.

### M4 — Validate an imported sequence against the profile that will actually remain active

**Classification:** New sequence input-validation/profile consistency regression.

**Locations:**

- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/project.js`, lines **164-174**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/properties.js`, lines **88-104**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/sequence.js`, lines **27-29** and **169-170**.

**Problem and reproduction:** `loadProject()` uses a 1,000,000-point fallback when the imported profile ID is unknown. Restoration, however, retains the previously selected profile. It temporarily clamps only the parent count; `syncSequence()` immediately restores the larger sum of segment counts. With RIGOL DG1022 active (4,096 maximum), importing a valid 6,000-point sequence whose profile ID is `missing-profile` succeeds and leaves **6,000 points under a 4,096-point profile**. The profile selector is then disabled. Capacity calculations and upload assumptions are inconsistent.

**Repair instructions:** Resolve the effective profile before replacing `projectDocument`. Reject unknown IDs for sequences with an actionable error, or explicitly choose a documented fallback profile and use that same profile for validation and restoration. Honor known legacy IDs. Validate the segment sum against its finite limit and reject atomically; do not clamp only the aggregate while retaining oversized segments.

**Acceptance tests:** Load 6,000 points with an unknown ID while RIGOL is selected; it must reject without modifying the current document/history/profile, or explicitly select a consistent documented fallback. Test known limited profiles, legacy IDs, Other, and counts at and one above the effective limit. Assert sum of segment counts, top-level count, values length and active capacity agree after rendering.

### M5 — Avoid rebuilding the entire sequence buffer on every read and repaint

**Classification:** New performance regression.

**Locations:**

- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/sequence.js`, lines **23-34**, **99-102**, and **160-161**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/core.js`, lines **411-421**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/waveform-editor.js`, lines **296-304**, **433-435**, and **468-474**.

**Problem and evidence:** Every `recordState()` synchronizes and `flatMap`s every segment, even when nothing changed. A draw does this through both `refreshSequence()` and `drawEditorOverview()`; timing, Viewer and history paths repeat it. Adding a segment also calls full generation/render work once per segment. Ten unchanged reads of a 1,000,000-point record took approximately **312 ms** in the diagnostic and replaced the aggregate array each time. That measurement is local evidence, not a cross-machine performance threshold. Pointer movement and repeated paints incur avoidable main-thread work and allocation pressure.

**Repair instructions:** Introduce explicit revision/dirty tracking for sequence data and metadata. Rebuild aggregate samples only after a mutation, and reuse one synchronized output snapshot throughout a render/export operation. Ensure in-place pencil/table edits, generation, add/remove, import and history restoration invalidate the appropriate cache. Batch redistribution/generation and render once after the complete sequence is consistent. Cache unchanged card previews separately. Preserve independent history snapshots; do not share mutable arrays with undo history as a shortcut.

**Acceptance tests:** Repeated reads and pan/zoom without mutations must not re-concatenate samples. Each mutation must update record output exactly once before consumption, including direct in-place edits. Check unchanged neighboring segments and undo isolation. Add deterministic allocation/call-count assertions and a manual one-million-point interaction benchmark; do not assert a brittle absolute time in CI.

### M6 — Keep bridge request timeouts active while consuming the response body

**Classification:** Existing dependent client reliability defect.

**Locations:**

- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/bridge-client.js`, lines **61-84**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/instruments.js`, lines **220-227** and **292-318**.

**Problem and reproduction:** `fetch()` resolves when headers are available; the timer is cleared before `response.text()`. If a bridge/proxy stalls partway through its body, the request can remain pending indefinitely, keeping actions busy or `keepAlivePending` true. A fake fetch that immediately returns headers but delays body text by 100 ms completed after **112 ms** despite a **20 ms** timeout; its signal was never aborted. Body-read failures also bypass the existing request-error mapping.

**Repair instructions:** Keep fetching and reading the body inside one timeout-protected try/finally. Translate aborts from either phase into the existing `bridge_timeout` error and other transport failures into `bridge_unreachable`. Preserve the separate invalid-JSON and HTTP error reporting. Clear the timer only when all response consumption has settled.

**Acceptance tests:** Use an abort-aware fake response stream that emits headers and stalls. Assert prompt abort/rejection, the correct error code and restored action/keepalive state. Also cover a successful delayed body, malformed JSON and an HTTP error body. No real bridge or instrument is needed.

## Low

### L1 — Update the in-app sequence help to match redistribution and the shape menu

**Classification:** Documentation regression after the latest behavior changes.

**Locations:**

- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/docs/help/sequences.html`, lines **17-21** and **41-41**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/sequence.js`, lines **68-106** (actual behavior to document).

**Problem:** Help says adding immediately copies the existing samples, recommends reducing existing counts to make room, and gives an example where adding doubles total length. The code now opens a shape menu, keeps total points fixed, redistributes them, regenerates all segments, and warns about edited samples. Following the help gives the wrong expectation about retained samples and total duration.

**Repair instructions:** Match the current README behavior: describe the shape choice, inherited source settings, regeneration/confirmation, fixed total, integer remainder distribution and two-point-per-segment minimum. Replace the example with a 2,000-point record becoming two 1,000-point segments: shared clock and full-record period stay fixed, each one-cycle segment doubles its source frequency. Explain that insufficient total points require increasing available record points, not shrinking an existing segment further.

**Acceptance tests:** Review the rendered help against actual add/cancel/accept flows. Include 2,000 points split into two, and 16 into three (6/5/5). Update existing help assertions to cover behavior, not just the presence of a link.

### L2 — Share pure sequence aggregation and waveform-to-output mapping

**Classification:** Maintainability/refactoring opportunity, not a separate proven functional bug.

**Locations:**

- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/project.js`, lines **148-160** and **326-334**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/sequence.js`, lines **23-34**.
- `C:/Users/balde/.codex/worktrees/0e45/ArbDraw/js/core.js`, lines **416-421**.

**Opportunity:** Import and runtime synchronization separately calculate aggregate samples, count, frequency and voltage bounds. Full-record and selected-segment output paths separately project `documentFields`. Updating one copy can leave another with different timing or metadata. These are suitable small pure helpers, without requiring a framework rewrite.

**Repair instructions:** After the correctness fixes, extract a pure segment-summary helper usable by import and runtime synchronization, and a single waveform-to-output projection with an explicit shared-clock argument. Put helpers in an existing script loaded before their consumers (verify `index.html` ordering). Keep validation, synchronization/invalidation and UI rendering outside the pure helpers. Preserve full-record `fullSequence` labeling and selected-segment zero-based timestamps. Coordinate with M5 so summary extraction does not undo caching.

**Acceptance tests:** The same segment fixture must yield identical aggregate metadata after import, editing and undo/redo. Full-record/segment CSV, SVG and WAV tests must retain their documented sample order, metadata and time axes. Include one ordinary waveform to avoid accidentally applying sequence timing semantics to it.

## Implementation order and handoff

1. **H1:** bridge request-admission boundary, client/setup compatibility and fake-backend tests.
2. **M1, M2, M4:** sequence mutation and restoration invariants. These changes share state/render paths; integrate them sequentially and preserve each earlier fix.
3. **M3:** settings serialization, migration and bounded startup generation.
4. **M6:** response-body deadline handling, independent of waveform state.
5. **M5, then L2:** establish invalidation tests first, then cache and consolidate functions without breaking snapshot independence.
6. **L1:** align Help after the final supported behaviors are established.

For each repair: add the acceptance tests listed above, implement the smallest coherent change, rerun the affected test file, then run the complete JavaScript and Python commands from the evidence section. Keep hardware tests separate. Use one issue ID per commit when possible. Do not claim a fix merely because the original tests still pass: all of them passed before these reproductions were added.

## Intentional behavior and remaining verification

The shared sequence clock is intentionally derived from the original output period. It can exceed audio WAV's supported 8-384 kHz range even with the Audio profile selected; that limitation is documented. The review reproduced it but does not count it as an implementation defect or silently prescribe resampling. If product requirements change, decide explicitly whether WAV should resample or preserve one output sample per record point.

Before closing the repaired plan, perform an interactive browser pass for menus/focus, live property previews, the Samples Undo/Redo reproduction, export scope and large-record interaction. Hardware correctness still requires adapter-specific, separately authorized verification with known targets.
