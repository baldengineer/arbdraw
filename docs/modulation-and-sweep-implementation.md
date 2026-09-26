# Modulation and sweep: mathematics and implementation plan

Status: design and implementation handoff, 2026-09-16. No application code is changed by this document.

## 1. Decision and scope

**Yes, modulation and sweep can be baked into an arbitrary-waveform buffer.** The buffer must represent the entire desired time interval, including the changing amplitude, phase, frequency, or duty cycle. Uploading one carrier cycle and changing its nominal frequency does not encode modulation.

The qualifications matter:

- A finite, predetermined signal can be sampled to a specified bandwidth and accuracy if sufficient memory and playback capability are available.
- Repeating the buffer repeats the entire experiment. It does not automatically continue the oscillator or the modulation beyond the buffer boundary.
- Exact indefinitely repeating modulation requires compatible carrier and modulation periods. A long sweep or a very slow modulator combined with a fast carrier can require too many points.
- An external, live modulation input cannot be baked in advance. Use a hardware modulator or a streaming implementation for that requirement.
- Ideal square waves, ramp resets, and instantaneous phase changes have unlimited bandwidth. Their physical realization is necessarily an approximation.

Implement a pure software renderer first. Keep hardware-native modulation/sweep as a separate future backend, selected only from verified adapter capabilities. Do not implement modulation by sending rapidly timed frequency commands from the browser or Python bridge.

“Modulations” is not enumerated in the request. This design covers AM, FM, PM, and PWM as the core set, with ASK/OOK, FSK, and PSK specified as later extensions. No IQ modulation, external modulation, protocol encoding, or simultaneous modulation modes are required for the initial release.

Recommended delivery:

1. Establish consistent timing for new rendered records; preserve legacy projects.
2. Sine carrier with sine AM/FM/PM and linear/logarithmic frequency sweep.
3. Square and ramp/triangle carriers, square/triangle/ramp modulators, and square-wave PWM, with the bandwidth and edge rules below.
4. Digital keying, arbitrary periodic carrier tables, and verified native hardware modes.

The first two synthesis stages together provide the requested basic-shape scope. Support only one modulation or sweep mode at a time initially. AM is not required to operate simultaneously with a sweep.

## 2. Current repository findings

These are observations of the local source, not assumptions about instrument behavior.

| Location | Current behavior | Consequence |
| --- | --- | --- |
| `js/waveform-editor.js`, `generate()` | Samples shapes at `i/(N-1)`, with an integer `state.cycles` | Includes both endpoints; cannot directly express a physically timed modulated record |
| `js/core.js`, `waveformDurationMs()` | Editor time span is `1/state.frequency` | Does not include cycle count |
| `js/properties.js`, AWG synchronization | AWG repetition frequency is `state.frequency/state.cycles` | Distinct from the editor time span |
| `js/project.js` | Record duration is `N/Fs`; CSV timestamps extend through that duration using `i/(N-1)` | Last CSV timestamp differs from the usual sampled-signal convention |
| `js/audio-playback.js` | Accepts duration override, uses endpoint interpolation, normalizes, always loops | Needs an explicit timed-record path and one-shot support |
| `js/wav-export.js` | Writes one buffer at its supplied sample rate, peak-normalized | Does not preserve calibrated voltage or frequency-derived playback timing |
| `js/filters.js` | Low-pass uses `state.sampleRate`; smoothing clamps to nominal high/low | Can use the wrong effective rate or clip an AM envelope |
| `js/awg-profiles.js` | Contains nominal sample rates and point limits | Does not establish actual record playback rate, interpolation, or native modulation support |
| `js/project.js`, `python_bridge/ADAPTERS.md` | Version 1 schema; adapters validate supported versions | New timing semantics require an explicit compatibility boundary |

The central prerequisite is a consistent clock, not a new waveform formula. Do not silently reinterpret existing saved buffers or assume a profile's listed DAC rate is the effective rate at which its uploaded points are consumed.

## 3. Timing contract for new synthesis

Use seconds, hertz, volts, and phase in **cycles** internally. Convert degrees to cycles at the UI boundary.

