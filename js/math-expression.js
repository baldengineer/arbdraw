// SPDX-License-Identifier: MIT
// Copyright (c) 2026 James Lewis <james@baldengineer.com>
// A small arithmetic language: no JavaScript evaluation or property access.
(function exposeMath(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ARBDRAW_MATH = api;
})(globalThis, function createMath() {
  const defaultExpression = 'sin(2*pi*x)';
  const functions = Object.freeze({
    sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan],
    abs: [1, Math.abs], sqrt: [1, Math.sqrt], exp: [1, Math.exp],
    log: [1, Math.log], floor: [1, Math.floor], ceil: [1, Math.ceil],
    round: [1, Math.round], sign: [1, Math.sign],
    min: [2, Math.min], max: [2, Math.max], pow: [2, Math.pow],
  });
  const presets = Object.freeze([
    { name: 'Sine', expression: defaultExpression },
    { name: 'Third harmonic', expression: '(sin(2*pi*x)+0.3*sin(6*pi*x))/1.3' },
    { name: 'Damped sine', expression: 'exp(-4*x)*sin(8*pi*x)' },
    { name: 'Gaussian pulse', expression: '2*exp(-80*(x-0.5)^2)-1' },
    { name: 'Rectified sine', expression: '2*abs(sin(2*pi*x))-1' },
    { name: 'Parabola', expression: '1-8*(x-0.5)^2' },
  ]);

  function compile(expression) {
    if (typeof expression !== 'string' || !expression.trim() || expression.length > 512)
      throw new Error('Enter an expression of 1 to 512 characters.');
    const tokens = [];
    const pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?|([a-zA-Z_][a-zA-Z_0-9]*)|([+\-*/%^(),]))/y;
    let offset = 0;
    while (offset < expression.trimEnd().length) {
      pattern.lastIndex = offset;
      const match = pattern.exec(expression);
      if (!match) throw new Error(`Unexpected character at position ${offset + 1}.`);
      offset = pattern.lastIndex;
      const token = match[1] !== undefined ? Number(match[1] + (match[2] === undefined ? '' : 'e' + match[2]))
        : match[3] || match[4];
      if (typeof token === 'number' && !Number.isFinite(token)) throw new Error('Number is too large.');
      tokens.push(token);
      if (tokens.length > 128) throw new Error('Expression is too complex (maximum 128 tokens).');
    }
    let index = 0, depth = 0;
    function take(expected) {
      if (tokens[index] !== expected) throw new Error(`Expected "${expected}".`);
      index++;
    }
    function primary() {
      const token = tokens[index++];
      if (typeof token === 'number') return () => token;
      if (token === 'x') return x => x;
      if (token === 'pi') return () => Math.PI;
      if (token === 'e') return () => Math.E;
      if (token === '(') {
        const value = expressionAt(0);
        take(')');
        return value;
      }
      if (Object.hasOwn(functions, token)) {
        const [arity, fn] = functions[token], args = [];
        take('(');
        for (let i = 0; i < arity; i++) {
          if (i) take(',');
          args.push(expressionAt(0));
        }
        take(')');
        return arity === 1 ? x => fn(args[0](x)) : x => fn(args[0](x), args[1](x));
      }
      throw new Error(token === undefined ? 'Expression is incomplete.' : `Unknown name or unexpected token "${token}".`);
    }
    const operators = {
      '+': [1, (a, b) => a + b], '-': [1, (a, b) => a - b],
      '*': [2, (a, b) => a * b], '/': [2, (a, b) => a / b], '%': [2, (a, b) => a % b],
      '^': [4, (a, b) => a ** b],
    };
    function expressionAt(minimum) {
      if (++depth > 32) throw new Error('Expression is nested too deeply.');
      let left;
      if (tokens[index] === '+' || tokens[index] === '-') {
        const sign = tokens[index++] === '-' ? -1 : 1, operand = expressionAt(3);
        left = x => sign * operand(x);
      } else left = primary();
      while (Object.hasOwn(operators, tokens[index]) && operators[tokens[index]][0] >= minimum) {
        const operator = tokens[index++], [precedence, fn] = operators[operator];
        const a = left, b = expressionAt(precedence + (operator === '^' ? 0 : 1));
        left = x => fn(a(x), b(x));
      }
      depth--;
      return left;
    }
    const evaluate = expressionAt(0);
    if (index !== tokens.length) throw new Error('Unexpected token; use * for multiplication.');
    return evaluate;
  }

  function samples({ mathExpression = defaultExpression, sampleCount, cycles = 1, phaseDegrees = 0 }) {
    if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 1000000
      || !Number.isFinite(cycles) || cycles < 1 || !Number.isFinite(phaseDegrees))
      throw new Error('Invalid Math waveform timing.');
    const evaluate = compile(mathExpression), values = new Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const phase = ((i * cycles) % sampleCount) / sampleCount + (phaseDegrees % 360) / 360;
      const x = phase - Math.floor(phase), value = evaluate(x);
      if (!Number.isFinite(value))
        throw new Error(`Expression is not finite at sample ${i + 1} (x = ${Number(x.toPrecision(8))}).`);
      values[i] = Math.max(-1, Math.min(1, value));
    }
    return values;
  }
  return Object.freeze({ compile, samples, presets, defaultExpression });
});
