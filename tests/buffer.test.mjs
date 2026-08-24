import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RingBuffer, LineSplitter, TimeWindowMerger } from '../lib/buffer.js';

test('RingBuffer caps and keeps newest', () => {
  const rb = new RingBuffer(3);
  rb.push(1); rb.push(2); rb.push(3); rb.push(4);
  assert.deepEqual(rb.toArray(), [2, 3, 4]);
  rb.clear();
  assert.deepEqual(rb.toArray(), []);
});

function collect(splitter, chunks) {
  const lines = [];
  const s = new splitter((l) => lines.push(l));
  for (const c of chunks) s.push(c);
  s.flush();
  return lines;
}

test('LineSplitter splits LF / CRLF / CR', () => {
  const lines = collect(LineSplitter, [new Uint8Array([97, 10, 98, 13, 10, 99, 13])]);
  assert.deepEqual(lines.map((l) => Array.from(l)), [[97], [98], [99]]);
});

test('LineSplitter keeps partial line across chunks until flush', () => {
  const lines = [];
  const s = new LineSplitter((l) => lines.push(l));
  s.push(new Uint8Array([104, 105])); // 'hi' no newline
  assert.equal(lines.length, 0);
  s.push(new Uint8Array([10]));
  assert.equal(lines.length, 1);
  assert.deepEqual(Array.from(lines[0]), [104, 105]);
});

test('TimeWindowMerger coalesces chunks within the window', async () => {
  const chunks = [];
  const m = new TimeWindowMerger((c) => chunks.push(Array.from(c)), { windowMs: 30 });
  m.push(new Uint8Array([1, 2]));
  m.push(new Uint8Array([3]));
  await new Promise((r) => setTimeout(r, 60));
  m.push(new Uint8Array([4, 5]));
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(chunks, [[1, 2, 3], [4, 5]]);
});

test('TimeWindowMerger flush() emits pending bytes', () => {
  const chunks = [];
  const m = new TimeWindowMerger((c) => chunks.push(Array.from(c)), { windowMs: 1000 });
  m.push(new Uint8Array([9]));
  m.flush();
  assert.deepEqual(chunks, [[9]]);
});