```text
N = integer number of samples, N >= 2
Fs = effective rendered sample rate in samples/second
T = N / Fs                         record playback duration
t[n] = n / Fs,  n = 0,...,N-1
recordRepeatHz = 1 / T = Fs / N
```

The interval is `[0,T)`. The final stored sample is at `T-1/Fs`; there is no duplicate sample at `T`. Evaluate the analytic signal at `T` separately for boundary diagnostics. Display the axis through `T` if useful, but place every actual point at its true timestamp.

For fixed-rate outputs, accept requested duration, choose `N = round(Fs*Trequested)`, enforce point count/granularity, and report `Tactual=N/Fs`. Render the sweep using `Tactual`; report its difference from requested duration. Do not keep the original sweep duration while claiming the quantized record has the same endpoint frequency.

For repetition-rate-controlled arbitrary generators, choose `N` and `T`, derive effective `Fs=N/T`, then ask the adapter to realize `recordRepeatHz=1/T`. The physical DAC may run at another clock and interpolate or resample. Adapter limits and actual output quality still apply. An adapter must report any achieved timing adjustment; regenerate or reject when it exceeds the requested tolerance.

Carrier frequency `fc`, modulation frequency `fm`, sweep endpoints, and buffer repetition frequency are separate quantities. Never write `fc` to the device's arbitrary-buffer repetition frequency unless the buffer actually contains one carrier cycle.

Changing playback speed after baking changes **all** time-domain rates together. Playing at twice the intended rate doubles carrier, modulation frequency, FM deviation, and sweep endpoints, and halves record duration. AM depth and PM deviation remain unchanged. This is not independent control of the carrier.

## 4. Shared oscillator and shapes

Let `q(t)` be unwrapped phase in cycles and `p=frac(q)=q-floor(q)`. Let `A>=0` be carrier peak amplitude and `O` its DC offset. Then:

```text
v(t) = O + A*c(q(t))
sine:        c(q) = sin(2*pi*q)
square:      c(q) = +1 if p < d, otherwise -1
triangle:    c(q) = -1+2*p/r                 if p < r
                      1-2*(p-r)/(1-r)       otherwise
rising ramp: c(q) = 2*p-1                   (r=1)
falling ramp:c(q) = 1-2*p                   (r=0)
```

Here `d` is duty fraction, `r` is triangle rise fraction. Handle `r=0` and `r=1` separately to avoid division by zero. These conventions match existing sine, square, and triangle starting phases. Default `d=r=0.5`. The square's mean is `2d-1`; do not silently remove it.

For an unmodulated carrier, `q(t)=q0+fc*t`, where `q0=phaseDegrees/360`. Shapes are functions of phase, not functions of a presumed fixed period. This lets the same shapes follow FM or sweep.

Use a normalized modulator `m(t)=s(fm*t+qm)` in `[-1,1]`. Initially expose sine; later add 50% square and triangle/ramp with the same shape conventions. Fix square modulator duty at 50% initially so it has zero mean. Ramp/triangle modulators also have zero cycle mean.

### Integrating a general modulator

Define `M(t)=integral(0,t,m(u) du)`. FM requires this integral, not a pointwise phase multiplier.

For sine modulation, with `psi=2*pi*qm`:

```text
M(t) = [cos(psi)-cos(2*pi*fm*t+psi)] / (2*pi*fm)
```

For square/triangle/ramp modulators, build exact piecewise-linear primitives. If a phase segment starts at `a` with value `v0` and slope `b`, its integrated area from `a` through `a+h` is `v0*h+b*h*h/2`. Precompute cumulative segment areas to obtain `P(p)` for `0<=p<=1`. Extend to any real phase `z` as:

```text
J(z) = floor(z)*P(1) + P(frac(z))
M(t) = [J(qm+fm*t)-J(qm)] / fm
```

For square use segments `[0,0.5):+1` and `[0.5,1):-1`. For triangle use the two slopes above; for ramps use one linear segment. This handles phase offsets, noninteger cycle counts, negative initial phase, and exact edge crossings without trapezoidal integration errors. Require `fm>0` for an enabled modulator; “off” is its own mode.

