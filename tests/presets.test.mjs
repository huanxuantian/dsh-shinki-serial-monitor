import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMON_BAUDRATES, DEFAULT_OPTIONS, parseBaudrate, clampOptions, WEB_SERIAL_LIMITS,
} from '../lib/presets.js';

test('common baud rates include serial_debug range', () => {
  assert.ok(COMMON_BAUDRATES.includes(1200));
  assert.ok(COMMON_BAUDRATES.includes(115200));
  assert.ok(COMMON_BAUDRATES.includes(921600));
  assert.ok(COMMON_BAUDRATES.includes(4000000));
});

test('parseBaudrate accepts thousands separators', () => {
  assert.equal(parseBaudrate('1,000,000'), 1000000);
  assert.equal(parseBaudrate('115200'), 115200);
  assert.throws(() => parseBaudrate('abc'), /无效波特率/);
  assert.throws(() => parseBaudrate('0'), /无效波特率/);
});

test('clampOptions downgrades to Web Serial limits', () => {
  const out = clampOptions({ baudRate: 9600, dataBits: 5, parity: 'mark', stopBits: 1.5, flowControl: 'xonxoff' }, WEB_SERIAL_LIMITS);
  assert.equal(out.dataBits, 8);
  assert.equal(out.parity, 'none');
  assert.equal(out.stopBits, 1);
  assert.equal(out.flowControl, 'none');
  assert.equal(out.baudRate, 9600); // baud is free-form
});

test('defaults are 8N1', () => {
  assert.deepEqual(DEFAULT_OPTIONS, { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
});
