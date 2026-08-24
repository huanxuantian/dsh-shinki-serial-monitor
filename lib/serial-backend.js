/**
 * Serial backend abstraction (browser half). Two implementations:
 *  - WebSerialBackend (M0): `navigator.serial`, zero native deps, fast for
 *    the NW.js/Chromium desktop shell; limited line params (7/8 data bits,
 *    none/even/odd parity, 1/2 stop bits, none/hardware flow control).
 *  - HostSerialBackend (M1): talks to the host `/shinki-serial` data plane
 *    (HTTP; WS streaming is a drop-in later), full line params, and shares
 *    the SAME structured ms-timestamped LogLine log the agent reads.
 *
 * Both produce/consume LogLine objects (see lib/logline.js) so the UI sees
 * a consistent stream regardless of backend — the same model the serial_*
 * agent tools return (overall-goal contract).
 */
import { TimeWindowMerger } from './buffer.js';
import { parseHex, encodeText } from './codecs.js';
import { buildLogLine } from './logline.js';
import { WEB_SERIAL_LIMITS, clampOptions } from './presets.js';

// ── shared write-payload builder (text | hex + newline) ────────────────
function buildWriteBytes(input) {
  let bytes;
  if (typeof input?.hex === 'string') bytes = parseHex(input.hex);
  else if (typeof input?.text === 'string') bytes = encodeText(input.text, input.encoding || 'utf-8');
  else return null;
  const nl = input?.newline;
  if (nl === 'CRLF') { const o = new Uint8Array(bytes.length + 2); o.set(bytes); o.set([0x0d, 0x0a], bytes.length); return o; }
  if (nl === 'LF') { const o = new Uint8Array(bytes.length + 1); o.set(bytes); o[bytes.length] = 0x0a; return o; }
  if (nl === 'CR') { const o = new Uint8Array(bytes.length + 1); o.set(bytes); o[bytes.length] = 0x0d; return o; }
  return bytes;
}

// ── Web Serial backend ─────────────────────────────────────────────────
const pathToPort = new Map(); // info.path -> SerialPort
let portCounter = 0;

function hex16(n) { return (n ?? 0).toString(16).toUpperCase().padStart(4, '0'); }

function portInfo(port) {
  portCounter += 1;
  const gi = (typeof port.getInfo === 'function' ? port.getInfo() : {}) || {};
  const info = {
    path: `usb:${portCounter}`,
    label: `USB Serial ${hex16(gi.usbVendorId)}:${hex16(gi.usbProductId)}`,
    usbVendorId: gi.usbVendorId,
    usbProductId: gi.usbProductId,
  };
  pathToPort.set(info.path, port);
  return info;
}

export class WebSerialBackend {
  kind = 'webserial';
  static available() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }
  async list() {
    const ports = await navigator.serial.getPorts();
    return ports.map((p) => portInfo(p).info);
  }
  async requestPort() {
    const port = await navigator.serial.requestPort();
    return portInfo(port).info;
  }
  onConnect(cb) {
    const fn = (e) => cb(portInfo(e.target).info);
    navigator.serial.addEventListener('connect', fn);
    return () => navigator.serial.removeEventListener('connect', fn);
  }
  onDisconnect(cb) {
    const fn = (e) => cb(portInfo(e.target).info);
    navigator.serial.addEventListener('disconnect', fn);
    return () => navigator.serial.removeEventListener('disconnect', fn);
  }
  async open(info, opts, sessionCfg = {}) {
    const port = pathToPort.get(info?.path);
    if (!port) throw new Error('串口对象不可用，请重新选择端口');
    const clamped = clampOptions(opts, WEB_SERIAL_LIMITS);
    await port.open({
      baudRate: clamped.baudRate,
      dataBits: clamped.dataBits,
      parity: clamped.parity,
      stopBits: clamped.stopBits,
      flowControl: clamped.flowControl,
    });
    const reader = port.readable.getReader();
    const writer = port.writable.getWriter();
    let seq = 0;
    let closed = false;
    let loglineCb = null;
    const encoding = sessionCfg.encoding || 'utf-8';
    const hexMode = sessionCfg.hex === true;
    const rxMergeMs = Math.max(0, Number(sessionCfg.rxMergeMs) || 100);
    let merge = null; // coalescer (created in read()); runtime-tunable via setMergeMs
    const emit = (dir, bytes) => {
      const line = buildLogLine({ dir, bytes, hexMode, encoding, seq: ++seq, tsMs: Date.now() });
      if (loglineCb) loglineCb(line);
      return line;
    };
    return {
      info, opts: clamped,
      async read(onLogLine) {
        loglineCb = onLogLine;
        // RX coalescing: one LogLine per windowMs (default 100ms).
        merge = new TimeWindowMerger((bytes) => {
          onLogLine(buildLogLine({ dir: 'RX', bytes, hexMode, encoding, seq: ++seq, tsMs: Date.now() }));
        }, { windowMs: rxMergeMs });
        while (!closed) {
          try {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) merge.push(new Uint8Array(value));
          } catch { break; }
        }
        try { merge.flush(); } catch { /* ignore */ }
      },
      async setMergeMs(ms) { if (merge) merge.setWindowMs(ms); return { ok: true, rxMergeMs: ms }; },
      async write(input) {
        const bytes = buildWriteBytes({ ...input, encoding });
        if (!bytes) throw new Error('需提供 text 或 hex');
        await writer.write(bytes);
        const line = emit(input.dir || 'TX', bytes);
        return { ok: true, bytes: bytes.length, tsMs: line.tsMs };
      },
      async update() { throw new Error('Web Serial 不支持运行时改参数，请关闭后按新参数重开'); },
      async close() {
        closed = true;
        try { await reader.cancel(); } catch { /* ignore */ }
        try { writer.releaseLock(); } catch { /* ignore */ }
        try { await port.close(); } catch { /* ignore */ }
      },
    };
  }
}