For future arbitrary control curves, use analytic piecewise integrals when possible. Otherwise integrate on the internal oversampled grid with a documented error tolerance. For `fm` near zero, evaluate sine integral differences with stable trigonometric identities rather than subtracting nearly equal cosines.

## 5. Modulation equations and constraints

### AM: amplitude modulation

```text
a(t) = A*[1 + depth*m(t)]
q(t) = q0 + fc*t
v(t) = O + a(t)*c(q(t))
depth = depthPercent/100, initially 0 <= depth <= 1
```

Modulate the AC excursion around `O`, not the entire voltage including the offset. At 100% depth the envelope ranges from zero to twice the unmodulated carrier amplitude. Conservative requested bounds are `O +/- A*(1+depth)`; use them for headroom checks even when sampled extrema miss envelope peaks. Filtering may add overshoot, so also check final rendered samples.

Do not clamp back to the unmodulated carrier's high/low levels. Keep carrier amplitude/offset separate from output voltage limits. Initially reject overmodulation (`depth>1`). A later explicit option may allow negative envelope and its associated phase inversions.

DSB suppressed carrier is a separate later mode: `v=O+A*m*c(q)`. It is not the same as AM at 100% depth.

### FM: frequency modulation

```text
f(t) = fc + deviationHz*m(t)
q(t) = q0 + fc*t + deviationHz*M(t)
v(t) = O + A*c(q(t))
```

`deviationHz>=0` is peak deviation, not peak-to-peak deviation. Initially require `fc-deviationHz>0`. This makes phase monotonic and avoids ambiguous backward-running square/triangle oscillators.

Do **not** use `q=(fc+deviationHz*m(t))*t`: its derivative has an unwanted `t*m'(t)` term. For sine modulation, modulation index is `beta=deviationHz/fm`; this is useful for bandwidth diagnostics but is not a second independent parameter.

### PM: phase modulation

```text
b = phaseDeviationDegrees/360
q(t) = q0 + fc*t + b*m(t)
v(t) = O + A*c(q(t))
fInstantaneous(t) = fc + b*m'(t)   wherever the derivative exists
```

PM's `q0` is the unmodulated reference phase: the actual initial phase includes `b*m(0)`. Do not subtract that value without defining a different phase convention.

For a sine modulator, peak instantaneous frequency deviation is `2*pi*b*fm`, equivalently `betaRadians*fm`. Initially require `fc>2*pi*b*fm`. For nonsinusoidal continuous modulators apply the derivative bound from their actual slopes. Square PM and ramp-reset PM have discontinuous phase and no finite peak derivative; defer these combinations to an explicitly bandwidth-limited phase-jump mode. Triangle PM is continuous but its frequency changes abruptly at the corners.

### PWM: pulse-width modulation (square carrier only)

Choose **cycle-sampled, leading-edge-aligned PWM** for an unambiguous first implementation:

```text
cycle k starts at t_k = (k-q0)/fc
d_k = d0 + dutyDeviation*m(t_k)
high interval: [t_k, t_k+d_k/fc)
low interval:  [t_k+d_k/fc, t_(k+1))
```

Evaluate the modulator at the cycle start, including the preceding cycle when `t_k<0`. Duty deviation is a fraction; a UI deviation of 20 percentage points means `0.20`. Require `0.01<=d0-dutyDeviation` and `d0+dutyDeviation<=0.99`; reject rather than clamp. Initially require `fm<fc/2`, and warn that this method samples the modulator once per carrier cycle.

This convention produces one pulse per carrier period. The seemingly simpler comparison `frac(q(t))<d0+deviation*m(t)` is natural-sampled PWM, which can produce additional crossings for fast modulators; do not substitute it silently. PWM changes average voltage when duty changes; preserving the carrier's DC average is not part of PWM here.

### Later digital keying

Use an explicit symbol sequence with symbol boundaries in seconds; do not reinterpret UART framing as a modulation protocol.

| Mode | Rule | Boundary behavior |
| --- | --- | --- |
| ASK / OOK | Select nonnegative amplitude `A_j`; OOK uses `{0,A}` | Keep oscillator phase running during zero-amplitude intervals |
| Continuous-phase FSK | Select frequency `f_j`; integrate `q += f_j*segmentDuration` | Preserve phase across every frequency transition |
| PSK | Add symbol phase `theta_j/(2*pi)` to `q0+fc*t` | Phase jumps are intentional; bandwidth limit them |

