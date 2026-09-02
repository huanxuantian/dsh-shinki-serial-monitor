/**
 * Unit tests for the occupancy/owner layer of lib/serial-service.js
 * (issue #4): owner attribution (agent/ui), single-occupant per-port lock,
 * takeover, owner close/update notification, and enriched stats.
 *
 * Runs WITHOUT the native `serialport` module: a fake loader is injected via
 * `createSerialService({ loadSerialport })`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSerialService } from '../lib/serial-service.js';

/** Build a fake `serialport` module shape usable by the service.
 *  `listEntries` overrides the default port enumeration (default mirrors the
 *  pre-occupancy fixtures: friendly-name ports without USB descriptors). */
function fakeSerialportModule(listEntries) {
  const opened = new Map(); // path -> FakePort
  class FakePort {
    constructor(cfg) {
      this.cfg = { ...cfg };
      this.isOpen = false;
      this.listeners = {};
      this.path = cfg.path;
      opened.set(cfg.path, this);
    }
    on(evt, fn) { (this.listeners[evt] ??= []).push(fn); }
    emit(evt) { for (const fn of this.listeners[evt] ?? []) fn(); }
    open(cb) { this.isOpen = true; cb?.(null); }
    write(_data, cb) { cb?.(null); }
    update(patch, cb) { Object.assign(this.cfg, patch); cb?.(null); }
    close(cb) { this.isOpen = false; cb?.(); this.emit('close'); }
  }
  FakePort.list = async () => listEntries ?? [
    { path: 'COM3', friendlyName: 'USB-UART' },
    { path: 'COM7', friendlyName: '' },
  ];
  return { SerialPort: FakePort, opened };
}

function makeService(overrides = {}) {
  const fake = overrides.fake ?? fakeSerialportModule();
  const notifyCalls = [];
  const service = createSerialService({
    loadSerialport: async () => fake,
    notifyOwner: async (info) => { notifyCalls.push(info); return { delivered: true }; },
    resolveOwnerTitle: (agentId) => (agentId === 'sess-A' ? '烧录会话A' : undefined),
    ...overrides,
  });
  return { service, notifyCalls, opened: fake.opened };
}

test('open records agent owner + encoding/hexMode in stats', async () => {
  const { service } = makeService();
  await service.open('s1', 'COM3', { baudRate: 9600 }, { owner: { kind: 'agent', id: 'sess-A' }, encoding: 'gbk', hex: true });
  const { sessions } = service.stats();
  assert.equal(sessions.length, 1);
  const row = sessions[0];
  assert.equal(row.sessionId, 's1');
  assert.equal(row.path, 'COM3');
  assert.equal(row.owner.kind, 'agent');
  assert.equal(row.owner.id, 'sess-A');
  assert.equal(row.ownerTitle, '烧录会话A'); // resolveOwnerTitle
  assert.equal(row.encoding, 'gbk');          // label-form encoding kept
  assert.equal(row.hexMode, true);
  assert.equal(row.opts.baudRate, 9600);
  assert.ok(typeof row.openedAt === 'number');
});

test('ui open gets owner kind ui', async () => {
  const { service } = makeService();
  await service.open('u1', 'COM3', {}, { owner: { kind: 'ui' } });
  const { sessions } = service.stats();
  assert.equal(sessions[0].owner.kind, 'ui');
});

test('second session on same path is BUSY; takeover closes first', async () => {
  const { service } = makeService();
  await service.open('a', 'COM3', {}, { owner: { kind: 'agent', id: 'sess-A' } });
  // busy
  await assert.rejects(
    service.open('b', 'COM3', {}, { owner: { kind: 'ui' } }),
    (e) => e.code === 'port-busy' && /sess-A/.test(e.message),
  );
  // takeover succeeds and closes the previous holder ('a'), so only 'b' remains
  await service.open('b', 'COM3', {}, { owner: { kind: 'ui' }, takeover: true });
  const { sessions } = service.stats();
  assert.deepEqual(sessions.map((s) => s.sessionId), ['b']);
});

test('same sessionId reopen is not a user close (no notify)', async () => {
  const { service, notifyCalls } = makeService();
  await service.open('a', 'COM3', { baudRate: 9600 }, { owner: { kind: 'agent', id: 'sess-A' } });
  await service.open('a', 'COM3', { baudRate: 115200 }, { owner: { kind: 'agent', id: 'sess-A' } });
  assert.equal(notifyCalls.length, 0);
  const { sessions } = service.stats();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].opts.baudRate, 115200);
});

test('UI close on agent-owned port notifies the owning session', async () => {
  const { service, notifyCalls } = makeService();
  await service.open('a', 'COM3', {}, { owner: { kind: 'agent', id: 'sess-A' } });
  const r = await service.close('a', { notifyOwner: true, reason: '手动关闭' });
  assert.equal(r.ok, true);
  assert.equal(r.closed, true);
  assert.equal(r.notify.delivered, true);
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].session.id, 'a');
  assert.equal(notifyCalls[0].action.kind, 'close');
  assert.equal(notifyCalls[0].action.reason, '手动关闭');
});

test("agent's own close (no notifyOwner) never notifies", async () => {
  const { service, notifyCalls } = makeService();
  await service.open('a', 'COM3', {}, { owner: { kind: 'agent', id: 'sess-A' } });
  const r = await service.close('a');
  assert.equal(r.closed, true);
  assert.equal(r.notify, null);
  assert.equal(notifyCalls.length, 0);
});

