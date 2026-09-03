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

/** Drop keys whose value cannot survive a lossless JSON round trip
 *  (`undefined` / `NaN`). Own props with such values make the object
 *  non-lossless (JSON.stringify drops them → shape change), which dsh tool
 *  output boundaries reject ("value is not lossless JSON"). Also guards
 *  option merging from `undefined` overriding serialport defaults. */
function dropNonJson(rec) {
  return Object.fromEntries(
    Object.entries(rec).filter(([, v]) => v !== undefined && !(typeof v === 'number' && Number.isNaN(v))),
  );
}

/** Normalize an `extra.owner` tag: {kind:'agent'|'ui', id?} or null. */
function normalizeOwner(owner) {
  if (!owner || typeof owner !== 'object') return null;
  const kind = owner.kind === 'agent' || owner.kind === 'ui' ? owner.kind : null;
  if (!kind) return null;
  const id = kind === 'agent' && typeof owner.id === 'string' && owner.id ? owner.id : undefined;
  return { kind, id };
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

function startReadLoop(session, onClose) {
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
    onClose?.();
  });
}

/**
 * Create the serial service. Deliberately does NOT touch the cordis `ctx`
 * (no undeclared property access — cordis throws "cannot get property ...
 * without inject" for anything not in the plugin's inject list). Logging is
 * plain console (the host process's stdout lands in the desktop log).
 *
 * Injectable hooks (used by lib/index.js, left null in tests):
 *  - `loadSerialport`   fake native loader (tests inject a fake serialport)
 *  - `notifyOwner`      async ({session, action}) => notifyResult — fired when
 *                       a USER closes/updates an AGENT-owned port, so the dsh
 *                       action can be delivered back to the owning session.
 *  - `resolveOwnerTitle`(agentId) => string|undefined — dsh session title for
 *                       the occupancy view.
 *
 * Single-occupant model: one port path is held by ONE session at a time
 * (`byPath` lock). Opening an occupied path returns BUSY unless takeover;
 * opening the same sessionId again reopens (closes its own port first).
 */