For FSK, precompute phase at every symbol boundary and evaluate the residual time within the active symbol. Require integer symbol counts for complete repeated patterns; report truncated last symbols in finite records. Pulse shaping and symbol-clock constraints need their own extension before claiming communication-standard compliance.

## 6. Sweep equations

A sweep is a prescribed frequency trajectory integrated into phase. The following integrals are derived from the frequency laws; SciPy's official chirp reference independently confirms the linear/logarithmic laws and phase-as-integral convention. SciPy uses cosine by default; ArbDraw should retain its sine convention. [SciPy chirp reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.chirp.html)

Use one leg of duration `D>0`, local time `u` in `[0,D]`, starting frequency `f0>0`, ending frequency `f1>0`. Let `Q(u)` be cycles accumulated during the leg.

### Linear frequency sweep

```text
k = (f1-f0)/D
f(u) = f0+k*u
Q(u) = f0*u + 0.5*k*u*u
Q(D) = D*(f0+f1)/2
```

### Logarithmic frequency sweep

```text
a = log(f1/f0)/D
f(u) = f0*exp(a*u)
Q(u) = f0*expm1(a*u)/a
Q(D) = D*(f1-f0)/log(f1/f0)
```

When `f1=f0`, use `Q(u)=f0*u`. For nearby endpoints use `log1p((f1-f0)/f0)` and `expm1`; avoid dividing nearly equal differences. Downward sweeps use the same formulas with negative `k` or `a`. Reject zero or negative endpoints in this implementation.

Evaluate `v(t)=O+A*c(qStart+Q(u))`. Using `sin(2*pi*f(u)*u)` is incorrect; for the linear case it doubles the sweep-rate term in instantaneous frequency.

### Sweep sequence and repeat behavior

- **One shot:** one leg lasting `T`. Output stops/returns to the configured idle behavior after `T`; device support must be verified. A WAV naturally contains one record.
- **Repeated upward/downward sweep:** frequency resets from `f1` to `f0` at the record boundary. Even with phase closure this reset is intentional and can generate spectral artifacts.
- **Up/down:** two legs, e.g. `T/2` each. Reverse the frequency law on the second leg and carry the first leg's accumulated phase forward. Frequency is continuous at the turnaround and repeat boundary, but its derivative may change abruptly.
- **Stepped sweep, later:** `f_j=f0+j*(f1-f0)/(K-1)` or `f_j=f0*(f1/f0)^(j/(K-1))`, `K>=2`, dwell `D_j`; accumulate `sum(f_j*D_j)` across steps. Phase remains continuous. UI must distinguish dwell time from total duration.

Holds and return legs are segments in the same phase-continuous sequence. Prefix-sum each segment's cycle integral. Never restart oscillator phase at segment boundaries unless explicitly implementing a phase-reset experiment.

The endpoint `f1` is the frequency at the mathematical time `D`; the last stored sample occurs before it. Do not add a duplicate endpoint sample to force a visible endpoint.

## 7. When can the buffer loop cleanly?

For stationary AM/FM/PM, a conservative sufficient condition is complete modulator cycles plus complete accumulated carrier phase:

```text
fm*T is an integer
q(T)-q(0) is an integer
```

For zero-mean FM over whole modulator periods, the second condition reduces to `fc*T` integer. For PM with a repeating modulator it also reduces to `fc*T` integer. For PWM require carrier cycles and the cycle-sampled duty sequence to repeat. Include edge/filter state in the boundary test.

If `fc/fm=p/q` in lowest integer terms, a common record duration is `T=q/fm=p/fc`. For floating-point inputs, use bounded rational approximation with a stated frequency-error tolerance and memory limit, not an unbounded decimal least common multiple. Example: `fc=1000 Hz`, `fm=73 Hz` needs a 1-second exact common record, not one 73 Hz modulation cycle.

For a sweep require total `sum Q(D)` integer for carrier phase closure. A single linear leg accumulates `T*(f0+f1)/2` cycles. A logarithmic leg accumulates the expression above. Whole phase alone does not remove an endpoint frequency reset.