test('UI update on agent-owned port notifies with kind update + changes', async () => {
  const { service, notifyCalls } = makeService();
  await service.open('a', 'COM3', { baudRate: 9600 }, { owner: { kind: 'agent', id: 'sess-A' } });
  const r = await service.update('a', { baudRate: 115200 }, { notifyOwner: true });
  assert.equal(r.ok, true);
  assert.equal(r.opts.baudRate, 115200);
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].action.kind, 'update');
  assert.deepEqual(notifyCalls[0].action.changes, { baudRate: 115200 });
  assert.equal(r.notify.delivered, true);
});

test('ui-owned port update does not notify (no agent)', async () => {
  const { service, notifyCalls } = makeService();
  await service.open('u1', 'COM3', {}, { owner: { kind: 'ui' } });
  await service.update('u1', { baudRate: 230400 }, { notifyOwner: true });
  assert.equal(notifyCalls.length, 0);
});

test('port close event releases the occupancy lock', async () => {
  const { service, opened } = makeService();
  await service.open('a', 'COM3', {}, { owner: { kind: 'agent', id: 'sess-A' } });
  opened.get('COM3').emit('close'); // simulated device unplug / forced close
  // lock released → another session can now take the same path
  await service.open('b', 'COM3', {}, { owner: { kind: 'ui' } });
  const { sessions } = service.stats();
  assert.deepEqual(sessions.map((s) => s.sessionId), ['b']);
});

test('notifyOwner failures are contained and reported', async () => {
  const fake = fakeSerialportModule();
  const service = createSerialService({
    loadSerialport: async () => fake,
    notifyOwner: async () => { throw new Error('agent gone'); },
  });
  await service.open('a', 'COM3', {}, { owner: { kind: 'agent', id: 'sess-A' } });
  const r = await service.close('a', { notifyOwner: true });
  assert.equal(r.closed, true);
  assert.equal(r.notify.delivered, false);
  assert.match(r.notify.error, /agent gone/);
});

test('opEvents logs AI open/write (actor-gated) and user update', async () => {
  const { service } = makeService();
  await service.open('a', 'COM3', { baudRate: 9600 }, { owner: { kind: 'agent', id: 'sess-A' }, encoding: 'gbk', hex: true });
  await service.write('a', new Uint8Array([0x41]), 'TX', { actor: 'agent' }); // AI write → logged
  await service.write('a', new Uint8Array([0x42]), 'TX');                      // no actor → NOT logged
  await service.update('a', { baudRate: 115200 }, { notifyOwner: true });      // user action + notify
  const { events } = service.opEvents('a');
  const names = events.map((e) => e.name);
  assert.ok(names.includes('serial_open'));
  assert.ok(names.includes('serial_write'));
  assert.ok(names.includes('ui_update'));
  assert.equal(events.filter((e) => e.name === 'serial_write').length, 1);
  const openEv = events.find((e) => e.name === 'serial_open');
  assert.equal(openEv.actor, 'agent');
  assert.match(openEv.text, /9600/);
  const updEv = events.find((e) => e.name === 'ui_update');
  assert.equal(updEv.actor, 'user');
  assert.equal(updEv.delivered, true);
  assert.match(updEv.text, /已通知 AI 会话/);
});

test('opRecord appends agent query events (read/get_log)', async () => {
  const { service } = makeService();
  await service.open('a', 'COM3', {}, { owner: { kind: 'agent', id: 'sess-A' } });
  service.opRecord('a', { name: 'serial_read', text: 'AI读取最近 50 行日志（返回 3 行）' });
  const { events } = service.opEvents('a');
  assert.equal(events[events.length - 1].name, 'serial_read');
  assert.equal(events[events.length - 1].actor, 'agent');
  assert.match(events[events.length - 1].text, /50 行/);
});

test('list drops undefined descriptor fields → lossless JSON (macOS virtual ports)', async () => {
  // Real macOS SerialPort.list() always contains two path-only virtual ports
  // (tty.debug-console / tty.Bluetooth-Incoming-Port) beside the USB CDC one.
  // Mapping them previously emitted own props with `undefined` values → the
  // result could not round-trip JSON and dsh rejected it ("value is not
  // lossless JSON", bug report 20260902).
  const fake = fakeSerialportModule([
    { path: '/dev/tty.debug-console' },
    { path: '/dev/tty.Bluetooth-Incoming-Port' },
    {
      path: '/dev/tty.usbmodemCC0589692', manufacturer: 'CherryUSB',
      serialNumber: 'CC058969', locationId: '00130000',
      vendorId: '0d28', productId: '0204',
    },
  ]);
  const { service } = makeService({ fake });
  const ports = await service.list();
  assert.equal(ports.length, 3);

  // No own key holds undefined / NaN on any port…
  for (const p of ports) {
    for (const [k, v] of Object.entries(p)) {
      assert.ok(v !== undefined && !(typeof v === 'number' && Number.isNaN(v)), `port ${p.path} key ${k} is ${String(v)}`);
    }
  }
  // …so the array is lossless: JSON round trip is identity.
  assert.deepEqual(JSON.parse(JSON.stringify(ports)), ports);

  // Descriptor-less virtual ports keep only path + label (schema-optional keys omitted).
  assert.deepEqual(ports[0], { path: '/dev/tty.debug-console', label: '/dev/tty.debug-console' });
  assert.deepEqual(Object.keys(ports[1]).sort(), ['label', 'path']);

  // Full-descriptor USB port keeps raw ids + parsed decimal ids.
  assert.equal(ports[2].vendorId, '0d28');
  assert.equal(ports[2].productId, '0204');
  assert.equal(ports[2].manufacturer, 'CherryUSB');
  assert.equal(ports[2].usbVendorId, 0x0d28);
  assert.equal(ports[2].usbProductId, 0x0204);
  assert.equal(Object.keys(ports[2]).length, 8); // path,label + 4 raw + 2 parsed ids
});
