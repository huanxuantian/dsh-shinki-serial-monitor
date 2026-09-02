import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineSerialTools } from '../lib/tools.js';

function fakeService() {
  const calls = [];
  return {
    calls,
    async list() { calls.push('list'); return [{ path: 'COM3', label: 'COM3' }]; },
    async open(sessionId, path, opts, extra) { calls.push(['open', sessionId, path, opts, extra]); return { sessionId, opened: true, opts, info: { path }, owner: extra?.owner }; },
    async stats() { calls.push(['stats']); return { sessions: [] }; },
    async write(sessionId, bytes, dir) { calls.push(['write', sessionId, Array.from(bytes), dir]); return { ok: true, bytes: bytes.length, tsMs: 1 }; },
    async readLines(sessionId, limit) { calls.push(['readLines', sessionId, limit]); return { lines: [{ seq: 1, tsMs: 1, text: 'hi', dir: 'RX', level: 'I', bytes: 2 }] }; },
    async getLog(sessionId, opts) { calls.push(['getLog', sessionId, opts]); return { lines: [], total: 0 }; },
    async close(sessionId) { calls.push(['close', sessionId]); return { ok: true, closed: true, notify: { delivered: true } }; },
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

test('serial_open forwards the calling agent as owner', async () => {
  const svc = fakeService();
  const defs = await defineSerialTools(svc);
  const openTool = defs.find((d) => d.name === 'serial_open');
  const exec = { agent: { id: 'sess-A' } };
  const result = await openTool.execute({ path: 'COM3', baudRate: 9600 }, exec);
  assert.equal(result.opened, true);
  assert.equal(result.owner, undefined); // output schema is additionalProperties:false (bug report 20260902)
  const [, , , , extra] = svc.calls[0];
  assert.deepEqual(extra.owner, { kind: 'agent', id: 'sess-A' });
});

test('serial_open forwards takeover to the service', async () => {
  const svc = fakeService();
  const defs = await defineSerialTools(svc);
  const openTool = defs.find((d) => d.name === 'serial_open');
  const exec = { agent: { id: 'sess-A' } };
  const result = await openTool.execute({ path: 'COM3', takeover: true }, exec);
  assert.equal(result.opened, true);
  assert.equal(result.owner, undefined);
  const [, , , , extra] = svc.calls[0];
  assert.equal(extra.takeover, true);
});

test('serial_open result never leaks undeclared output fields (schema-safe)', async () => {
  const svc = fakeService();
  const defs = await defineSerialTools(svc);
  const openTool = defs.find((d) => d.name === 'serial_open');
  const declared = Object.keys(openTool.output.schema.properties || {});
  const result = await openTool.execute({ path: 'COM3', baudRate: 115200 }, { agent: { id: 'sess-A' } });
  // dsh-tools output schema uses additionalProperties:false — leaking `owner`
  // here made real registries reject the whole result (bug report 20260902).
  assert.deepEqual(Object.keys(result).sort(), declared.sort());
});

test('serial_open without exec.agent leaves owner undefined', async () => {
  const svc = fakeService();
  const defs = await defineSerialTools(svc);
  const openTool = defs.find((d) => d.name === 'serial_open');
  await openTool.execute({ path: 'COM3' });
  const [, , , , extra] = svc.calls[0];
  assert.equal(extra.owner, undefined);
});

test('serial_occupancy returns flattened occupancy rows', async () => {
  const svc = fakeService();
  svc.stats = async () => ({ sessions: [{
    sessionId: 'a', path: 'COM3', label: 'USB-UART',
    opts: { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' },
    encoding: 'gbk', hexMode: true,
    owner: { kind: 'agent', id: 'sess-A' }, ownerTitle: '烧录会话',
  }] });
  const defs = await defineSerialTools(svc);
  const tool = defs.find((d) => d.name === 'serial_occupancy');
  const v = await tool.execute({}); // real dsh-tools validates args — always pass an object
  assert.equal(v.sessions.length, 1);
  assert.equal(v.sessions[0].ownerKind, 'agent');
  assert.equal(v.sessions[0].ownerId, 'sess-A');
  assert.equal(v.sessions[0].ownerTitle, '烧录会话');
  assert.equal(v.sessions[0].baudRate, '115200');
  assert.equal(v.sessions[0].encoding, 'gbk');
  assert.equal(v.sessions[0].hexMode, true);
});

test('all 7 tool names present', async () => {
  const defs = await defineSerialTools(fakeService());
  const names = defs.map((d) => d.name).sort();
  assert.deepEqual(names, [
    'serial_close', 'serial_get_log', 'serial_list_ports', 'serial_occupancy', 'serial_open', 'serial_read', 'serial_write',
  ].sort());
});

test('serial_close result omits notify (schema-safe)', async () => {
  const svc = fakeService();
  const defs = await defineSerialTools(svc);
  const closeTool = defs.find((d) => d.name === 'serial_close');
  const result = await closeTool.execute({ sessionId: 's1' });
  assert.equal(result.closed, true);
  assert.equal(result.notify, undefined); // notify is UI-only, not in output schema
});

test('every tool result stays within its declared output schema (top-level keys)', async () => {
  const svc = fakeService();
  const defs = await defineSerialTools(svc);
  const argMap = {
    serial_list_ports: {},
    serial_open: { path: 'COM3' },
    serial_write: { sessionId: 's1', text: 'x' },
    serial_read: { sessionId: 's1' },
    serial_get_log: { sessionId: 's1' },
    serial_close: { sessionId: 's1' },
    serial_occupancy: {},
  };
  for (const def of defs) {
    const declared = Object.keys(def.output.schema.properties || {});
    const result = await def.execute(argMap[def.name] || {}, { agent: { id: 'sess-A' } });
    for (const k of Object.keys(result)) {
      assert.ok(declared.includes(k), `${def.name} leaks undeclared output field "${k}"`);
    }
  }
});