Report phase residual `abs(deltaQ-round(deltaQ))` in cycles, modulator-cycle residual, analytic value mismatch at `0` versus `T`, and frequency/derivative mismatch where meaningful. Suggested phase closure tolerance: `1e-8` cycle plus a scale-aware floating-point allowance. At intended square/ramp edges compare one-sided behavior against the periodic shape; a scheduled edge is not itself an erroneous seam.

Do not require `values[N-1]===values[0]`: adjacent samples across a valid seam are separated by one sample interval. Conversely, equal endpoint voltage alone does not prove continuity of phase or slope.

Offer three explicit outcomes: coherent repeat; repeat with a reported reset/discontinuity; finite record. Suggest a longer compatible duration when possible. Never silently alter requested frequencies, append a crossfade, round sweep cycles, or force the last sample equal to the first. Those operations change the experiment.

## 8. Sampling, bandwidth, memory, and edge fidelity

### Feasibility before allocation

`N=Fs*T` couples the fastest feature and the longest interval. A useful sine-carrier starting heuristic is at least 20 points per shortest instantaneous carrier cycle, but this is a quality heuristic, not an anti-alias guarantee.

Examples at `Fs=48 kSa/s`:

| Signal | Duration | Samples | Result |
| --- | --- | --- | --- |
| 1 kHz sine, 10 Hz AM, one coherent modulator cycle | 0.1 s | 4,800 | Fits Audio; exceeds the repository DG1022 profile limit of 4,096 |
| 1 kHz sine, 73 Hz AM, exact common repeat | 1 s | 48,000 | Fits Audio's 100,000-point limit |
| Linear sine sweep 100 Hz to 2 kHz | 1 s | 48,000 | 1,050 accumulated cycles; phase closes, frequency resets on repeat |
| 1 MHz carrier, 1 Hz modulation, 20 MSa/s render | 1 s | 20,000,000 | Exceeds every finite point limit currently listed in the repository |

These compare **repository limits**, not independently verified device specifications. Nominal hardware DAC rates must not be used to infer these record durations.

### Bandwidth policy

AM on a sine carrier with a sine modulator has carrier and sidebands at `fc` and `fc+/-fm`. FM and PM generally have infinitely many sidebands even with sine modulation. For sinusoidal FM, `fc+deviationHz+fm` is a useful approximate upper significant-frequency estimate; it is not a strict support boundary. For sine PM replace deviation by `betaRadians*fm` for that estimate. Specify an error target, not a claim of exact finite bandwidth.

Square/ramp carriers contain harmonics beyond the fundamental; triangle harmonics decay faster but are still unbounded. `max(fInstantaneous)<Fs/2` alone is insufficient. Narrow PWM pulses may disappear if treated only at output sample instants.

For the initial sine-only stage, reject obvious Nyquist violations and require the significant-band estimate to fit below `0.4*Fs`; label it an estimate. Apply the general rendering policy below before claiming controlled alias rejection for FM/PM or enabling sharp shapes.

### Concrete bandwidth-limited renderer

1. Choose output rate `Fs` and a stated target, initially 60 dB numerical alias suppression relative to the unmodulated carrier peak. This is a design target to test, not a verified instrument specification.
2. Evaluate the analytic signal at an internal rate `L*Fs`, initially `L=8`. Integrate phase analytically even at this rate.
3. Low-pass using a symmetric, unity-DC-gain windowed-sinc FIR: passband through `0.4*Fs`, stopband from `0.5*Fs`, designed for at least 80 dB stopband rejection. A Kaiser design is suitable. Choose odd tap count from the transition width at the internal rate; verify its measured response instead of relying only on an order estimate.
4. Compensate the integer internal-sample group delay and decimate at positions corresponding to `n/Fs`. Output exactly `N` samples. The output is the bandwidth-limited approximation, not the ideal sharp waveform.
5. Render again at `2L`. Compare aligned outputs; require maximum absolute difference <= `1e-3*A` for nonzero `A`. Increase through `L=64` if needed; reject the requested quality if convergence fails. Convergence is a numerical check, not proof of an analog spectral mask; add independent spectral tests.
6. Inspect final extrema after filtering. Do not silently clamp overshoot. Reduce amplitude only on explicit user action or reject a voltage-limited target.

