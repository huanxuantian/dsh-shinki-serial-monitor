import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineSerialTools } from '../lib/tools.js';

function fakeService() {
  const calls = [];
  return {
    calls,
    async list() { calls.push('list'); return [{ path: 'COM3', label: 'COM3' }]; },
    async open(sessionId, path, opts, extra) { calls.push(['open', sessionId, path, opts, extra]); return { sessionId, opened: true, opts, info: { path } }; },
    async write(sessionId, bytes, dir) { calls.push(['write', sessionId, Array.from(bytes), dir]); return { ok: true, bytes: bytes.length, tsMs: 1 }; },
    async readLines(sessionId, limit) { calls.push(['readLines', sessionId, limit]); return { lines: [{ seq: 1, tsMs: 1, text: 'hi', dir: 'RX', level: 'I', bytes: 2 }] }; },
    async getLog(sessionId, opts) { calls.push(['getLog', sessionId, opts]); return { lines: [], total: 0 }; },
    async close(sessionId) { calls.push(['close', sessionId]); return { ok: true, closed: true }; },
  };
}

test('serial_open generates a sessionId when absent', async () => {
  const svc = fakeService();
  const defs = await defineSerialTools(svc);
  const openTool = defs.find((d) => d.name === 'serial_open');
  const result = await openTool.execute({ path: 'COM3', baudRate: 9600 });
  assert.equal(result.opened, true);
  assert.ok(typeof result.sessionId === 'string' && result.sessionId.length > 0);
  assert.equal(svc.calls[0][0], 'open');
});

test('serial_write hex + CRLF appends newline bytes', async () => {
  const svc = fakeService();
  const defs = await defineSerialTools(svc);
  const writeTool = defs.find((d) => d.name === 'serial_write');
  await writeTool.execute({ sessionId: 's1', hex: '41 42', newline: 'CRLF' });
  const [method, , bytes, dir] = svc.calls[0];
  assert.equal(method, 'write');
  assert.deepEqual(bytes, [0x41, 0x42, 0x0d, 0x0a]);
  assert.equal(dir, 'TX');
});

test('serial_write text uses TextEncoder and default dir', async () => {
  const svc = fakeService();
  const defs = await defineSerialTools(svc);
  const writeTool = defs.find((d) => d.name === 'serial_write');
  await writeTool.execute({ sessionId: 's1', text: 'AT' });
  assert.deepEqual(svc.calls[0][2], [65, 84]);
});

test('all 6 tool names present', async () => {
  const defs = await defineSerialTools(fakeService());
  const names = defs.map((d) => d.name).sort();
  assert.deepEqual(names, [
    'serial_close', 'serial_get_log', 'serial_list_ports', 'serial_open', 'serial_read', 'serial_write',
  ].sort());
});
