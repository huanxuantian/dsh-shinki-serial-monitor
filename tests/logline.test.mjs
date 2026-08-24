import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLogLine } from '../lib/logline.js';

test('buildLogLine RX detects level + ms timestamp', () => {
  const ts = 1787577000123;
  const line = buildLogLine({ dir: 'RX', bytes: new TextEncoder().encode('[E] oops'), tsMs: ts });
  assert.equal(line.dir, 'RX');
  assert.equal(line.level, 'E');
  assert.equal(line.tsMs, ts);
  assert.equal(line.iso, new Date(ts).toISOString());
  assert.equal(line.bytes, 8);
});

test('buildLogLine TX has no level + optional hex', () => {
  const line = buildLogLine({ dir: 'TX', bytes: new Uint8Array([0x41, 0x42]), hexMode: true });
  assert.equal(line.level, null);
  assert.equal(line.hex, '41 42');
  assert.equal(line.text, 'AB');
});

test('buildLogLine accepts pre-decoded text', () => {
  const line = buildLogLine({ dir: 'RX', text: '中文消息', hexMode: false });
  assert.equal(line.text, '中文消息');
  assert.equal(line.bytes, 0);
});

test('seq passthrough', () => {
  const line = buildLogLine({ dir: 'RX', text: 'x', seq: 42 });
  assert.equal(line.seq, 42);
});
