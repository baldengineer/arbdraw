const assert = require('node:assert/strict');
const test = require('node:test');
const { waveformSvg } = require('../js/svg-export.js');

test('SVG preserves sample order, fits actual extrema, and escapes the title', () => {
  const svg = waveformSvg({ values: [-5, 15, 0], name: 'A & <B>' });
  assert.ok(svg.includes('12.000,388.000 600.000,12.000 1188.000,294.000'));
  assert.ok(svg.includes('A &amp; &lt;B&gt;'));
  assert.ok(svg.includes('stroke="black"'));
  assert.ok(!svg.includes('<rect'));
  assert.ok(!svg.includes('Time (s)'));
});

test('optional axes show record duration and voltage units with a grid', () => {
  const svg = waveformSvg({ values: [-2, 2], includeAxes: true, durationSeconds: .004 });
  assert.ok(svg.includes('Time (s)'));
  assert.ok(svg.includes('Voltage (V)'));
  assert.ok(svg.includes('>0.004</text>'));
  assert.ok(svg.includes('stroke-dasharray'));
  assert.ok(svg.includes('90.000,340.000 1170.000,20.000'));
});

test('DC and large waveforms export without invalid coordinates or argument limits', () => {
  const dc = waveformSvg({ values: [3, 3], includeAxes: true });
  assert.ok(dc.includes('90.000,180.000 1170.000,180.000'));
  const large = waveformSvg({ values: Array.from({length: 200000}, (_, i) => i % 2) });
  assert.ok(!/NaN|Infinity/.test(large));
  assert.throws(() => waveformSvg({ values: [NaN] }), /finite samples/);
});
