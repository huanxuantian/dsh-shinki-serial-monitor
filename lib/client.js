/*!
 * dsh-shinki-serial-monitor client bundle (browser half).
 *
 * Registers a bottom-panel tab ("串口监视器") through dsh-better-sidebar's
 * `ctx.betterSidebar` service and renders a minimal-but-functional serial
 * monitor: port detection (Web Serial / host), HEX + text RX/TX, encoding
 * switch, ms-timestamped LogLine stream with level coloring, and a
 * "recording" indicator (goal G3).
 *
 * The browser bundle is self-contained (ModuleLoader resolves only
 * dsh-provided modules), so the shared pure utils below are INLINED copies
 * of lib/{codecs,levels,buffer,presets,logline,bottom-dock,serial-backend}.js
 * — keep them in sync with the host-side originals (same policy as the
 * git-graph plugin's inlined lanes.js).
 */
window.__ModuleLoader__.load({
  id: 'dsh-shinki-serial-monitor',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    let react = require('react');
    let primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const { useState, useEffect, useRef, useCallback, Fragment } = react;
    const h = (type, props, ...children) => react.createElement(type, props ?? null, ...children);

    // ══════════════════════════════════════════════════════════════════
    // INLINED SHARED UTILS (keep in sync with lib/*.js)
    // ══════════════════════════════════════════════════════════════════

    // ── locales (inlined from lib/locales.js — the self-contained client
    //    bundle cannot require sibling files, so keep this in sync) ─────
    const NS = 'serialMonitor';
    const zh = {
      tabTitle: '串口监视器',
      refresh: '刷新端口',
      addPort: '添加端口…',
      open: '打开',
      close: '关闭',
      statusIdle: '未连接',
      statusOpening: '连接中…',
      statusOpen: '已连接',
      statusError: '错误',
      statusClosed: '已关闭',
      recording: '● 采集中',
      modeText: '文本',
      modeHex: 'HEX',
      modeEsc: '转义',
      displayMode: '显示',
      autoScrollOn: '⬇ 自动滚动',
      backToBottom: '⬇ 回到底部',
      send: '发送',
      clear: '清屏',
      settings: '设置',
      portPlaceholder: '选择端口…',
      baud: '波特率',
      encoding: '编码',
      timestamp: '时间戳',
      params: '参数',
      customBaud: '自定义…',
      dataBits: '数据位',
      parity: '校验',
      stopBits: '停止位',
      flowControl: '流控',
      paramsHint: '高级参数：Web Serial 仅 7/8 数据位、none/even/odd 校验、1/2 停止位、none/hardware 流控；完整参数请用 Host 后端',
      setCustomBaud: '自定义波特率',
      setDataBits: '数据位（默认）',
      setParity: '校验（默认）',
      setStopBits: '停止位（默认）',
      setFlowControl: '流控（默认）',
      noSerial: '当前环境不支持 Web Serial，且 host 后端不可用（请确认 dsh 已安装 serialport）',
      noPort: '未检测到可用串口',
      selectPortFirst: '请先选择端口',
      backend: '串口后端',
      backendAuto: '自动',
      backendWs: 'Web Serial',
      backendHost: 'Host',
      setAutoOpen: '启动自动打开',
      setDefaultBaud: '默认波特率',
      setDefaultMode: '默认模式',
      setRxMaxLines: '接收最大行数',
      setRxMergeMs: '合并间隔(ms)：将窗口内接收数据合并为一行（0=不合并）',
      mergeMs: '合并',
      setBackend: '串口后端',
      emptyRx: '（等待接收数据…）',
      txPrefix: '→ TX',
      qPrefix: '→ Q',
      arPrefix: '→ AR',
    };
    const en = {
      tabTitle: 'Serial Monitor',
      refresh: 'Refresh ports',
      addPort: 'Add port…',
      open: 'Open',
      close: 'Close',
      statusIdle: 'Disconnected',
      statusOpening: 'Connecting…',
      statusOpen: 'Connected',
      statusError: 'Error',
      statusClosed: 'Closed',
      recording: '● Recording',
      modeText: 'Text',
      modeHex: 'HEX',
      modeEsc: 'Esc',
      displayMode: 'Display',
      autoScrollOn: '↓ Auto-scroll',
      backToBottom: '↓ Back to bottom',
      send: 'Send',
      clear: 'Clear',
      settings: 'Settings',
      portPlaceholder: 'Select port…',
      baud: 'Baud',
      encoding: 'Encoding',
      timestamp: 'Timestamp',
      params: 'Params',
      customBaud: 'Custom…',
      dataBits: 'Data bits',
      parity: 'Parity',
      stopBits: 'Stop bits',
      flowControl: 'Flow',
      paramsHint: 'Advanced: Web Serial only supports 7/8 data bits, none/even/odd parity, 1/2 stop bits, none/hardware flow; use Host backend for the full set',
      setCustomBaud: 'Custom baud rate',
      setDataBits: 'Data bits (default)',
      setParity: 'Parity (default)',
      setStopBits: 'Stop bits (default)',
      setFlowControl: 'Flow control (default)',
      noSerial: 'Web Serial is unavailable and the host backend is down (install serialport for dsh).',
      noPort: 'No serial ports found',
      selectPortFirst: 'Select a port first',
      backend: 'Backend',
      backendAuto: 'Auto',
      backendWs: 'Web Serial',
      backendHost: 'Host',
      setAutoOpen: 'Auto-open on start',
      setDefaultBaud: 'Default baud rate',
      setDefaultMode: 'Default mode',
      setRxMaxLines: 'Max RX lines',
      setRxMergeMs: 'RX merge window (ms): coalesce RX per window (0=off)',
      mergeMs: 'Merge',
      setBackend: 'Backend',
      emptyRx: '(waiting for data…)',
      txPrefix: '→ TX',
      qPrefix: '→ Q',
      arPrefix: '→ AR',
    };

    // ── codecs (lib/codecs.js) ─────────────────────────────────────────
    const TEXT_ENCODINGS = [
      ['ASCII（默认）', 'utf-8'], ['UTF-8', 'utf-8'], ['GBK', 'gbk'],
      ['GB2312', 'gbk'], ['GB18030', 'gb18030'], ['BIG5', 'big5'],
      ['UTF-16 LE', 'utf-16le'], ['UTF-16 BE', 'utf-16be'],
      ['Latin-1', 'windows-1252'], ['Windows-1252', 'windows-1252'],
      ['Shift-JIS', 'shift_jis'], ['EUC-KR', 'euc-kr'],
    ];
    const DEFAULT_ENCODING_LABEL = 'utf-8';
    const labelByName = (name) => {
      for (const [display, label] of TEXT_ENCODINGS) if (display === name) return label;
      return DEFAULT_ENCODING_LABEL;
    };
    const decodeBytes = (bytes, label = DEFAULT_ENCODING_LABEL) => {
      try { return new TextDecoder(label).decode(bytes); }
      catch { try { return new TextDecoder(DEFAULT_ENCODING_LABEL).decode(bytes); } catch { return String.fromCharCode(...bytes); } }
    };
    const encodeText = (text) => new TextEncoder().encode(text); // UTF-8 only (TextEncoder limitation)
    const formatHex = (bytes, sep = ' ') => {
      const out = [];
      for (const b of bytes) out.push(b.toString(16).toUpperCase().padStart(2, '0'));
      return out.join(sep);
    };
    // Escaped view: printable ASCII kept as-is, CR/LF rendered as real line
    // breaks (not \x0D/\x0A), everything else as \xHH. Ideal for mixed
    // binary+ASCII streams (like a plain serial tool).
    const escFromHex = (hex) => (hex || '').split(' ').map((h) => {
      const n = parseInt(h, 16);
      if (n === 0x0a) return '\n';
      if (n === 0x0d) return '\r';
      return n >= 0x20 && n <= 0x7e ? String.fromCharCode(n) : '\\x' + h;
    }).join('');
    const parseHex = (hexStr) => {
      const s = String(hexStr).replace(/[\s\t\r\n,;]/g, '');
      if (!s) return new Uint8Array(0);
      if (s.length % 2 !== 0) throw new Error('HEX 长度必须为偶数');
      if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error('HEX 包含非法字符');
      const out = new Uint8Array(s.length / 2);
      for (let i = 0; i < out.length; i += 1) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
      return out;
    };
    const pad2 = (n, w = 2) => String(n).padStart(w, '0');
    const formatTimestamp = (tsMs, fmt = '%H:%M:%S.%f') => {
      const d = new Date(tsMs);
      const tokens = {
        '%Y': String(d.getFullYear()), '%H': pad2(d.getHours()),
        '%M': pad2(d.getMinutes()), '%S': pad2(d.getSeconds()),
        '%f': pad2(d.getMilliseconds(), 3),
      };
      return String(fmt).replace(/%[YHMSf]/g, (m) => tokens[m] ?? m);
    };

    // ── levels (lib/levels.js) ─────────────────────────────────────────
    const LEVEL_FOREGROUND = { V: '#8A8A8A', D: '#4D96FF', I: '#2E9E4F', W: '#E6A23C', E: '#E6533C' };
    const detectLevel = (() => {
      const ULOG = /^\[([VDIWE])\s*\/\s*[^\]]*\]/i;
      const ANGLE = /^<([A-Za-z]+)>/;
      const SQUARE = /^\[([VDIWE])\]/i;
      const PREFIX = /^([A-Za-z]+)[:：]\s*/;
      const L = { v: 'V', d: 'D', i: 'I', w: 'W', e: 'E' };
      const W = { verbose: 'V', verb: 'V', debug: 'D', dbg: 'D', info: 'I', inf: 'I', warn: 'W', warning: 'W', error: 'E', err: 'E', fail: 'E', failed: 'E', fatal: 'E', fault: 'E', exception: 'E', abort: 'E', panic: 'E', assert: 'E' };
      const ERR = /\b(error|fail|failed|fault|fatal|exception|panic|assert|abort)\b/i;
      const WRN = /\b(warn|warning)\b/i;
      const DBG = /\b(debug|dbg)\b/i;
      return (line) => {
        const s = String(line).replace(/^\s+/, '');
        let m = ULOG.exec(s); if (m) return L[m[1].toLowerCase()] ?? 'I';
        m = ANGLE.exec(s); if (m) return W[m[1].toLowerCase()] ?? 'I';
        m = SQUARE.exec(s); if (m) return L[m[1].toLowerCase()] ?? 'I';
        m = PREFIX.exec(s); if (m) return W[m[1].toLowerCase()] ?? 'I';
        const low = s.toLowerCase();
        if (ERR.test(low)) return 'E';
        if (WRN.test(low)) return 'W';
        if (DBG.test(low)) return 'D';
        return 'I';
      };
    })();

    // ── buffer (lib/buffer.js) ─────────────────────────────────────────
    class LineSplitter {
      constructor(onLine, opts = {}) {
        this.onLine = onLine;
        this.keepEmpty = opts.keepEmpty ?? true;
        this.maxLineBytes = opts.maxLineBytes ?? 4096;
        this._p = []; this._pl = 0; this._cr = false;
      }
      push(chunk) {
        for (const byte of chunk) {
          if (byte === 0x0a) { if (this._cr) { this._cr = false; continue; } this._emit(this._p); this._p = []; this._pl = 0; }
          else if (byte === 0x0d) { this._emit(this._p); this._p = []; this._pl = 0; this._cr = true; }
          else { if (this._cr) this._cr = false; if (this._pl < this.maxLineBytes) { this._p.push(byte); this._pl += 1; } }
        }
      }
      flush() {
        if (this._pl > 0) { this._emit(this._p); this._p = []; this._pl = 0; }
        this._cr = false;
      }
      _emit(line) {
        if (line.length === 0 && !this.keepEmpty) return;
        this.onLine(new Uint8Array(line));
      }
    }
    // Time-window coalescer (lib/buffer.js): accumulate bytes, emit one chunk
    // per windowMs so bursty binary streams don't become one line per chunk.
    class TimeWindowMerger {
      constructor(onChunk, opts = {}) {
        this.onChunk = onChunk;
        this.windowMs = Math.max(0, opts.windowMs ?? 100);
        this.maxBytes = opts.maxBytes ?? 8192;
        this._buf = []; this._len = 0; this._timer = null;
      }
      push(chunk) {
        for (const b of chunk) { if (this._len < this.maxBytes) { this._buf.push(b); this._len += 1; } }
        this._schedule();
      }
      _schedule() {
        if (this._timer) return;
        this._timer = setTimeout(() => { this._timer = null; this.flush(); }, this.windowMs);
      }
      setWindowMs(ms) {
        this.windowMs = Math.max(0, ms ?? 100);
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this._len > 0) this._schedule();
      }
      flush() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this._len > 0) {
          const out = new Uint8Array(this._buf);
          this._buf = []; this._len = 0;
          this.onChunk(out);
        }
      }
    }

    // ── presets (lib/presets.js) ───────────────────────────────────────
    const COMMON_BAUDRATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 500000, 576000, 921600, 1000000, 1500000, 2000000, 3000000, 4000000];
    const DEFAULT_OPTIONS = { baudRate: 115200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' };
    const WEB_SERIAL_LIMITS = { dataBits: [7, 8], parity: ['none', 'even', 'odd'], stopBits: [1, 2], flowControl: ['none', 'hardware'] };
    const clampOptions = (opts, supported) => {
      const out = { ...opts };
      if (supported?.dataBits && !supported.dataBits.includes(out.dataBits)) out.dataBits = DEFAULT_OPTIONS.dataBits;
      if (supported?.parity && !supported.parity.includes(out.parity)) out.parity = DEFAULT_OPTIONS.parity;
      if (supported?.stopBits && !supported.stopBits.includes(out.stopBits)) out.stopBits = DEFAULT_OPTIONS.stopBits;
      if (supported?.flowControl && !supported.flowControl.includes(out.flowControl)) out.flowControl = DEFAULT_OPTIONS.flowControl;
      return out;
    };

    // ── logline (lib/logline.js) ───────────────────────────────────────
    function buildLogLine({ dir, bytes, text, hexMode = false, encoding = 'utf-8', seq = 0, tsMs = Date.now() }) {
      const resolvedText = text != null ? text : (bytes ? decodeBytes(bytes, encoding) : '');
      return {
        seq, tsMs, iso: new Date(tsMs).toISOString(), dir,
        level: dir === 'RX' ? detectLevel(resolvedText) : null,
        text: resolvedText,
        hex: bytes ? formatHex(bytes) : undefined,
        bytes: bytes ? bytes.length : 0,
      };
    }

    // ── bottom-dock (lib/bottom-dock.js) ───────────────────────────────
    function treeHasTab(node, tabId) {
      if (node.kind === 'leaf') return node.tabs.some((t) => t.id === tabId);
      return node.children.some((c) => treeHasTab(c, tabId));
    }
    function removeTabFromNode(node, tabId) {
      if (node.kind === 'leaf') {
        const idx = node.tabs.findIndex((t) => t.id === tabId);
        if (idx === -1) return null;
        const [tab] = node.tabs.splice(idx, 1);
        if (node.active === tabId) node.active = node.tabs[node.tabs.length - 1]?.id ?? null;
        return tab;
      }
      for (const child of node.children) { const tab = removeTabFromNode(child, tabId); if (tab) return tab; }
      return null;
    }
    function pruneEmpty(node) {
      if (node.kind === 'leaf') return node.tabs.length > 0 ? node : null;
      const children = node.children.map(pruneEmpty).filter(Boolean);
      if (children.length === 0) return null;
      if (children.length === 1) return children[0];
      return { ...node, children };
    }
    function firstLeaf(node) {
      if (node.kind === 'leaf') return node;
      return firstLeaf(node.children[0]);
    }
    function ensureBottomPanel(store, tabId) {
      if (!store || typeof store.update !== 'function') return false;
      store.update((draft) => {
        if (!draft || !draft.splits || !draft.bottomSplits) return;
        if (treeHasTab(draft.bottomSplits, tabId)) { draft.bottomOpen = true; return; }
        const removed = removeTabFromNode(draft.splits, tabId);
        if (!removed) return;
        const pruned = pruneEmpty(draft.splits);
        if (pruned) draft.splits = pruned;
        let leaf = firstLeaf(draft.bottomSplits);
        if (!leaf) {
          leaf = { kind: 'leaf', id: `serial-pane-${Math.random().toString(36).slice(2, 8)}`, tabs: [], active: null };
          draft.bottomSplits = leaf;
        }
        leaf.tabs.push(removed);
        leaf.active = tabId;
        draft.activePane = leaf.id;
        draft.bottomOpen = true;
      });
      return true;
    }

    // ── serial-backend (lib/serial-backend.js) ─────────────────────────
    const pathToPort = new Map();
    let portCounter = 0;
    const hex16 = (n) => (n ?? 0).toString(16).toUpperCase().padStart(4, '0');
    function wsPortInfo(port) {
      portCounter += 1;
      const gi = (typeof port.getInfo === 'function' ? port.getInfo() : {}) || {};
      const info = { path: `usb:${portCounter}`, label: `USB Serial ${hex16(gi.usbVendorId)}:${hex16(gi.usbProductId)}`, usbVendorId: gi.usbVendorId, usbProductId: gi.usbProductId };
      pathToPort.set(info.path, port);
      return info;
    }
    function buildWriteBytes(input, encoding) {
      let bytes;
      if (typeof input?.hex === 'string') bytes = parseHex(input.hex);
      else if (typeof input?.text === 'string') bytes = encodeText(input.text, encoding);
      else return null;
      const nl = input?.newline;
      if (nl === 'CRLF') { const o = new Uint8Array(bytes.length + 2); o.set(bytes); o.set([0x0d, 0x0a], bytes.length); return o; }
      if (nl === 'LF') { const o = new Uint8Array(bytes.length + 1); o.set(bytes); o[bytes.length] = 0x0a; return o; }
      if (nl === 'CR') { const o = new Uint8Array(bytes.length + 1); o.set(bytes); o[bytes.length] = 0x0d; return o; }
      return bytes;
    }
    class WebSerialBackend {
      constructor() { this.kind = 'webserial'; }
      static available() { return typeof navigator !== 'undefined' && 'serial' in navigator; }
      async list() { const ports = await navigator.serial.getPorts(); return ports.map(wsPortInfo); }
      async requestPort() { const port = await navigator.serial.requestPort(); return wsPortInfo(port); }
      onConnect(cb) { const fn = (e) => cb(wsPortInfo(e.target)); navigator.serial.addEventListener('connect', fn); return () => navigator.serial.removeEventListener('connect', fn); }
      onDisconnect(cb) { const fn = (e) => cb(wsPortInfo(e.target)); navigator.serial.addEventListener('disconnect', fn); return () => navigator.serial.removeEventListener('disconnect', fn); }
      async open(info, opts, cfg = {}) {
        const port = pathToPort.get(info?.path);
        if (!port) throw new Error('串口对象不可用，请重新选择端口');
        const clamped = clampOptions(opts, WEB_SERIAL_LIMITS);
        await port.open({ baudRate: clamped.baudRate, dataBits: clamped.dataBits, parity: clamped.parity, stopBits: clamped.stopBits, flowControl: clamped.flowControl });
        const reader = port.readable.getReader();
        const writer = port.writable.getWriter();
        let seq = 0, closed = false, loglineCb = null, merge = null;
        const encoding = cfg.encoding || 'utf-8';
        const hexMode = cfg.hex === true;
        const rxMergeMs = Math.max(0, Number(cfg.rxMergeMs) || 100);
        const emit = (dir, bytes) => { const l = buildLogLine({ dir, bytes, hexMode, encoding, seq: ++seq, tsMs: Date.now() }); if (loglineCb) loglineCb(l); return l; };
        return {
          info, opts: clamped,
          async read(onLogLine) {
            loglineCb = onLogLine;
            merge = new TimeWindowMerger((bytes) => { onLogLine(buildLogLine({ dir: 'RX', bytes, hexMode, encoding, seq: ++seq, tsMs: Date.now() })); }, { windowMs: rxMergeMs });
            while (!closed) {
              try { const { value, done } = await reader.read(); if (done) break; if (value) merge.push(new Uint8Array(value)); } catch { break; }
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
          async update() { throw new Error('Web Serial 不支持运行时改参数，请关闭后重开'); },
          async close() { closed = true; try { await reader.cancel(); } catch {} try { writer.releaseLock(); } catch {} try { await port.close(); } catch {} },
        };
      }
    }
    async function hostApi(method, payload, signal) {
      const res = await fetch('/shinki-serial/api', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, ...payload }), signal,
      });
      const body = await res.json().catch(() => ({ ok: false, error: { code: 'bad-response', message: '无效响应' } }));
      if (!res.ok || body.ok !== true) { const e = new Error(body?.error?.message ?? `HTTP ${res.status}`); e.code = body?.error?.code ?? 'http-' + res.status; throw e; }
      return body.value;
    }
    class HostSerialBackend {
      constructor() { this.kind = 'host'; }
      static async available() {
        try { const res = await fetch('/shinki-serial/status'); const body = await res.json(); return body?.value?.hostAvailable === true; } catch { return false; }
      }
      async list() { const v = await hostApi('list', {}); return (v.ports || []).map((p) => ({ ...p, label: p.label || p.path })); }
      async requestPort() { return null; }
      onConnect() { return () => {}; }
      onDisconnect() { return () => {}; }
      async open(info, opts, cfg = {}) {
        const sessionId = info.sessionId || `host:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        await hostApi('open', { sessionId, path: info.path, opts, extra: cfg });
        let cursor = 0, closed = false, timer = null;
        return {
          info, opts,
          async read(onLogLine) {
            const poll = async () => {
              if (closed) return;
              try { const v = await hostApi('read', { sessionId, limit: 200 }); for (const l of v.lines) { if (l.seq > cursor) { cursor = l.seq; onLogLine(l); } } } catch { /* retry */ }
            };
            await poll();
            timer = setInterval(poll, 60);
          },
          async write(input) { return hostApi('write', { sessionId, text: input.text, hex: input.hex, newline: input.newline || 'none', dir: input.dir || 'TX' }); },
          async update(patch) { return hostApi('update', { sessionId, opts: patch }); },
          async setMergeMs(ms) { return hostApi('update', { sessionId, rxMergeMs: ms }); },
          async close() { closed = true; if (timer) clearInterval(timer); return hostApi('close', { sessionId }); },
        };
      }
    }
    async function resolveBackend(preference = 'auto') {
      if (preference === 'webserial') return WebSerialBackend.available() ? new WebSerialBackend() : null;
      if (preference === 'host') return (await HostSerialBackend.available()) ? new HostSerialBackend() : null;
      // auto: host first — authoritative full port list + full line params;
      // Web Serial (lists only user-granted ports) is the fallback.
      if (await HostSerialBackend.available()) return new HostSerialBackend();
      if (WebSerialBackend.available()) return new WebSerialBackend();
      return null;
    }

    // ══════════════════════════════════════════════════════════════════
    // SerialMonitorTab — minimal functional bottom-panel monitor
    // ══════════════════════════════════════════════════════════════════

    const MAX_LINES = 2000;
    const STATUS_TEXT = { idle: 'statusIdle', opening: 'statusOpening', open: 'statusOpen', error: 'statusError', closed: 'statusClosed' };
    const DIR_COLOR = { TX: '#2e9e4f', Q: '#1e88e5', AR: '#fb8c00', RX: 'inherit' };

    function SerialMonitorTab({ ctx, store, scope, tab, visible }) {
      const [backend, setBackend] = useState(null);          // resolved backend or null
      const [ports, setPorts] = useState([]);                // SerialPortInfo[]
      const [selected, setSelected] = useState(null);        // SerialPortInfo
      const [baud, setBaud] = useState(DEFAULT_OPTIONS.baudRate);           // preset baud
      const [baudCustom, setBaudCustom] = useState(false);                  // 自定义 selected?
      const [customBaud, setCustomBaud] = useState(DEFAULT_OPTIONS.baudRate); // custom value
      const [dataBits, setDataBits] = useState(DEFAULT_OPTIONS.dataBits);
      const [parity, setParity] = useState(DEFAULT_OPTIONS.parity);
      const [stopBits, setStopBits] = useState(DEFAULT_OPTIONS.stopBits);
      const [flowControl, setFlowControl] = useState(DEFAULT_OPTIONS.flowControl);
      const [mode, setMode] = useState('text');              // text | hex
      const [encoding, setEncoding] = useState(DEFAULT_ENCODING_LABEL);
      const [newline, setNewline] = useState('none');
      const [status, setStatus] = useState('idle');
      const [lines, setLines] = useState([]);                // LogLine[] (bounded)
      const [error, setError] = useState(null);
      const [sendText, setSendText] = useState('');
      const [autoScroll, setAutoScroll] = useState(true);    // follow newest RX (lock/unlock)
      const [rxMergeMs, setRxMergeMs] = useState(100);       // RX coalesce window (ms; 0=off)
      const sessionRef = useRef(null);                       // SerialSession
      const backendRef = useRef(null);
      const linesRef = useRef([]);
      const rxRef = useRef(null);                            // RX scroll container
      // Memoized translator: MUST be stable (it lives in effect/callback deps).
      // An inline arrow re-created every render made the init effect re-run in
      // a loop and froze the tab.
      const t = useCallback((key) => { try { return ctx?.locale?.lookup?.(NS, key) ?? zh[key] ?? key; } catch { return zh[key] ?? key; } }, [ctx]);

      // Persist per-tab UI settings (baud / params) into tab.meta — survives reloads.
      const persistMeta = useCallback((patch) => {
        try { ctx?.betterSidebar?.updateTab?.(tab?.id, { meta: { ...(tab?.meta || {}), ...patch } }); } catch { /* ignore */ }
      }, [ctx, tab?.id]);

      const pushLine = useCallback((line) => {
        linesRef.current = [...linesRef.current.slice(-(MAX_LINES - 1)), line];
        if (visible) setLines(linesRef.current);
      }, [visible]);

      // Auto-scroll lock/unlock: pinned to newest line while following is on;
      // scrolling up away from the bottom locks it, scrolling back to the
      // bottom (or the toolbar button) unlocks it.
      useEffect(() => {
        const el = rxRef.current;
        if (el && autoScroll) el.scrollTop = el.scrollHeight;
      }, [lines, autoScroll]);

      const refreshPorts = useCallback(async () => {
        const b = backendRef.current;
        if (!b) return;
        try {
          const list = await b.list();
          setPorts(list);
          setSelected((cur) => (cur && list.some((p) => p.path === cur.path) ? cur : list[0] ?? null));
        } catch (e) { setError(String(e.message ?? e)); }
      }, []);

      // Init: resolve backend + ports + hotplug + bottom-dock placement.
      // Deps MUST be stable (t memoized, tab?.id is a string): an unstable dep
      // previously re-ran this effect on every state update → infinite re-init
      // loop that froze the tab.
      useEffect(() => {
        let disposed = false;
        let offs = [];
        (async () => {
          try {
            const prefs = (typeof ctx?.betterSidebar?.getSnapshot === 'function')
              ? ctx.betterSidebar.getSnapshot().prefs?.pluginSettings?.['dsh-shinki-serial-monitor'] || {}
              : {};
            // Seed baud/params: tab.meta (per-tab) → pluginSettings (settings menu) → defaults.
            const meta = tab?.meta || {};
            const pick = (key, setter, fallback) => {
              if (meta[key] != null) setter(meta[key]);
              else if (prefs[key] != null) setter(prefs[key]);
              else setter(fallback);
            };
            if (meta.baudCustom != null) setBaudCustom(meta.baudCustom === true);
            pick('baud', setBaud, DEFAULT_OPTIONS.baudRate);
            pick('customBaud', setCustomBaud, DEFAULT_OPTIONS.baudRate);
            pick('rxMergeMs', setRxMergeMs, 100);
            pick('dataBits', setDataBits, DEFAULT_OPTIONS.dataBits);
            pick('parity', setParity, DEFAULT_OPTIONS.parity);
            pick('stopBits', setStopBits, DEFAULT_OPTIONS.stopBits);
            pick('flowControl', setFlowControl, DEFAULT_OPTIONS.flowControl);
            const b = await resolveBackend(prefs.backend || 'auto');
            if (disposed) return;
            if (!b) { setError(t('noSerial')); return; }
            backendRef.current = b;
            setBackend(b);
            try {
              const list = await b.list();
              if (disposed) return;
              setPorts(list);
              setSelected(list[0] ?? null);
            } catch (e) { if (!disposed) setError(String(e.message ?? e)); }
            if (typeof b.onConnect === 'function') offs.push(b.onConnect(() => { refreshPorts(); }));
            if (typeof b.onDisconnect === 'function') offs.push(b.onDisconnect(() => { refreshPorts(); }));
            // Default bottom-panel placement (once, gated by tab.meta).
            if (store && tab && tab.meta?.dockedBottom !== true) {
              if (ensureBottomPanel(store, tab.id)) {
                try { ctx?.betterSidebar?.updateTab?.(tab.id, { meta: { ...(tab.meta || {}), dockedBottom: true } }); } catch { /* ignore */ }
              }
            }
          } catch (e) {
            if (!disposed) setError(String(e?.message ?? e));
          }
        })();
        return () => { disposed = true; for (const off of offs) off(); };
      }, [ctx, store, tab?.id, refreshPorts, t]);

      // Stop the serial session when the tab actually closes (component
      // unmount ≠ tab close on session switch; onClose in the descriptor
      // handles the real close).
      const stopSession = useCallback(async () => {
        const s = sessionRef.current;
        sessionRef.current = null;
        if (s) { try { await s.close(); } catch { /* ignore */ } }
        setStatus('closed');
      }, []);

      const openPort = useCallback(async () => {
        if (!selected) { setError(t('selectPortFirst')); return; }
        const b = backendRef.current;
        if (!b) return;
        setError(null);
        setStatus('opening');
        try {
          const session = await b.open(selected, {
            baudRate: baudCustom ? customBaud : baud,
            dataBits, parity, stopBits, flowControl,
          }, { encoding, hex: mode === 'hex', rxMergeMs });
          sessionRef.current = session;
          setStatus('open');
          session.read((line) => pushLine(line));
        } catch (e) { setStatus('error'); setError(String(e.message ?? e)); }
      }, [selected, baud, baudCustom, customBaud, dataBits, parity, stopBits, flowControl, encoding, mode, rxMergeMs, pushLine, t]);

      const closePort = useCallback(() => { stopSession(); }, [stopSession]);

      const doSend = useCallback(async () => {
        const s = sessionRef.current;
        if (!s) { setError(t('selectPortFirst')); return; }
        if (!sendText) return;
        setError(null);
        try {
          const input = mode === 'hex' ? { hex: sendText, newline } : { text: sendText, newline };
          await s.write({ ...input, dir: 'TX' });
          setSendText('');
        } catch (e) { setError(String(e.message ?? e)); }
      }, [sessionRef, sendText, mode, newline, t]);

      const statusText = STATUS_TEXT[status] ?? 'statusIdle';
      const style = {
        display: 'flex', flexDirection: 'column', height: '100%', fontSize: 12,
        fontFamily: "var(--dsw-font-mono, ui-monospace, Consolas, monospace)",
      };

      return h('div', { style, 'data-shinki-serial': true },
        // toolbar
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.08))', overflowX: 'auto', flex: '0 0 auto', whiteSpace: 'nowrap' } },
          h('select', {
            value: selected?.path ?? '', style: { maxWidth: 220 },
            onChange: (e) => setSelected(ports.find((p) => p.path === e.target.value) ?? null),
          },
            h('option', { value: '' }, t('portPlaceholder')),
            ports.map((p) => h('option', { key: p.path, value: p.path }, `${p.label} (${p.path})`)),
          ),
          h('button', { type: 'button', onClick: refreshPorts, title: t('refresh') }, h(primitives.IconRefreshOutline16, { size: 14 })),
          h('button', { type: 'button', onClick: async () => { try { const info = await backendRef.current?.requestPort(); if (info) { await refreshPorts(); setSelected(info); } } catch { /* user cancelled */ } } }, '+'),
          h('select', {
            value: baudCustom ? 'custom' : String(baud), style: { width: 112 }, title: t('baud'),
            onChange: (e) => {
              if (e.target.value === 'custom') { setBaudCustom(true); persistMeta({ baudCustom: true }); }
              else { const n = Number(e.target.value); setBaudCustom(false); setBaud(n); persistMeta({ baudCustom: false, baud: n }); }
            },
          },
            COMMON_BAUDRATES.map((n) => h('option', { key: n, value: String(n) }, String(n))),
            h('option', { value: 'custom' }, t('customBaud')),
          ),
          baudCustom && h('input', { type: 'number', value: customBaud, min: 1, style: { width: 92 }, title: t('setCustomBaud'), onChange: (e) => { const n = Math.max(1, Number(e.target.value) || 1); setCustomBaud(n); persistMeta({ customBaud: n }); } }),
          h('label', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, t('mergeMs') + ':'),
          h('input', { type: 'number', value: String(rxMergeMs), min: 0, max: 10000, step: 50, style: { width: 60 }, title: t('setMergeMs'), onChange: (e) => { const n = Math.max(0, Math.min(10000, Math.round(Number(e.target.value) || 0))); setRxMergeMs(n); persistMeta({ rxMergeMs: n }); const s = sessionRef.current; if (s && typeof s.setMergeMs === 'function') { s.setMergeMs(n).catch(() => {}); } } }),
          h('button', { type: 'button', onClick: status === 'open' ? closePort : openPort, disabled: status === 'opening' },
            status === 'open' ? t('close') : t('open')),
          h('select', { value: mode, title: t('displayMode'), onChange: (e) => setMode(e.target.value) },
            h('option', { value: 'text' }, t('modeText')),
            h('option', { value: 'hex' }, t('modeHex')),
            h('option', { value: 'esc' }, t('modeEsc')),
          ),
          h('select', { value: encoding, onChange: (e) => setEncoding(e.target.value) },
            TEXT_ENCODINGS.map(([name, label]) => h('option', { key: label + name, value: label }, name))),
          h('button', { type: 'button', onClick: () => { linesRef.current = []; setLines([]); } }, t('clear')),
          h('button', { type: 'button', title: t('autoScroll'), onClick: () => { setAutoScroll(true); const el = rxRef.current; if (el) el.scrollTop = el.scrollHeight; }, style: autoScroll ? {} : { color: '#e6533c', fontWeight: 700 } },
            autoScroll ? t('autoScrollOn') : t('backToBottom')),
          status === 'open' && h('span', { style: { color: '#e6533c', fontWeight: 700 } }, t('recording')),
        ),
        // advanced params row
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 4px', overflowX: 'auto', flex: '0 0 auto', whiteSpace: 'nowrap' } },
          h('label', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, t('params') + ':'),
          h('label', {}, t('dataBits') + ':'), h('select', { value: String(dataBits), onChange: (e) => { const v = Number(e.target.value); setDataBits(v); persistMeta({ dataBits: v }); } }, [5, 6, 7, 8].map((v) => h('option', { key: v, value: String(v) }, String(v)))),
          h('label', {}, t('parity') + ':'), h('select', { value: parity, onChange: (e) => { setParity(e.target.value); persistMeta({ parity: e.target.value }); } }, ['none', 'even', 'odd', 'mark', 'space'].map((v) => h('option', { key: v, value: v }, v))),
          h('label', {}, t('stopBits') + ':'), h('select', { value: String(stopBits), onChange: (e) => { const v = Number(e.target.value); setStopBits(v); persistMeta({ stopBits: v }); } }, [1, 1.5, 2].map((v) => h('option', { key: v, value: String(v) }, String(v)))),
          h('label', {}, t('flowControl') + ':'), h('select', { value: flowControl, onChange: (e) => { setFlowControl(e.target.value); persistMeta({ flowControl: e.target.value }); } }, ['none', 'hardware', 'xonxoff', 'dsrdtr'].map((v) => h('option', { key: v, value: v }, v))),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)', fontSize: 11 } }, t('paramsHint')),
        ),
        // rx area
        h('div', { ref: rxRef, onScroll: () => { const el = rxRef.current; if (!el) return; const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24; setAutoScroll((prev) => (atBottom === prev ? prev : atBottom)); }, style: { flex: 1, overflowY: 'auto', padding: '4px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } },
          error ? h('div', { style: { color: '#e6533c' } }, error)
            : (lines.length === 0 ? h('div', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, t('emptyRx'))
              : lines.map((l, i) => {
                const ts = formatTimestamp(l.tsMs);
                const prefix = l.dir === 'TX' ? t('txPrefix') : l.dir === 'Q' ? t('qPrefix') : l.dir === 'AR' ? t('arPrefix') : '';
                let body = mode === 'hex' ? (l.hex ?? '') : mode === 'esc' ? escFromHex(l.hex) : l.text;
                // Normalize CR/LF sequences so CR/LF render as real line breaks
                // in the esc view (browsers only honor \n in pre-wrap, and
                // devices emit \r\n, \n\r, \r, \n all mixed).
                if (mode === 'esc') body = body.replace(/\r\n/g, '\n').replace(/\n\r/g, '\n').replace(/\r/g, '\n');
                return h('div', { key: l.seq + '-' + i, style: { color: l.dir === 'RX' && l.level ? (LEVEL_FOREGROUND[l.level] ?? 'inherit') : DIR_COLOR[l.dir] ?? 'inherit' } },
                  `[${ts}] `, prefix ? `${prefix} ` : '', body);
              })),
        ),
        // send row
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.08))' } },
          h('input', {
            value: sendText, placeholder: mode === 'hex' ? '41 42 43 …' : '', style: { flex: 1 },
            onChange: (e) => setSendText(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') doSend(); },
          }),
          h('select', { value: newline, onChange: (e) => setNewline(e.target.value) },
            ['none', 'CRLF', 'LF', 'CR'].map((n) => h('option', { key: n, value: n }, n))),
          h('button', { type: 'button', onClick: doSend, disabled: status !== 'open' }, t('send')),
        ),
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // Plugin entry
    // ══════════════════════════════════════════════════════════════════

    const PLUGIN_VERSION = '0.1.0';
    const inject = ['locale', 'betterSidebar'];
    const name = 'dsh-shinki-serial-monitor';

    function apply(ctx) {
      injectCss();
      try { ctx.locale?.register?.(NS, { zh, en }); } catch { /* locale optional */ }
      const service = ctx?.betterSidebar ?? (typeof ctx.get === 'function' ? ctx.get('betterSidebar') : undefined);
      if (!service || typeof service.registerTab !== 'function') {
        console.warn('[dsh-shinki-serial-monitor] ctx.betterSidebar 不可用（需安装 dsh-better-sidebar），底部面板 Tab 未注册');
        return;
      }
      let disposers = [];
      const off = service.registerTab({
        id: 'dsh-shinki-serial-monitor',
        title: () => t('tabTitle'),
        order: 45,
        single: false,
        createTab: (state) => ({
          tab: { id: `serial:${state.nextTerminal}`, type: 'dsh-shinki-serial-monitor', title: t('tabTitle'), meta: { state: 'selecting' } },
          patch: { nextTerminal: state.nextTerminal + 1 },
        }),
        dedupeKey: (tab) => tab.meta?.portPath,
        settings: {
          pluginToggles: [
            { key: 'autoOpen', type: 'switch', title: () => t('setAutoOpen') },
            { key: 'defaultBaud', type: 'select', title: () => t('setDefaultBaud'), options: COMMON_BAUDRATES.map((n) => ({ value: n, title: () => String(n) })) },
            { key: 'customBaud', type: 'number', min: 1, title: () => t('setCustomBaud') },
            { key: 'dataBits', type: 'select', title: () => t('setDataBits'), options: [5, 6, 7, 8].map((n) => ({ value: n, title: () => String(n) })) },
            { key: 'parity', type: 'select', title: () => t('setParity'), options: ['none', 'even', 'odd', 'mark', 'space'].map((v) => ({ value: v, title: () => v })) },
            { key: 'stopBits', type: 'select', title: () => t('setStopBits'), options: [1, 1.5, 2].map((v) => ({ value: v, title: () => String(v) })) },
            { key: 'flowControl', type: 'select', title: () => t('setFlowControl'), options: ['none', 'hardware', 'xonxoff', 'dsrdtr'].map((v) => ({ value: v, title: () => v })) },
            { key: 'defaultMode', type: 'select', title: () => t('setDefaultMode'), options: [{ value: 'text', title: () => t('modeText') }, { value: 'hex', title: () => t('modeHex') }, { value: 'esc', title: () => t('modeEsc') }] },
            { key: 'rxMaxLines', type: 'number', min: 100, max: 100000, unit: 'lines', title: () => t('setRxMaxLines') },
            { key: 'rxMergeMs', type: 'number', min: 0, max: 10000, unit: 'ms', title: () => t('setRxMergeMs') },
            { key: 'backend', type: 'select', title: () => t('setBackend'), options: [{ value: 'auto', title: () => t('backendAuto') }, { value: 'webserial', title: () => t('backendWs') }, { value: 'host', title: () => t('backendHost') }] },
          ],
        },
        component: (props) => h(SerialMonitorTab, {
          ctx,
          store: props.store,
          scope: props.scope,
          tab: props.tab,
          visible: props.visible,
        }),
      });
      disposers.push(off);
      ctx.effect?.(() => () => { for (const d of disposers) d(); }, 'dsh-shinki-serial-monitor: bottom panel tab');
    }

    function t(key) { return zh[key] ?? en[key] ?? key; }

    function injectCss() {
      if (typeof document === 'undefined') return;
      const id = 'dsh-shinki-serial-monitor-css';
      if (document.getElementById(id)) return;
      const el = document.createElement('style');
      el.id = id;
      el.textContent = `
        [data-shinki-serial] select, [data-shinki-serial] input, [data-shinki-serial] button {
          background: var(--dsw-alias-bg-layer-2, transparent);
          color: var(--dsw-alias-label-primary, #e6edf3);
          border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));
          border-radius: 4px;
          font-size: 12px;
          flex-shrink: 0;
        }
        [data-shinki-serial] button:hover { background: var(--dsw-alias-bg-hover, rgba(255,255,255,.06)); }
      `;
      document.head.appendChild(el);
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
