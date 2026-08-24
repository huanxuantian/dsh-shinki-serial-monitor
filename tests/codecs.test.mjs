import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXT_ENCODINGS, labelByName, decodeBytes, encodeText, formatHex, parseHex, formatTimestamp,
} from '../lib/codecs.js';

test('hex format/parse round-trip', () => {
  const bytes = new Uint8Array([0x5a, 0xfe, 0x00, 0xff]);
  assert.equal(formatHex(bytes), '5A FE 00 FF');
  assert.deepEqual(parseHex('5A FE 00 FF'), bytes);
  assert.deepEqual(parseHex('5a,fe\n00;ff'), bytes); // separators tolerated
  assert.throws(() => parseHex('5A F'), /偶数/);
  assert.throws(() => parseHex('ZZ'), /非法/);
});

test('parseHex empty string', () => {
  assert.equal(parseHex('').length, 0);
});

test('labelByName resolves all 12 encodings', () => {
  assert.equal(TEXT_ENCODINGS.length, 12);
  assert.equal(labelByName('GBK'), 'gbk');
  assert.equal(labelByName('GB2312'), 'gbk'); // GBK superset
  assert.equal(labelByName('Shift-JIS'), 'shift_jis');
  assert.equal(labelByName('unknown-xyz'), 'utf-8');
});

test('decodeBytes utf-8 replacement mode', () => {
  assert.equal(decodeBytes(new TextEncoder().encode('你好')), '你好');
  // Invalid utf-8 bytes decode to U+FFFD replacement chars (not throw).
  assert.equal(decodeBytes(new Uint8Array([0xff, 0xfe, 0x01]), 'utf-8'), '\ufffd\ufffd\x01');
});

test('decodeBytes GBK decodes GBK bytes', () => {
  // Hand-built GBK bytes for 串口 (0xB4 0xAE 0xBF 0xDA).
  const gbk = new Uint8Array([0xb4, 0xae, 0xbf, 0xda]);
  assert.equal(decodeBytes(gbk, labelByName('GBK')), '串口');
});

test('encodeText is UTF-8 only (TextEncoder limitation)', () => {
  // TextEncoder supports UTF-8 only; GBK TX encoding falls back to UTF-8.
  const bytes = encodeText('串口', labelByName('GBK'));
  assert.equal(new TextDecoder('utf-8').decode(bytes), '串口');
});

test('formatTimestamp ms precision', () => {
  const ts = Date.UTC(2026, 7, 24, 10, 0, 0, 123);
  // formatTimestamp uses local time; just assert the ms token is 123.
  assert.equal(formatTimestamp(ts, '%f'), '123');
  assert.match(formatTimestamp(ts, '%H:%M:%S.%f'), /^\d{2}:\d{2}:\d{2}\.123$/);
});