// ── Host backend (HTTP polling; WS drop-in later) ───────────────────────
async function hostApi(method, payload, signal) {
  const res = await fetch('/shinki-serial/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, ...payload }),
    signal,
  });
  const body = await res.json().catch(() => ({ ok: false, error: { code: 'bad-response', message: '无效响应' } }));
  if (!res.ok || body.ok !== true) {
    const e = new Error(body?.error?.message ?? `HTTP ${res.status}`);
    e.code = body?.error?.code ?? 'http-' + res.status;
    throw e;
  }
  return body.value;
}

export class HostSerialBackend {
  kind = 'host';
  static async available() {
    try {
      const res = await fetch('/shinki-serial/status');
      const body = await res.json();
      return body?.value?.hostAvailable === true;
    } catch { return false; }
  }
  async list() {
    const value = await hostApi('list', {});
    return value.ports.map((p) => ({ ...p, path: p.path, label: p.label || p.path }));
  }
  async requestPort() { return null; } // host has no picker; list() covers all ports
  onConnect() { return () => {}; }      // host: hot-plug via re-list (UI refresh button)
  onDisconnect() { return () => {}; }
  async open(info, opts, sessionCfg = {}) {
    const sessionId = info.sessionId || `host:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await hostApi('open', { sessionId, path: info.path, opts, extra: sessionCfg });
    let cursor = 0;
    let closed = false;
    let timer = null;
    return {
      info, opts,
      async read(onLogLine) {
        const poll = async () => {
          if (closed) return;
          try {
            const value = await hostApi('read', { sessionId, limit: 200 });
            for (const line of value.lines) {
              if (line.seq > cursor) { cursor = line.seq; onLogLine(line); }
            }
          } catch { /* transient; next poll retries */ }
        };
        await poll();
        timer = setInterval(poll, 60);
      },
      async write(input) {
        return hostApi('write', { sessionId, text: input.text, hex: input.hex, newline: input.newline || 'none', dir: input.dir || 'TX' });
      },
      async update(patch) {
        return hostApi('update', { sessionId, opts: patch });
      },
      async setMergeMs(ms) {
        return hostApi('update', { sessionId, rxMergeMs: ms });
      },
      async close() {
        closed = true;
        if (timer) clearInterval(timer);
        return hostApi('close', { sessionId });
      },
    };
  }
}

// ── resolution ─────────────────────────────────────────────────────────
/**
 * Pick a backend: 'auto' → Web Serial (fast, local) then host; or force one.
 * Returns a backend instance or null when nothing is available.
 */
export async function resolveBackend(preference = 'auto') {
  if (preference === 'webserial') return WebSerialBackend.available() ? new WebSerialBackend() : null;
  if (preference === 'host') return (await HostSerialBackend.available()) ? new HostSerialBackend() : null;
  // auto: host first — authoritative full port list + full line params;
  // Web Serial (lists only user-granted ports) is the fallback.
  if (await HostSerialBackend.available()) return new HostSerialBackend();
  if (WebSerialBackend.available()) return new WebSerialBackend();
  return null;
}
