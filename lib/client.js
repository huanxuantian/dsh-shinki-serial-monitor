/*!
 * dsh-shinki-serial-monitor client bundle (browser half).
 *
 * Registers a bottom-panel tab ("串口监视器") through dsh-better-sidebar's
 * `ctx.betterSidebar` service（经安全取法 bsOf(ctx) 访问）and renders a minimal-but-functional serial
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
    // rc.1 起 host 不再提供 @deepseek-ai/dsh-client-ui-primitives → 内联本地线性图标
    // （16px，stroke=currentColor；与旧 primitives.IconRefreshOutline16 同签名 {size}）
    const _svg = (d, size) => react.createElement('svg', {
      width: size || 16, height: size || 16, viewBox: '0 0 16 16',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
      strokeLinecap: 'round', strokeLinejoin: 'round',
    }, react.createElement('path', { d }));
    const primitives = {
      IconRefreshOutline16: (p) => _svg('M13.2 8a5.2 5.2 0 1 1-1.6-3.7M13.2 2.4v2.4h-2.4', p && p.size),
    };
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
      // ── 串口占用视图（occupancy view）──
      tabSessions: '串口占用',
      occDesc: '查看哪些串口正被哪个会话占用：可修改参数、关闭串口（动作会回传给占用它的会话），点击「监听」查看实时收发。',
      occHostOnly: '占用视图需要 host 串口后端（serialport 已安装且 host 可用）；当前仅 Web Serial 后端，无法显示 AI 打开的串口。',
      occEmpty: '当前没有已打开的串口（AI 用 serial_open 或本地面板打开后显示在此）',
      occOwner: '占用方',
      occOwnerAgent: '会话',
      occOwnerUi: '本地面板',
      occOwnerUnknown: '未知',
      occCfg: '参数',
      occEnc: 'AI编码',
      occListen: '监听',
      occEdit: '编辑参数',
      occClose: '关闭',
      occApply: '应用',
      occCancel: '取消',
      occConfirmClose: '关闭该串口，并通知占用它的会话（如为 AI 会话）？',
      occNotifyOk: '已通知占用会话',
      occNotifyFail: '操作成功，但未能通知占用会话',
      occNoAgent: '操作成功（无 AI 占用会话需通知）',
      occUpdated: '参数已更新',
      occUpdateFail: '参数更新失败',
      occClosed: '串口已关闭',
      occBack: '← 返回占用列表',
      occLive: '● 监听中',
      occEmptyRx: '（等待该串口数据…）',
      occDisplayEnc: '显示编码',
      occDisplayEncAuto: '会话(AI)编码',
      occModeText: '文本',
      occModeHex: 'HEX',
      occModeEsc: '转义',
      occClear: '清屏',
      occAutoScrollOn: '⬇ 自动滚动',
      occBackBottom: '⬇ 回到底部',
      occHint: '监听视图的显示编码/模式仅影响本视图，不影响 AI 调用的编码与格式。',
      occPaneData: '数据交换',
      occPaneOps: '操作日志',
      occOpsEmpty: '（暂无操作记录）',
      occOpsAgent: 'AI',
      occOpsUser: '用户',
      occOpsSystem: '系统',
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
      // ── occupancy view ──
      tabSessions: 'Serial Occupancy',
      occDesc: 'See which port is held by which session: update params, close a port (the action is delivered back to its owning session), or click Listen to watch live traffic.',
      occHostOnly: 'Occupancy view needs the host serial backend (serialport installed). Only Web Serial is available now, so AI-opened ports cannot be shown.',
      occEmpty: 'No open ports yet (agent serial_open or the local panel shows up here)',
      occOwner: 'Held by',
      occOwnerAgent: 'Session',
      occOwnerUi: 'Local panel',
      occOwnerUnknown: 'Unknown',
      occCfg: 'Params',
      occEnc: 'AI enc',
      occListen: 'Listen',
      occEdit: 'Edit params',
      occClose: 'Close',
      occApply: 'Apply',
      occCancel: 'Cancel',
      occConfirmClose: 'Close this port and notify its owning session (if AI)?',
      occNotifyOk: 'Owning session notified',
      occNotifyFail: 'Action done, but failed to notify the owning session',
      occNoAgent: 'Action done (no AI owner to notify)',
      occUpdated: 'Params updated',
      occUpdateFail: 'Failed to update params',
      occClosed: 'Port closed',
      occBack: '← Back to occupancy list',
      occLive: '● Listening',
      occEmptyRx: '(waiting for port data…)',
      occDisplayEnc: 'Display enc',
      occDisplayEncAuto: 'Session (AI) enc',
      occModeText: 'Text',
      occModeHex: 'HEX',
      occModeEsc: 'Esc',
      occClear: 'Clear',
      occAutoScrollOn: '↓ Auto-scroll',
      occBackBottom: '↓ Back to bottom',
      occHint: 'Display encoding/mode here only affects this view; AI-facing encoding/format is untouched.',
      occPaneData: 'Data',
      occPaneOps: 'Ops log',
      occOpsEmpty: '(no operation records yet)',
      occOpsAgent: 'AI',
      occOpsUser: 'User',
      occOpsSystem: 'System',
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
            try { if (timer && typeof timer.unref === 'function') timer.unref(); } catch { /* 忽略 */ }
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
        try { bsOf(ctx)?.updateTab?.(tab?.id, { meta: { ...(tab?.meta || {}), ...patch } }); } catch { /* ignore */ }
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
            const prefs = (typeof bsOf(ctx)?.getSnapshot === 'function')
              ? bsOf(ctx).getSnapshot().prefs?.pluginSettings?.['dsh-shinki-serial-monitor'] || {}
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
                try { bsOf(ctx)?.updateTab?.(tab.id, { meta: { ...(tab.meta || {}), dockedBottom: true } }); } catch { /* ignore */ }
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
    // SerialSessionsTab — 串口占用视图（issue #4）
    //   列出 host 后端已打开的串口及其占用会话（哪个串口被哪个会话占用），
    //   支持更新参数 / 关闭串口（操作会回传给占用它的会话），点击「监听」
    //   查看实时收发；监听视图的显示编码/模式只影响本地展示，不影响 AI
    //   调用侧（host 会话）的编码与格式。
    // ══════════════════════════════════════════════════════════════════

    const OCC_POLL_MS = 1200;
    const OCC_WATCH_POLL_MS = 300;

    function ownerLabel(row, tFn) {
      if (!row.owner) return tFn('occOwnerUnknown');
      if (row.owner.kind === 'agent') return row.ownerTitle || row.owner.id || '?';
      if (row.owner.kind === 'ui') return tFn('occOwnerUi');
      return tFn('occOwnerUnknown');
    }

    function cfgText(row) {
      const o = row.opts || {};
      const p = ((o.parity || 'none')[0] || 'n').toUpperCase();
      return `${o.baudRate ?? '?'}/${o.dataBits ?? 8}${p}${o.stopBits ?? 1}` + (o.flowControl && o.flowControl !== 'none' ? `,${o.flowControl}` : '');
    }

    function SerialSessionsTab({ ctx, store, tab, visible }) {
      const t2 = useCallback((key) => { try { return ctx?.locale?.lookup?.(NS, key) ?? zh[key] ?? key; } catch { return zh[key] ?? key; } }, [ctx]);
      const [hostOk, setHostOk] = useState(null);          // null=探测中
      const [rows, setRows] = useState([]);                // stats().sessions
      const [notice, setNotice] = useState(null);
      const noticeTimer = useRef(null);
      const [busyId, setBusyId] = useState(null);
      const [editingId, setEditingId] = useState(null);
      const [draft, setDraft] = useState(null);
      const [watch, setWatch] = useState(null);            // {sessionId,path,label,enc}
      const [wLines, setWLines] = useState([]);
      const wLinesRef = useRef([]);
      const wCursor = useRef(0);
      const [wEncState, setWEncState] = useState('');      // ''=按会话(AI)编码显示
      const [wMode, setWMode] = useState('text');          // text | hex | esc
      const [wAuto, setWAuto] = useState(true);
      const wRef = useRef(null);
      const [pane, setPane] = useState('data');            // 监听页签: data(数据交换) | ops(操作日志)
      const [ops, setOps] = useState([]);                  // 操作事件（AI serial_* 工具 + 用户动作→AI 回传）
      const opsRef = useRef(null);

      const flash = useCallback((text) => {
        setNotice(text);
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 4000);
      }, []);

      const refreshHost = useCallback(async () => {
        try { const r = await fetch('/shinki-serial/status'); const b = await r.json(); setHostOk(b?.value?.hostAvailable === true); }
        catch { setHostOk(false); }
      }, []);

      const startWatch = (row) => {
        wCursor.current = 0; wLinesRef.current = [];
        setWLines([]); setWAuto(true); setWMode('text'); setWEncState('');
        setOps([]); setPane('data');
        setWatch({ sessionId: row.sessionId, path: row.path, label: row.label, enc: row.encoding || 'utf-8' });
      };
      const stopWatch = () => { setWatch(null); setWLines([]); wLinesRef.current = []; setOps([]); setPane('data'); };

      const openEdit = (row) => {
        setEditingId(row.sessionId);
        setDraft({
          baudRate: row.opts?.baudRate ?? 115200,
          dataBits: row.opts?.dataBits ?? 8,
          parity: row.opts?.parity ?? 'none',
          stopBits: row.opts?.stopBits ?? 1,
          flowControl: row.opts?.flowControl ?? 'none',
        });
      };

      const doClose = useCallback(async (row) => {
        if (!window.confirm(t2('occConfirmClose'))) return;
        setBusyId(row.sessionId);
        try {
          const r = await hostApi('close', { sessionId: row.sessionId, notify: true });
          if (r.notify?.delivered === true) flash(t2('occNotifyOk'));
          else if (r.notify) flash(t2('occNotifyFail'));
          else flash(t2('occNoAgent'));
        } catch (e) { flash(String(e?.message ?? e)); }
        setBusyId(null);
      }, [t2, flash]);

      const doApply = useCallback(async (row) => {
        if (!draft) return;
        setBusyId(row.sessionId);
        try {
          const r = await hostApi('update', { sessionId: row.sessionId, opts: { ...draft } });
          flash(r.notify?.delivered === true ? t2('occNotifyOk') : t2('occUpdated'));
          setEditingId(null);
        } catch (e) { flash(`${t2('occUpdateFail')}: ${e?.message ?? e}`); }
        setBusyId(null);
      }, [draft, t2, flash]);

      // host 可用性探测
      useEffect(() => { let stop = false; refreshHost(); return () => { stop = true; }; }, [refreshHost]);

      // 占用列表轮询（host stats）
      useEffect(() => {
        if (!visible || hostOk !== true) return;
        let stop = false;
        const tick = async () => {
          if (stop) return;
          try {
            const v = await hostApi('stats', {});
            if (stop) return;
            const list = v.sessions || [];
            setRows(list);
            setWatch((w) => (w && !list.some((s) => s.sessionId === w.sessionId) ? null : w));
            setEditingId((ed) => (ed && !list.some((s) => s.sessionId === ed) ? null : ed));
          } catch { /* transient */ }
        };
        tick();
        const id = setInterval(tick, OCC_POLL_MS);
        try { if (id && typeof id.unref === 'function') id.unref(); } catch { /* 忽略 */ }
        return () => { stop = true; clearInterval(id); };
      }, [visible, hostOk]);

      // 监听区轮询（attach 到既有 host 会话，按 seq cursor 增量拉取）
      useEffect(() => {
        if (!visible || !watch) return;
        let stop = false;
        const poll = async () => {
          if (stop) return;
          try {
            const v = await hostApi('read', { sessionId: watch.sessionId, limit: 200 });
            if (stop) return;
            let changed = false;
            for (const l of v.lines || []) {
              if (l.seq > wCursor.current) {
                wCursor.current = l.seq;
                wLinesRef.current = [...wLinesRef.current.slice(-(MAX_LINES - 1)), l];
                changed = true;
              }
            }
            if (changed) setWLines(wLinesRef.current);
          } catch { /* transient */ }
        };
        poll();
        const id = setInterval(poll, OCC_WATCH_POLL_MS);
        try { if (id && typeof id.unref === 'function') id.unref(); } catch { /* 忽略 */ }
        return () => { stop = true; clearInterval(id); };
      }, [visible, watch]);

      // 操作日志轮询（AI serial_* 工具调用 + 用户动作→AI 回传）；进入 ops 页签才拉取
      useEffect(() => {
        if (!visible || !watch || pane !== 'ops') return;
        let stop = false;
        const poll = async () => {
          if (stop) return;
          try {
            const v = await hostApi('opLog', { sessionId: watch.sessionId });
            if (!stop) setOps(v.events || []);
          } catch { /* transient */ }
        };
        poll();
        const id = setInterval(poll, 1000);
        try { if (id && typeof id.unref === 'function') id.unref(); } catch { /* 忽略 */ }
        return () => { stop = true; clearInterval(id); };
      }, [visible, watch, pane]);

      // 自动滚动
      useEffect(() => {
        const el = wRef.current;
        if (el && wAuto) el.scrollTop = el.scrollHeight;
      }, [wLines, wAuto]);

      // 首次打开时放置到底部面板
      useEffect(() => {
        if (store && tab && tab.meta?.dockedBottom !== true) {
          try {
            if (ensureBottomPanel(store, tab.id)) bsOf(ctx)?.updateTab?.(tab.id, { meta: { ...(tab.meta || {}), dockedBottom: true } });
          } catch { /* ignore */ }
        }
      }, [store, tab?.id]);

      const watchEncLabel = wEncState || (watch?.enc || 'utf-8');
      const lineBody = (l) => {
        let body;
        if (wMode === 'hex') body = l.hex ?? '';
        else if (wMode === 'esc') body = escFromHex(l.hex);
        else if (l.hex && wEncState && wEncState !== (watch?.enc || 'utf-8')) {
          try { body = decodeBytes(parseHex(l.hex), wEncState); } catch { body = l.text ?? ''; }
        } else body = l.text ?? '';
        if (wMode === 'esc') body = body.replace(/\r\n/g, '\n').replace(/\n\r/g, '\n').replace(/\r/g, '\n');
        return body;
      };
      const lineColor = (l) => (l.dir === 'RX' && l.level ? (LEVEL_FOREGROUND[l.level] ?? 'inherit') : DIR_COLOR[l.dir] ?? 'inherit');
      const dirPrefix = (l) => (l.dir === 'TX' ? t2('txPrefix') : l.dir === 'Q' ? t2('qPrefix') : l.dir === 'AR' ? t2('arPrefix') : '');

      const rowBox = (row, ...children) => h('div', { key: row.sessionId, style: { borderBottom: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.06))', padding: '4px 8px' } }, ...children);
      const editRow = (row) => {
        if (!draft) return null;
        const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
        const sel = (label, value, onChange, options) => h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 3 } }, label + ':', h('select', { value: String(value), onChange: (e) => onChange(e.target.value) }, options.map((v) => h('option', { key: String(v), value: String(v) }, String(v)))));
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 4px', flexWrap: 'wrap' } },
          sel('Baud', draft.baudRate, (v) => set({ baudRate: Number(v) }), COMMON_BAUDRATES),
          sel(t2('dataBits'), draft.dataBits, (v) => set({ dataBits: Number(v) }), [5, 6, 7, 8]),
          sel(t2('parity'), draft.parity, (v) => set({ parity: v }), ['none', 'even', 'odd', 'mark', 'space']),
          sel(t2('stopBits'), draft.stopBits, (v) => set({ stopBits: Number(v) }), [1, 1.5, 2]),
          sel(t2('flowControl'), draft.flowControl, (v) => set({ flowControl: v }), ['none', 'hardware', 'xonxoff', 'dsrdtr']),
          h('button', { type: 'button', onClick: () => doApply(row), disabled: busyId === row.sessionId }, t2('occApply')),
          h('button', { type: 'button', onClick: () => setEditingId(null) }, t2('occCancel')),
        );
      };

      const listView = h('div', { style: { flex: 1, overflowY: 'auto' } },
        hostOk === true && rows.length === 0 ? h('div', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)', padding: 8 } }, t2('occEmpty'))
          : rows.map((row) => {
            const isEdit = editingId === row.sessionId;
            return rowBox(row,
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('span', { style: { fontWeight: 600 } }, row.label || row.path),
                h('code', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, row.path),
                h('span', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, t2('occOwner') + ':'),
                h('span', { style: { color: row.owner?.kind === 'agent' ? '#4d96ff' : '#2e9e4f' } }, ownerLabel(row, t2)),
                h('span', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, `${t2('occCfg')} ${cfgText(row)} · ${t2('occEnc')} ${row.encoding || 'utf-8'}${row.hexMode ? ' HEX' : ''} · RX${row.logLines}`),
                h('button', { type: 'button', onClick: () => startWatch(row) }, t2('occListen')),
                h('button', { type: 'button', onClick: () => (isEdit ? setEditingId(null) : openEdit(row)) }, t2('occEdit')),
                h('button', { type: 'button', disabled: busyId === row.sessionId, onClick: () => doClose(row), style: { color: '#e6533c' } }, t2('occClose')),
              ),
              isEdit ? editRow(row) : null,
            );
          }),
      );

      const opActorIcon = (a) => (a === 'agent' ? '🤖' : a === 'user' ? '👤' : '⚙️');
      const opActorLabel = (a) => (a === 'agent' ? t2('occOpsAgent') : a === 'user' ? t2('occOpsUser') : t2('occOpsSystem'));
      const opColor = (a) => (a === 'user' ? '#e6a23c' : a === 'agent' ? '#4d96ff' : 'inherit');

      // 操作日志页（AI 操作工具日志 + 用户操作→AI 的回传记录）
      const opsArea = h('div', { style: { flex: 1, overflowY: 'auto', padding: '4px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } },
        ops.length === 0 ? h('div', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, t2('occOpsEmpty'))
          : ops.map((e, i) => h('div', { key: e.seq + '-' + i, style: { color: opColor(e.actor) } },
            `[${formatTimestamp(e.tsMs)}] ${opActorIcon(e.actor)}${opActorLabel(e.actor)} · ${e.name || ''}：${e.text || ''}`)),
      );

      const paneSwitch = h('span', { style: { display: 'inline-flex', border: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12))', borderRadius: 4, overflow: 'hidden' } },
        h('button', { type: 'button', onClick: () => setPane('data'), style: { background: pane === 'data' ? 'var(--dsw-alias-bg-hover, rgba(255,255,255,.08))' : 'transparent', border: 'none' } }, t2('occPaneData')),
        h('button', { type: 'button', onClick: () => setPane('ops'), style: { background: pane === 'ops' ? 'var(--dsw-alias-bg-hover, rgba(255,255,255,.08))' : 'transparent', border: 'none' } }, t2('occPaneOps')),
      );

      const watchView = h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))', flex: '0 0 auto', whiteSpace: 'nowrap', overflowX: 'auto' } },
          h('button', { type: 'button', onClick: stopWatch }, t2('occBack')),
          paneSwitch,
          h('span', { style: { fontWeight: 600 } }, `${t2('occLive')} ${watch?.label || watch?.path}`),
          h('code', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, watch?.path),
          pane === 'data' && h('label', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, t2('occDisplayEnc') + ':'),
          pane === 'data' && h('select', { value: wEncState, onChange: (e) => setWEncState(e.target.value), title: t2('occHint') },
            h('option', { value: '' }, `${t2('occDisplayEncAuto')} (${watch?.enc || 'utf-8'})`),
            TEXT_ENCODINGS.map(([nm, label]) => h('option', { key: label + nm, value: label }, nm)),
          ),
          pane === 'data' && h('select', { value: wMode, onChange: (e) => setWMode(e.target.value) },
            h('option', { value: 'text' }, t2('occModeText')),
            h('option', { value: 'hex' }, t2('occModeHex')),
            h('option', { value: 'esc' }, t2('occModeEsc')),
          ),
          pane === 'data' && h('button', { type: 'button', onClick: () => { wLinesRef.current = []; setWLines([]); } }, t2('occClear')),
          pane === 'data' && h('button', { type: 'button', onClick: () => { setWAuto(true); const el = wRef.current; if (el) el.scrollTop = el.scrollHeight; }, style: wAuto ? {} : { color: '#e6533c', fontWeight: 700 } }, wAuto ? t2('occAutoScrollOn') : t2('occBackBottom')),
        ),
        pane === 'data' ? h('div', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)', padding: '0 8px', fontSize: 11, flex: '0 0 auto' } }, t2('occHint')) : null,
        pane === 'data'
          ? h('div', { ref: wRef, onScroll: () => { const el = wRef.current; if (!el) return; const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24; setWAuto((prev) => (atBottom === prev ? prev : atBottom)); }, style: { flex: 1, overflowY: 'auto', padding: '4px 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } },
            wLines.length === 0 ? h('div', { style: { color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, t2('occEmptyRx'))
              : wLines.map((l, i) => h('div', { key: l.seq + '-' + i, style: { color: lineColor(l) } },
                `[${formatTimestamp(l.tsMs)}] `, dirPrefix(l) ? `${dirPrefix(l)} ` : '', lineBody(l))),
          )
          : opsArea,
      );

      const baseStyle = {
        display: 'flex', flexDirection: 'column', height: '100%', fontSize: 12,
        fontFamily: 'var(--dsw-font-mono, ui-monospace, Consolas, monospace)',
      };
      return h('div', { style: baseStyle, 'data-shinki-serial': true },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))', flex: '0 0 auto', whiteSpace: 'nowrap', overflowX: 'auto' } },
          h('span', { style: { fontWeight: 700 } }, t2('tabSessions')),
          h('button', { type: 'button', onClick: refreshHost, title: t2('refresh') }, '⟳'),
          hostOk === false && h('span', { style: { color: '#e6a23c' } }, t2('occHostOnly')),
        ),
        notice && h('div', { style: { padding: '2px 8px', color: '#4d96ff', background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,.03))', flex: '0 0 auto', borderBottom: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.06))', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, notice),
        hostOk === null ? h('div', { style: { flex: 1, padding: 8, color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, '…')
          : hostOk === true ? (watch ? watchView : listView)
          : h('div', { style: { flex: 1, padding: 8, color: 'var(--dsw-alias-label-secondary,#9da7b3)' } }, t2('occHostOnly')),
      );
    }

    // ══════════════════════════════════════════════════════════════════
    // Plugin entry
    // ══════════════════════════════════════════════════════════════════

    const PLUGIN_VERSION = '0.2.4';
    const inject = ['locale'];   // 入口只走视图中间件（不依赖第三方）
    const name = 'dsh-shinki-serial-monitor';

        /** 安全取 betterSidebar：ctx.get 优先（未 inject 时属性访问会被 cordis 拒绝）。 */
    function bsOf(ctx) {
      try { return (ctx && ctx.get ? ctx.get('betterSidebar') : undefined) ?? (ctx ? ctx.betterSidebar : undefined); } catch { return undefined; }
    }

    /** 运行时探测服务（ctx.get 优先；不写进 inject ⇒ 缺失也不阻塞激活）。 */
    function waitService(ctx, svcName, cb, tries) {
      let n = 0;
      const get = () => { try { return (ctx && ctx.get ? ctx.get(svcName) : undefined) ?? (ctx ? ctx[svcName] : undefined); } catch { return undefined; } };
      const tick = () => {
        const sv = get();
        if (sv) { try { cb(sv); } catch (e) { console.warn('[' + svcName + '] 回调失败：' + (e && e.message)); } return true; }
        if (++n >= (tries || 400)) { console.warn('[' + svcName + '] 等待超时（未安装该插件？已跳过）'); return true; }
        return false;
      };
      if (tick()) return;
      const iv = setInterval(() => { if (tick()) clearInterval(iv); }, 250);
      try { if (iv && typeof iv.unref === 'function') iv.unref(); } catch { /* 忽略：浏览器无 unref；Node 下避免轮询把测试进程挂住 */ }
      try { ctx.effect(() => () => clearInterval(iv), svcName + ' wait cleanup'); } catch { /* 忽略 */ }
    }

function apply(ctx) {
      injectCss();
      try { ctx.locale?.register?.(NS, { zh, en }); } catch { /* locale optional */ }

      // ① 两个 Tab 的选项（纯数据，最先构造；两种模式共用同一份定义）—— 逐字段手写，勿自动抽取
      const tabOptions = {
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
      };
      // 串口占用视图（issue #4）：哪个串口被哪个会话占用 + 更新/关闭 + 实时监听
      const sessionsOptions = {
        id: 'dsh-shinki-serial-sessions',
        title: () => t('tabSessions'),
        order: 46,
        single: false,
        createTab: (state) => ({
          tab: { id: `serial-sessions:${state.nextTerminal}`, type: 'dsh-shinki-serial-sessions', title: t('tabSessions'), meta: {} },
          patch: { nextTerminal: state.nextTerminal + 1 },
        }),
        component: (props) => h(SerialSessionsTab, {
          ctx,
          store: props.store,
          scope: props.scope,
          tab: props.tab,
          visible: props.visible,
        }),
      };

      // ② 声明（必须先于任何引用）

      // ③ 新模式：视图中间件在 ⇒ 两个视图都交给它（仅右侧栏/下方面板）
      waitService(ctx, 'shinkiViews', (sv) => {
        if (!sv || typeof sv.register !== 'function') return;
        sv.register({
          id: tabOptions.id,
          title: t('tabTitle'),
          order: tabOptions.order,
          settings: tabOptions.settings,
          createTab: tabOptions.createTab,
          dedupeKey: tabOptions.dedupeKey,
          targets: ['bottom', 'right'],
          background: 'pause',
          render: (props) => tabOptions.component(props || {}),
        });
        sv.register({
          id: sessionsOptions.id,
          title: t('tabSessions'),
          order: sessionsOptions.order,
          createTab: sessionsOptions.createTab,
          targets: ['bottom'],
          background: 'pause',
          render: (props) => sessionsOptions.component(props || {}),
        });
        console.warn('[dsh-shinki-serial-monitor] 已通过视图中间件注册（新模式：串口监控 + 串口占用）');
      });

    }

    function t(key) { return zh[key] ?? en[key] ?? key; }

    function injectCss() {
      if (typeof document === 'undefined') return;
      const id = 'dsh-shinki-serial-monitor-css';
      if (document.getElementById(id)) return;
      const el = document.createElement('style');
      el.id = id;
      el.textContent = `
        /* 控件颜色/底色**成对**取自主题变量并加 !important：
           否则某些皮肤会把“深色表面”的输入框强制成深底，而文字仍取浅色档变量 → 低对比/看不见。 */
        [data-shinki-serial] select, [data-shinki-serial] input, [data-shinki-serial] button {
          background: var(--dsw-alias-bg-layer-2, transparent) !important;
          color: var(--dsw-alias-label-primary, #e6edf3) !important;
          border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12)) !important;
          border-radius: 4px;
          font-size: 12px;
          flex-shrink: 0;
        }
        [data-shinki-serial] :is(input, select)::placeholder { color: var(--dsw-alias-label-tertiary, #8b949e) !important; opacity: 1 !important; }
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