For coherent repeating records, use periodic padding/convolution so filter state wraps. For an explicitly discontinuous repeated record, periodically extend that record, accepting that the filter rounds its seam. For a finite record, define extension as idle voltage `O` before and after the record and report filter boundary transients. Centered filtering can introduce pre/post ringing; do not promise ideal one-shot edges. Extend the computation by the FIR radius, then retain the requested interval.

Bound memory before rendering. Use typed arrays, chunk FIR work, and impose an internal-work budget; do not allocate `64*N` points plus copies without checking it. Move expensive renders to a worker with cancellation in the sharp-shape stage.

### Rise/fall times

Existing `squarePulseVoltage()` converts seconds to phase using a fixed frequency. Replacing that frequency with instantaneous frequency is not exact during a sweep.

In the first sharp-shape release, support zero requested transition time with the bandwidth-limited renderer. Defer nonzero rise/fall time under FM/PM/sweep/PWM until an event-based implementation exists; reject the combination clearly rather than ignore the setting.

For that extension, find rising/falling phase crossings using monotonic `q(t)` and bracketed bisection (or closed-form inverses). PWM already supplies edge times. Start a voltage ramp at each edge and cap its duration to the next opposite edge, matching current semantics. Evaluate ramps in seconds, then apply bandwidth limiting. Handle initial edge history and periodic boundary state explicitly. The final analog rise time also depends on reconstruction and device bandwidth.

## 9. New document model and legacy compatibility

Use schema **version 2** for the new explicit timing contract. Proposed fields below are new; no current parser or adapter is assumed to support them.

```json
{
  "schema": "arbdraw.waveform",
  "version": 2,
  "timing": {
    "sampleRateHz": 48000,
    "sampleCount": 4800,
    "playback": "repeat"
  },
  "synthesis": {
    "carrier": {
      "shape": "sine",
      "frequencyHz": 1000,
      "phaseDegrees": 0,
      "amplitudePeakV": 0.5,
      "offsetV": 0,
      "dutyFraction": 0.5,
      "symmetryFraction": 0.5
    },
    "mode": "am",
    "modulator": {
      "shape": "sine",
      "frequencyHz": 10,
      "phaseDegrees": 0
    },
    "am": { "depthFraction": 0.5 },
    "render": { "algorithmVersion": 1, "bandwidthPolicy": "limited" }
  },
  "waveform": {
    "type": "sine",
    "sampleCount": 4800,
    "values": []
  }
}
```

This is an illustrative metadata skeleton: replace the empty `values` with 4,800 finite voltages before treating it as a valid document. `timing` is the authority; require duplicate count fields to agree. Derive duration and repetition frequency, do not independently edit them. Keep selected AWG profile and UI preferences separately from effective timing.

Add mode-specific objects: `fm.deviationHz`, `pm.deviationDegrees`, `pwm.dutyDeviationFraction`, or `sweep.{law,startHz,stopHz,direction}`. Derive one-leg duration from `T`; up/down uses two `T/2` legs initially. Validate a tagged union: only the selected mode's active parameters affect rendering. Keep inactive UI preferences outside the active synthesis recipe.

`waveform.values` remains the authoritative artifact for playback and export. The recipe is provenance and an explicit regeneration source. After freehand editing, mark the recipe detached and preserve it for optional regeneration; do not claim those samples still satisfy the recipe. Deep-copy timing and recipe in undo/redo snapshots. Save renderer version and quality settings for reproducibility; derived diagnostics may be recalculated.

Preserve version 1 loading and behavior until the user explicitly converts to timed synthesis. Conversion must ask which legacy time interpretation to adopt: existing buffer samples at saved `Fs`, or the intended AWG period `cycles/frequency`. Preserve voltages in either choice; conversion of endpoint-inclusive samples needs a documented resampling choice. Do not regenerate a legacy edited buffer automatically.

