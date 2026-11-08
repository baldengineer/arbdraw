const assert = require('node:assert/strict');
const test = require('node:test');
const i2c = require('../js/i2c-waveform.js');

// Decode actual sampled edges independently of the generator's transfer list.
function decode(packet) {
  const threshold = (packet.settings.high + packet.settings.low) / 2;
  const sda = packet.sda.map(value => Number(value > threshold));
  const scl = packet.scl.map(value => Number(value > threshold));
  let active = false, bits = [];
  const bytes = [], starts = [], stops = [], rising = [];
  for (let index = 1; index < sda.length; index++) {
    if (scl[index - 1] && scl[index] && sda[index] !== sda[index - 1]) {
      if (sda[index] === 0) { starts.push(index); active = true; bits = []; }
      else { stops.push(index); active = false; bits = []; }
    } else if (active && !scl[index - 1] && scl[index]) {
      bits.push(sda[index]); rising.push(index);
      if (bits.length === 9) {
        bytes.push({ value: bits.slice(0, 8).reduce((value, bit) => value * 2 + bit, 0), ack: bits[8] === 0 });
        bits = [];
      }
    }
  }
  return { bytes, starts, stops, rising };
}

test('7-bit write samples decode MSB-first address, R/W=0, payload, ACK and STOP', () => {
  const packet = i2c.generate({ address: '0x50', payload: '00 A5 0xFF' });
  const result = decode(packet);
  assert.deepEqual(result.bytes, [0xa0, 0x00, 0xa5, 0xff].map(value => ({ value, ack: true })));
  assert.equal(result.starts.length, 1); assert.equal(result.stops.length, 1);
  assert.equal(packet.sda[0], 3.3); assert.equal(packet.scl[0], 3.3);
  assert.equal(packet.sda.at(-1), 3.3); assert.equal(packet.scl.at(-1), 3.3);
});

test('read emits supplied target data with a final controller NACK', () => {
  const result = decode(i2c.generate({ operation: 'read', readPayload: '12 80' }));
  assert.deepEqual(result.bytes, [{ value: 0xa1, ack: true }, { value: 0x12, ack: true }, { value: 0x80, ack: false }]);
  assert.equal(decode(i2c.generate({ operation: 'read', finalReadNack: false })).bytes.at(-1).ack, true);
});

test('register-style write/read uses repeated START without an intervening STOP', () => {
  const packet = i2c.generate({ operation: 'writeRead', payload: '0F', readPayload: '21 43' });
  const result = decode(packet);
  assert.deepEqual(result.bytes.map(byte => byte.value), [0xa0, 0x0f, 0xa1, 0x21, 0x43]);
  assert.equal(result.starts.length, 2); assert.equal(result.stops.length, 1);
  assert.ok(result.stops[0] > result.starts[1]);
});

test('10-bit read sends both write-address bytes before repeated START and read header', () => {
  const result = decode(i2c.generate({ addressBits: 10, address: '0x2AB', operation: 'read', readPayload: '81' }));
  assert.deepEqual(result.bytes.map(byte => byte.value), [0xf4, 0xab, 0xf5, 0x81]);
  assert.equal(result.starts.length, 2);
  assert.equal(result.bytes.at(-1).ack, false);
  assert.deepEqual(decode(i2c.generate({ addressBits: 10, address: 0x2ab, payload: '' })).bytes.map(byte => byte.value), [0xf4, 0xab]);
});

test('address and write-data NACK terminate the transaction', () => {
  const addressNack = decode(i2c.generate({ operation: 'writeRead', addressAck: false }));
  assert.deepEqual(addressNack.bytes, [{ value: 0xa0, ack: false }]);
  assert.equal(addressNack.starts.length, 1); assert.equal(addressNack.stops.length, 1);
  const dataNack = decode(i2c.generate({ payload: '01 02 03', dataAck: false }));
  assert.deepEqual(dataNack.bytes, [{ value: 0xa0, ack: true }, { value: 1, ack: false }]);
});

test('all requested bus speeds share equal buffers and exact clock periods with valid low time', () => {
  for (const busHz of [100000, 400000, 1000000]) for (const samplesPerBit of [20, 40, 80]) {
    const packet = i2c.generate({ busHz, samplesPerBit, high: 5, low: 0 });
    const result = decode(packet);
    assert.equal(packet.sampleRateHz, busHz * samplesPerBit);
    assert.equal(packet.sda.length, packet.scl.length);
    assert.equal(packet.durationSeconds, packet.sda.length / packet.sampleRateHz);
    for (let index = 1; index < 27; index++) assert.equal(result.rising[index] - result.rising[index - 1], samplesPerBit);
    const lowTime = 0.55 / busHz;
    assert.ok(lowTime >= ({ 100000: 4.7e-6, 400000: 1.3e-6, 1000000: 0.5e-6 })[busHz]);
    const allowedTransitions = new Set([...result.starts, ...result.stops]);
    for (let index = 1; index < packet.sda.length; index++) {
      if (packet.sda[index] !== packet.sda[index - 1] && !allowedTransitions.has(index))
        assert.equal(packet.scl[index], 0);
    }
  }
});

test('idle controls add whole bit periods and omitting STOP leaves SCL low', () => {
  const regular = i2c.generate({}), longer = i2c.generate({ preIdle: 3, postIdle: 4 });
  assert.equal(longer.sda.length - regular.sda.length, 5 * 20);
  const unfinished = i2c.generate({ stop: false });
  assert.equal(decode(unfinished).stops.length, 0);
  assert.equal(unfinished.scl.at(-1), 0);
});

test('malformed packet settings and oversized records fail before returning samples', () => {
  for (const settings of [{ address: 'no' }, { address: 128 }, { addressBits: 10, address: 1024 },
    { payload: 'AA GG' }, { payload: '100' }, { payload: 'AA '.repeat(257) }, { operation: 'read', readPayload: '' },
    { busHz: 123 }, { samplesPerBit: 1 }, { high: 0, low: 1 }, { preIdle: -1 }, { postIdle: 0.5 },
    { sdaSignalId: 'same', sclSignalId: 'same' }]) assert.throws(() => i2c.generate(settings));
  assert.throws(() => i2c.generate({}, 100), /exceeds/);
});
