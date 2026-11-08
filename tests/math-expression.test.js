const assert = require('node:assert/strict');
const test = require('node:test');
const math = require('../js/math-expression.js');

test('arithmetic uses conventional precedence, right-associative powers, and scientific notation', () => {
  for (const [expression, expected] of [
    ['2+3*4', 14], ['(2+3)*4', 20], ['2^3^2', 512], ['-2^2', -4],
    ['2^-2', 0.25], ['-(-3)', 3], ['1e-3 + .2 + 2E+1', 20.201],
    ['7%4', 3], ['pow(2,3)+min(4,5)-max(1,2)', 10], ['log(e)', 1],
  ]) assert.equal(math.compile(expression)(0), expected, expression);
  assert.ok(Math.abs(math.compile('sin(2*pi*x)')(0.25) - 1) < 1e-12);
});

test('only the documented expression language is accepted and work is bounded', () => {
  for (const expression of ['', '2x', 'sin x', 'sin(1,2)', 'min(1)', '(x', 'x)',
    'Math.sin(x)', 'globalThis', 'constructor', '__proto__', 'x=1', 'x;alert(1)',
    '(()=>1)()', 'x[0]', '1e999', '2**3', '/*hi*/1', '"x"',
    '('.repeat(40) + 'x' + ')'.repeat(40), 'x+'.repeat(80) + 'x', 'x'.repeat(513)]) {
    assert.throws(() => math.compile(expression), undefined, expression);
  }
});

test('presets generate finite bounded samples and match the sine source at repeated cycle boundaries', () => {
  for (const preset of math.presets) {
    const values = math.samples({ mathExpression: preset.expression, sampleCount: 997, cycles: 7 });
    assert.equal(values.length, 997);
    assert.ok(values.every(value => Number.isFinite(value) && value >= -1 && value <= 1));
  }
  for (const phaseDegrees of [0, 90, -90, 360]) {
    const values = math.samples({ sampleCount: 1000, cycles: 100, phaseDegrees });
    for (let i = 0; i < values.length; i++)
      assert.ok(Math.abs(values[i] - Math.sin(2 * Math.PI * (i % 10 / 10 + phaseDegrees / 360))) < 1e-12);
  }
  assert.deepEqual(math.samples({ mathExpression: '3*cos(2*pi*x)', sampleCount: 4 }), [1, 3 * Math.cos(Math.PI / 2), -1, 3 * Math.cos(3 * Math.PI / 2)]);
});

test('non-finite results reject the whole buffer and identify the failing sample', () => {
  for (const expression of ['1/0', 'sqrt(-1)', 'log(0)', 'exp(1000)', '0/0'])
    assert.throws(() => math.samples({ mathExpression: expression, sampleCount: 10 }), /not finite at sample 1/);
  assert.throws(() => math.samples({ mathExpression: '1/(x-0.5)', sampleCount: 4 }), /sample 3/);
  assert.equal(math.samples({ mathExpression: '1/(x-0.5)', sampleCount: 5 }).length, 5);
  assert.deepEqual(math.samples({ mathExpression: 'x', sampleCount: 1 }), [0]);
  assert.throws(() => math.samples({ sampleCount: 1000001 }), /timing/);
});