export function createSerialService(options = {}) {
  const log = options.log || ((m) => console.log(`[dsh-shinki-serial-monitor] ${m}`));
  const sessions = new Map(); // sessionId -> Session
  const byPath = new Map();   // port path -> sessionId (single-occupant port lock)
  const { notifyOwner, resolveOwnerTitle } = options;

  /** Append one structured OPERATION event (AI tool call / user action). */
  function pushOp(session, entry) {
    if (!session) return null;
    const ts = Date.now();
    const ev = { seq: ++session.opSeq, tsMs: ts, iso: new Date(ts).toISOString(), ...entry };
    session.opLog.push(ev);
    return ev;
  }

  /** Short human cfg summary: 115200/8N1[,flow]. */
  function cfgTextOf(opts) {
    if (!opts) return '';
    const p = ((opts.parity || 'none')[0] || 'n').toUpperCase();
    return `${opts.baudRate ?? '?'}/${opts.dataBits ?? 8}${p}${opts.stopBits ?? 1}` + (opts.flowControl && opts.flowControl !== 'none' ? `,${opts.flowControl}` : '');
  }

  function actorName(actor) { return actor === 'agent' ? 'AI' : actor === 'user' ? '用户' : '系统'; }

  /** Injected fake loader (tests) OR the module-level real serialport loader. */
  async function loadNative() {
    if (typeof options.loadSerialport === 'function') return options.loadSerialport();
    return loadSerialport();
  }

  /** Idempotent removal of one session from the registry + the port lock. */
  function dropSession(session) {
    if (!session) return;
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    const path = session.info?.path;
    if (path && byPath.get(path) === session.id) byPath.delete(path);
  }

  /** Whether the host serialport backend is available right now. */
  async function available() {
    return isAvailable(await loadNative());
  }

  /** Enumerate serial ports (USB descriptors mapped to SerialPortInfo). */
  async function list() {
    const m = await loadNative();
    if (!isAvailable(m)) throw err(E.UNAVAILABLE, 'serialport 未安装，仅 Web Serial 后端可用');
    const ports = await m.SerialPort.list();
    return ports.map((p) =>
      // Descriptor-less virtual ports (e.g. macOS /dev/tty.debug-console and
      // /dev/tty.Bluetooth-Incoming-Port carry only `path`) would map to own
      // props holding `undefined` — JSON round-trip drops those keys, making
      // the whole result non-lossless and rejected by the dsh tool boundary.
      dropNonJson({
        path: p.path,
        label: p.friendlyName || p.manufacturer || p.path,
        vendorId: p.vendorId,
        productId: p.productId,
        serialNumber: p.serialNumber,
        manufacturer: p.manufacturer,
        usbVendorId: p.vendorId ? parseInt(p.vendorId, 16) : undefined,
        usbProductId: p.productId ? parseInt(p.productId, 16) : undefined,
      }),
    );
  }

  /**
   * Open a port for `sessionId` (single-occupant per port path).
   *
   * - Reopens (closes previous) when the SAME sessionId already holds a port.
   * - When ANOTHER session already holds the same path → `BUSY` unless
   *   `extra.takeover` is set (the other session is closed first).
   * - `extra.owner` records who opened it: `{kind:'agent', id:<dsh session id>}`
   *   from the serial_* tools, `{kind:'ui'}` from the UI host backend. This is
   *   the "which session occupies which port" fact the occupancy view shows,
   *   and user close/update actions are notified back to that agent session.
   * `opts` merges over DEFAULT_OPTIONS; `extra` carries per-session display
   * settings (encoding / hexMode / rxMergeMs) + owner.
   */
  async function open(sessionId, path, opts = {}, extra = {}) {
    if (typeof sessionId !== 'string' || sessionId === '') throw err(E.BAD_REQUEST, '缺少 sessionId');
    const m = await loadNative();
    if (!isAvailable(m)) throw err(E.UNAVAILABLE, 'serialport 未安装，仅 Web Serial 后端可用');
    // Same sessionId reopens its own port → close the old one first (a reopen is
    // NOT a user action, so it never notifies the owner).
    if (sessions.has(sessionId)) await close(sessionId);

    const holderId = byPath.get(path);
    if (holderId && holderId !== sessionId) {
      if (extra.takeover !== true) {
        const occupant = sessions.get(holderId);
        let occText;
        if (occupant?.owner?.kind === 'agent') occText = `AI 会话 ${occupant.owner.id}（占用 sessionId ${holderId}）`;
        else if (occupant?.owner?.kind === 'ui') occText = `本地面板（占用 sessionId ${holderId}）`;
        else occText = `会话 ${holderId}`;
        throw err(E.BUSY, `串口 ${path} 已被 ${occText}占用；可用 serial_close 关闭该会话、serial_open(takeover:true) 接管，或在「串口占用」面板关闭后重试`);
      }
      await close(holderId); // explicit takeover
    }

    // 过滤 undefined，避免覆盖默认值导致 SetCommState 失败 / 输出非 lossless JSON
    const merged = { ...DEFAULT_OPTIONS, ...dropNonJson(opts) };
    const SerialPort = m.SerialPort;
    const port = new SerialPort({ path, ...merged, autoOpen: false });
    await new Promise((resolve, reject) => {
      port.open((e) => (e ? reject(e) : resolve()));
    });

    const session = {
      id: sessionId,
      info: { path, label: String(extra.label || path) },
      port,
      opts: merged,
      encoding: labelByName(extra.encoding),
      hexMode: extra.hex === true,
      owner: normalizeOwner(extra.owner),
      openedAt: Date.now(),
      log: new RingBuffer(DEFAULT_LOG_MAX),
      seq: 0,
      opLog: new RingBuffer(DEFAULT_LOG_MAX),
      opSeq: 0,
      listeners: new Set(),
      splitter: null,
      rxMergeMs: Math.max(0, Number(extra.rxMergeMs) || 0),  // 默认 0 = 立即模式（chunk-immediate，不做窗口合并）
      error: null,
      closed: false,
      writeChain: Promise.resolve(),
    };
    byPath.set(path, sessionId);
    sessions.set(sessionId, session);
    startReadLoop(session, () => dropSession(session));
    const openActor = session.owner?.kind === 'agent' ? 'agent' : session.owner?.kind === 'ui' ? 'user' : 'system';
    pushOp(session, {
      actor: openActor,
      name: openActor === 'agent' ? 'serial_open' : openActor === 'user' ? 'ui_open' : 'open',
      text: `${actorName(openActor)}打开串口 ${path}（${cfgTextOf(merged)}${session.encoding !== 'utf-8' ? `，编码 ${session.encoding}` : ''}${session.hexMode ? '，HEX' : ''}）`,
    });
    log(`[serial] open ${path} @${merged.baudRate} (${session.owner ? (session.owner.kind === 'agent' ? `agent:${session.owner.id}` : 'ui') : 'unknown'})`);
    return { sessionId, opened: true, opts: merged, info: session.info, owner: session.owner };
  }

  function _get(sessionId) {
    const s = sessions.get(sessionId);
    if (!s || s.closed) throw err(E.NOT_OPEN, '串口未打开');
    return s;
  }

  /** Write bytes; appends a TX/Q/AR LogLine. Single-writer lock serializes.
   *  `opts.actor` ('agent'|'user') additionally records the write as an op event
   *  (agent tools pass 'agent'; the UI HTTP write is already visible as TX). */
  async function write(sessionId, bytes, dir = 'TX', opts = {}) {
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
    if (opts.actor === 'agent' || opts.actor === 'user') {
      pushOp(session, { actor: opts.actor, name: 'serial_write', text: `${actorName(opts.actor)}发送 ${data.length} 字节（${dir}）` });
    }
    return { ok: true, bytes: data.length, tsMs: Date.now() };
  }

  /** Last N LogLines (default 50). Includes the session's hexMode so the
   *  agent tools can render hex (instead of decoded text) for HEX-mode
   *  sessions — binary streams are unreadable as utf-8 mojibake. */
  async function readLines(sessionId, limit = 50) {
    const session = _get(sessionId);
    const arr = session.log.toArray();
    return { lines: arr.slice(Math.max(0, arr.length - limit)), hexMode: session.hexMode === true };
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
    return { lines: lines.slice(Math.max(0, lines.length - limit)), total: session.log.length, hexMode: session.hexMode === true };
  }

  /** Update port params (serialport supports runtime update; Web Serial reopens). */
  async function update(sessionId, opts = {}, extra = {}) {
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
    const wasUserChange = extra.notifyOwner === true;
    let notify = null;
    if (wasUserChange && session.owner?.kind === 'agent' && typeof notifyOwner === 'function') {
      try {
        notify = (await notifyOwner({ session, action: { kind: 'update', changes: { ...portOpts }, opts: { ...session.opts } } })) ?? null;
      } catch (e) {
        notify = { delivered: false, error: String(e?.message ?? e) };
      }
    }
    if (wasUserChange) {
      const parts = Object.entries(portOpts).map(([k, v]) => `${k}=${v}`).join('、');
      pushOp(session, {
        actor: 'user', name: 'ui_update', delivered: notify?.delivered ?? null,
        text: `用户修改参数${parts ? `：${parts}` : ''}（当前 ${cfgTextOf(session.opts)}${notify?.delivered === true ? '，已通知 AI 会话' : notify ? '，通知 AI 失败' : '，无 AI 占用会话'}）`,
      });
    }
    return { sessionId, ok: true, opts: session.opts, rxMergeMs: session.rxMergeMs, notify };
  }

  /** Close the port and drop the session. */
  async function close(sessionId, opts = {}) {
    const session = sessions.get(sessionId);
    if (!session) return { ok: true, closed: false };
    // A USER closing an agent-owned port is reported back to the owning session
    // (the agent's own serial_close tool never notifies itself).
    let notify = null;
    if (opts.notifyOwner === true && session.owner?.kind === 'agent' && typeof notifyOwner === 'function') {
      try {
        notify = (await notifyOwner({ session, action: { kind: 'close', reason: opts.reason } })) ?? null;
      } catch (e) {
        notify = { delivered: false, error: String(e?.message ?? e) };
      }
    }
    const closeActor = opts.actor === 'agent' ? 'agent' : opts.notifyOwner === true ? 'user' : null;
    if (closeActor) {
      pushOp(session, {
        actor: closeActor,
        name: closeActor === 'agent' ? 'serial_close' : 'ui_close',
        ...(closeActor === 'user' ? { delivered: notify?.delivered ?? null } : {}),
        text: closeActor === 'agent'
          ? `AI关闭串口 ${session.info?.path ?? session.id}`
          : `用户关闭串口 ${session.info?.path ?? session.id}（${notify?.delivered === true ? '已通知 AI 会话' : notify ? '通知 AI 失败' : '无 AI 占用会话'}）`,
      });
    }
    dropSession(session);
    try { session.splitter?.flush(); } catch { /* ignore */ }
    try {
      if (session.port && session.port.isOpen) {
        await new Promise((resolve) => session.port.close(() => resolve()));
      }
    } catch { /* ignore */ }
    session.closed = true;
    session.listeners.clear();
    log(`[serial] close ${session.info?.path ?? sessionId}`);
    return { ok: true, closed: true, notify };
  }

  /** Subscribe to live LogLines of one session; returns a disposer. */
  function subscribe(sessionId, fn) {
    const session = sessions.get(sessionId);
    if (!session) return () => {};
    session.listeners.add(fn);
    return () => session.listeners.delete(fn);
  }

  /** Operation events (AI tool calls + user actions) of one session. */
  function opEvents(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return { events: [] };
    return { events: s.opLog.toArray() };
  }

  /** Append an op event from outside (agent tools record query-style calls). */
  function opRecord(sessionId, entry) {
    const s = sessions.get(sessionId);
    if (!s) return null;
    return pushOp(s, { actor: 'agent', ...entry });
  }

  /** Snapshot of open sessions for the occupancy view: who holds which port,
   *  the live params, the AI-side display config (encoding/hexMode), and an
   *  optional owner title resolved by the injected host hook. */
  function stats() {
    const out = [];
    for (const s of sessions.values()) {
      const row = {
        sessionId: s.id,
        path: s.info?.path ?? null,
        label: s.info?.label ?? null,
        opts: s.opts,
        encoding: s.encoding,
        hexMode: s.hexMode === true,
        rxMergeMs: s.rxMergeMs,
        openedAt: s.openedAt ?? null,
        logLines: s.log.length,
        owner: s.owner,
        ownerTitle: null,
      };
      if (s.owner?.kind === 'agent' && typeof resolveOwnerTitle === 'function') {
        try { row.ownerTitle = resolveOwnerTitle(s.owner.id) ?? null; } catch { /* best effort */ }
      }
      out.push(row);
    }
    return { sessions: out };
  }

  return {
    available, list, open, write, readLines, getLog, update, close, subscribe, stats, opEvents, opRecord,
  };
}