An old adapter must reject version 2. Add a validated conversion layer or update adapters to consume timed records. A conversion to version 1 may be allowed only after verifying which frequency fields that adapter actually uses, its voltage scaling, and the resulting playback period. In a compatible flattened document the saved values remain authoritative, its cycle count is 1, and its nominal frequency is the **record repetition rate**, not the carrier. The compatibility waveshape should match the source carrier where possible. Do not assume those assignments alone make every adapter compatible.

Native hardware synthesis is a separate command contract that must not pretend to be a baked sample transfer. Hardware generators can have distinct function-generator, arbitrary-waveform, and modulation blocks; this is documented for Keysight's M320xA family and is not evidence that ArbDraw's supported models have equivalent capabilities. [Keysight architecture reference](https://helpfiles.keysight.com/csg/m31xx_m33xxa_awg/Content/M3201A_M3202A_PXIe_AWG_Users_Guide/10%20Overview%20of%20M3201A%20M3202A%20PXIe%20AWGs%20and%20Theory.html)

## 10. Code organization and render algorithm

Follow the existing dependency-free, browser-global/CommonJS pattern used in `js/waveform-shapes.js`. Proposed new modules:

- `js/signal-timing.js`: timing validation, quantization, record budgeting, boundary diagnostics.
- `js/signal-synthesis.js`: normalized shapes, modulator primitives, sweep integrals, pure rendering API.
- `js/signal-bandlimit.js`: FIR design, padding, filtering/decimation, quality checks.
- A small UI integration layer for mode-specific controls; a worker when rendering cost requires it.

```text
renderSignal(recipe, timing, targetLimits):
    validate all finite numbers, units, supported combinations and voltage bounds
    resolve N, Fs, T and target's record constraints
    build analytic modulator value and integral evaluators
    build phase evaluator:
        none/AM/PWM -> q0 + fc*t
        FM          -> q0 + fc*t + deviation*M(t)
        PM          -> q0 + fc*t + phaseDeviationCycles*m(t)
        sweep       -> q0 + prefixSegmentCycles + segmentIntegral(localTime)
    evaluate analytic phase and control boundary states at 0 and T
    choose direct sine evaluation or verified bandwidth-limited render path
    for every evaluation time:
        evaluate phase, amplitude envelope, and carrier (or PWM event intervals)
        voltage = offset + envelope * normalizedCarrier
    finish filtering/decimation and produce exactly N voltage samples
    apply only explicitly requested postprocessing at effective Fs
    validate resulting voltage range, finiteness, boundaries, and quality
    return values, resolvedTiming, diagnostics, recipeProvenance
```

Use wrapped phase for trig evaluation to reduce precision loss while retaining accumulated cycles separately for boundary checks. Reject parameter ranges that cannot meet the phase tolerance in double precision; no arbitrary maximum frequency should be inferred from the UI's unit menu.

Integrate with these existing areas:

- `waveform-editor.js`: route new synthesis through the pure renderer; one completed edit produces one history entry. Cancel stale renders.
- `core.js`, `properties.js`, `defaults.js`, field definitions: separate carrier frequency from record duration/rate; use new timing only for version 2.
- `project.js`, `views.js`, `scope-view.js`, `svg-export.js`: one time source for points, axes, CSV, and SVG; CSV timestamp is `n/Fs`.
- `audio-playback.js`: finite versus repeat, sample-time resampling, anti-aliasing for downsampling, and effective duration. Do not reuse the legacy endpoint interpolation for new records.
- `wav-export.js`: retain documented normalization, but display its gain and loss of voltage calibration. PCM duration must equal `N/Fs`; enforce supported integer audio rate or explicitly resample.
- `filters.js`: effective sample rate; no smoothing clamp to carrier levels. Initially disable stochastic noise and legacy filters in new synthesis until their timing, loop state, and provenance are explicit.
- `project.js` and bridge/adapters: schema validation, preserved samples, target timing and amplitude verification.

Show carrier settings, modulation/sweep settings, and record settings separately. Display actual duration, required points, repetition behavior, and a useful feasibility error before allocation. For new recipes, integer “cycles” is a derived diagnostic, not an independent input competing with duration and frequency.

## 11. Acceptance tests and handoff checklist

Use Node's existing `node:test` convention for pure functions; no instrument is needed for math tests. The following are acceptance criteria, not tests executed as part of this design document.

1. **Time:** N=4, Fs=8 gives timestamps `[0,0.125,0.25,0.375]`, T=0.5. No endpoint duplication. CSV, SVG, audio, WAV, and adapter report the same duration within their documented quantization.
2. **Baseline shapes:** zero-depth/deviation matches a fresh unmodulated version 2 render sample-for-sample within `1e-12 V` for direct evaluation. Legacy version 1 fixtures remain unchanged; do not compare against their endpoint-inclusive samples as if timing were equal.
3. **AM oracle:** A=1, O=0.25, depth=0.5 has envelope 0.5..1.5 V around offset. A coherent 1 kHz carrier/10 Hz sine modulator produces carrier amplitude 1 V and sideband amplitudes 0.25 V each. Use sinusoid projection over whole periods to measure them.
4. **FM oracle:** fc=1000, deviation=100, fm=10, qm=0: `q(0.025)-q0=25+100/(20*pi)` cycles and `f(0.025)=1100 Hz`; at 0.1 s phase advances exactly 100 cycles. Compare analytic derivative to requested frequency away from discontinuities.
5. **PM oracle:** sine modulation with 90-degree deviation at fm=10 produces peak frequency deviation `5*pi Hz`. Doubling fm doubles PM frequency deviation but leaves FM deviation fixed. Check initial modulator phase semantics.
6. **Primitives:** integrate square, asymmetric triangle, and both ramps over complete/partial periods and phase offsets against independent high-accuracy numerical quadrature. Full zero-mean periods integrate to zero; edge alignment must not alter the answer.
7. **Sweep oracles:** 100->1100 Hz in 1 s linear accumulates 600 cycles; at 0.5 s it has 600 Hz and 175 accumulated cycles. 100->1000 Hz log in 1 s accumulates `900/log(10)` cycles, with midpoint frequency `sqrt(100000)`. Test downward, equal-frequency, and near-equal cases.
8. **Segments:** up/down and stepped sweeps preserve phase at boundaries. One shot does not loop; repeated upward sweep reports frequency reset even if phase closes.
9. **PWM:** d0=0.5, deviation=0.2 produces 30..70% duty without extra pulses. Verify the sampled duty at each cycle start and a nonzero carrier phase. Reject impossible duty bounds.
10. **Loop checks:** reject the claim of coherent 1000/73 Hz AM in a one-modulator-cycle buffer; accept T=1 s. Check analytic endpoint state, not equality of first and last stored samples. Verify intentional square/ramp edges remain valid.
11. **Bandwidth:** test high-deviation FM, narrow PWM, square/ramp sweeps, and frequencies close to Nyquist against an independent higher-rate reference. Measure FIR passband/stopband, decimation alignment, convergence, seam behavior, and overshoot. Deliberately impossible budgets fail without huge allocations.
12. **Persistence/editing:** save/open preserves recipe, timing, and exact samples; freehand edit detaches recipe; undo/redo restores all three; invalid v2 recipes do not silently regenerate another mode.
13. **Voltage:** DC offset is not multiplied by AM; no hidden clipping, normalization, or amplitude-dependent change in timing. Verify DAC conversion with nonzero offset and an AM envelope whose maximum exceeds carrier high/low.
14. **Hardware boundary:** fake adapter tests reject unknown timing semantics, unsupported one-shot, point count, rate, and voltage requests before transfer. Verify actual adapter source and vendor documentation before enabling v2 uploads. Hardware validation measures carrier/modulator frequencies, total duration, envelope, and seam on a scope; record model, firmware, load, and transfer settings.

Run `node --test tests/*.test.js` in an environment where wildcard expansion is supported, or enumerate the test files explicitly on Windows. Run relevant existing Python bridge tests if changing the bridge contract. Add browser integration checks for new controls, serialization, cancellation, and consistent timing. A visually plausible plot alone is not sufficient validation.

The implementing agent should complete the timing foundation and sine stage before enabling all combinations. Square and ramp/triangle are mathematically supported by the same phase engine, but release them only with the specified bandwidth handling. Native device modulation remains optional and independently validated; baked output must stand on its own.
