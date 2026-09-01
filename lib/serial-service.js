/**
 * Host serial service (M1 core data plane): session registry + bounded
 * ms-timestamped LogLine log + single-writer lock, backed by the `serialport`
 * native module (lazily imported; degrades gracefully to "unavailable" when
 * the module is not installed, leaving the Web Serial UI backend as the
 * only transport).
 *
 * Shared by:
 *  - HTTP routes (lib/routes.js)  → UI host backend
 *  - agent tools (lib/tools.js)   → serial_* tools (G1)
 *  - future WS streaming (lib/ws.js)
 */
import { RingBuffer, TimeWindowMerger } from './buffer.js';
import { labelByName } from './codecs.js';
import { buildLogLine } from './logline.js';
import { DEFAULT_OPTIONS } from './presets.js';

export const E = {
  UNAVAILABLE: 'serial-unavailable',
  NOT_OPEN: 'serial-not-open',
  NOT_FOUND: 'port-not-found',
  BUSY: 'port-busy',
  BAD_REQUEST: 'bad-request',
};

const DEFAULT_LOG_MAX = 10000;

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Lazy native-module loader: undefined = not attempted, null = failed.
let serialportModule;
async function loadSerialport() {
  if (serialportModule !== undefined) return serialportModule;
  try {
    serialportModule = await import('serialport');
  } catch {
    serialportModule = null;
  }
  return serialportModule;
}
function isAvailable(m) { return m != null; }

/** Build one LogLine for a session (shared by RX and TX paths). */
function toLogLine(session, dir, bytes, tsMs) {
  return buildLogLine({
    dir, bytes,
    hexMode: session.hexMode,
    encoding: session.encoding,
    seq: ++session.seq,
    tsMs,
  });
}

function emitLine(session, line) {
  for (const fn of session.listeners) {
    try { fn(line); } catch { /* listener errors never break the stream */ }
  }
}

function startReadLoop(session) {
  // RX coalescing: bytes are assembled into ONE LogLine per window (default
  // 100ms, configurable via session.rxMergeMs). Bursty binary/hex streams no
  // longer produce a line per tiny chunk; windowMs=0 disables merging.
  const windowMs = session.rxMergeMs ?? 100;
  const merge = new TimeWindowMerger((bytes) => {
    const line = toLogLine(session, 'RX', bytes, Date.now());
    session.log.push(line);
    emitLine(session, line);
  }, { windowMs });
  session.merge = merge;
  session.port.on('data', (buf) => {
    try { merge.push(new Uint8Array(buf)); } catch { /* ignore */ }
  });
  session.port.on('error', (e) => { session.error = String(e?.message ?? e); });
  session.port.on('close', () => {
    try { merge.flush(); } catch { /* ignore */ }
    session.closed = true;
  });
}

/**
 * Create the serial service. Deliberately does NOT touch the cordis `ctx`
 * (no undeclared property access — cordis throws "cannot get property ...
 * without inject" for anything not in the plugin's inject list). Logging is
 * plain console (the host process's stdout lands in the desktop log).
 */
export function createSerialService() {
  const log = (m) => console.log(`[dsh-shinki-serial-monitor] ${m}`);
  const sessions = new Map(); // sessionId -> Session

  /** Whether the host serialport backend is available right now. */
  async function available() {
    return isAvailable(await loadSerialport());
  }

  /** Enumerate serial ports (USB descriptors mapped to SerialPortInfo). */
  async function list() {
    const m = await loadSerialport();
    if (!isAvailable(m)) throw err(E.UNAVAILABLE, 'serialport 未安装，仅 Web Serial 后端可用');
    const ports = await m.SerialPort.list();
    return ports.map((p) => ({
      path: p.path,
      label: p.friendlyName || p.manufacturer || p.path,
      vendorId: p.vendorId,
      productId: p.productId,
      serialNumber: p.serialNumber,
      manufacturer: p.manufacturer,
      usbVendorId: p.vendorId ? parseInt(p.vendorId, 16) : undefined,
      usbProductId: p.productId ? parseInt(p.productId, 16) : undefined,
    }));
  }

  /**
   * Open a port for `sessionId`. Reopens (closes previous) when the same
   * sessionId already holds a port. `opts` merges over DEFAULT_OPTIONS;
   * `extra` carries per-session display settings (encoding / hexMode).
   */
  async function open(sessionId, path, opts = {}, extra = {}) {
    if (typeof sessionId !== 'string' || sessionId === '') throw err(E.BAD_REQUEST, '缺少 sessionId');
    const m = await loadSerialport();
    if (!isAvailable(m)) throw err(E.UNAVAILABLE, 'serialport 未安装，仅 Web Serial 后端可用');
    if (sessions.has(sessionId)) await close(sessionId);

    // 过滤 undefined，避免覆盖默认值导致 SetCommState 失败 / 输出非 lossless JSON
    const clean = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined && !(typeof v === 'number' && Number.isNaN(v))));
    const merged = { ...DEFAULT_OPTIONS, ...clean };
    const SerialPort = m.SerialPort;
    const port = new SerialPort({ path, ...merged, autoOpen: false });
    await new Promise((resolve, reject) => {
      port.open((e) => (e ? reject(e) : resolve()));
    });

    const session = {
      id: sessionId,
      info: { path, label: path },
      port,
      opts: merged,
      encoding: labelByName(extra.encoding),
      hexMode: extra.hex === true,
      log: new RingBuffer(DEFAULT_LOG_MAX),
      seq: 0,
      listeners: new Set(),
      splitter: null,
      rxMergeMs: Math.max(0, Number(extra.rxMergeMs) || 0),  // 默认 0 = 立即模式（chunk-immediate，不做窗口合并）
      error: null,
      closed: false,
      writeChain: Promise.resolve(),
    };
    sessions.set(sessionId, session);
    startReadLoop(session);
    log(`[serial] open ${path} @${merged.baudRate}`);
    return { sessionId, opened: true, opts: merged, info: session.info };
  }

  function _get(sessionId) {
    const s = sessions.get(sessionId);
    if (!s || s.closed) throw err(E.NOT_OPEN, '串口未打开');
    return s;
  }

  /** Write bytes; appends a TX/Q/AR LogLine. Single-writer lock serializes. */
  async function write(sessionId, bytes, dir = 'TX') {
    const session = _get(sessionId);
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const task = session.writeChain.then(async () => {
      await new Promise((resolve, reject) => {
        session.port.write(data, (e) => (e ? reject(e) : resolve()));
      });
      const ts = Date.now();
      const line = toLogLine(session, dir, data, ts);
      session.log.push(line);
      emitLine(session, line);
    });
    session.writeChain = task.catch(() => {});
    await task;
    return { ok: true, bytes: data.length, tsMs: Date.now() };
  }

  /** Last N LogLines (default 50). */
  async function readLines(sessionId, limit = 50) {
    const session = _get(sessionId);
    const arr = session.log.toArray();
    return { lines: arr.slice(Math.max(0, arr.length - limit)) };
  }

  /** Filtered structured log query (agent / UI history). */
  async function getLog(sessionId, opts = {}) {
    const session = _get(sessionId);
    const { since, level, dir, limit = 500 } = opts;
    let lines = session.log.toArray();
    if (since != null && Number.isFinite(Number(since))) {
      const t = Number(since);
      lines = lines.filter((l) => l.tsMs >= t);
    }
    if (level) lines = lines.filter((l) => l.level === level);
    if (dir) lines = lines.filter((l) => l.dir === dir);
    return { lines: lines.slice(Math.max(0, lines.length - limit)), total: session.log.length };
  }

  /** Update port params (serialport supports runtime update; Web Serial reopens). */
  async function update(sessionId, opts = {}) {
    const session = _get(sessionId);
    // rxMergeMs is a monitor-level setting (coalesce window), not a serialport
    // param — apply it to the coalescer at runtime, keep it out of port.update().
    if (opts.rxMergeMs != null) {
      session.rxMergeMs = Math.max(0, Number(opts.rxMergeMs) || 0);
      session.merge?.setWindowMs?.(session.rxMergeMs);
    }
    const portOpts = { ...opts };
    delete portOpts.rxMergeMs;
    if (Object.keys(portOpts).length > 0) {
      const patch = { ...session.opts, ...portOpts };
      await new Promise((resolve, reject) => {
        session.port.update(patch, (e) => (e ? reject(e) : resolve()));
      });
      session.opts = patch;
    }
    return { sessionId, ok: true, opts: session.opts, rxMergeMs: session.rxMergeMs };
  }

  /** Close the port and drop the session. */
  async function close(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return { ok: true, closed: false };
    sessions.delete(sessionId);
    try { session.splitter?.flush(); } catch { /* ignore */ }
    try {
      if (session.port && session.port.isOpen) {
        await new Promise((resolve) => session.port.close(() => resolve()));
      }
    } catch { /* ignore */ }
    session.closed = true;
    session.listeners.clear();
    log(`[serial] close ${session.info?.path ?? sessionId}`);
    return { ok: true, closed: true };
  }

  /** Subscribe to live LogLines of one session; returns a disposer. */
  function subscribe(sessionId, fn) {
    const session = sessions.get(sessionId);
    if (!session) return () => {};
    session.listeners.add(fn);
    return () => session.listeners.delete(fn);
  }

  /** Snapshot of open sessions (paths + counts) for status/debug. */
  function stats() {
    const out = [];
    for (const s of sessions.values()) {
      out.push({ sessionId: s.id, path: s.info?.path, opts: s.opts, logLines: s.log.length });
    }
    return { sessions: out };
  }

  return {
    available, list, open, write, readLines, getLog, update, close, subscribe, stats,
  };
}
