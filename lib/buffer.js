/**
 * Bounded ring buffer + line splitter (shared by host + browser).
 * The host uses these to turn the raw RX byte stream into bounded,
 * ms-timestamped LogLines; the browser uses them for rendering.
 */

/** Fixed-capacity ring buffer (drops oldest when full). */
export class RingBuffer {
  constructor(max = 10000) {
    this.max = max;
    this._buf = [];
    this._start = 0;
    this._size = 0;
  }

  get length() { return this._size; }

  push(item) {
    if (this._size === this.max) {
      this._buf[this._start] = item;
      this._start = (this._start + 1) % this.max;
      return;
    }
    this._buf[(this._start + this._size) % this.max] = item;
    this._size += 1;
  }

  /** Snapshot in insertion order. */
  toArray() {
    const out = new Array(this._size);
    for (let i = 0; i < this._size; i += 1) {
      out[i] = this._buf[(this._start + i) % this.max];
    }
    return out;
  }

  clear() {
    this._buf = [];
    this._start = 0;
    this._size = 0;
  }
}

const CR = 0x0d;
const LF = 0x0a;

/**
 * Splits an RX byte stream into lines on \n / \r\n / \r boundaries.
 * A partial trailing line is kept until flushed (on close). Callers decide
 * what a "line" is; empty lines are emitted too (device blank-line output).
 */
export class LineSplitter {
  /**
   * @param {(line: Uint8Array) => void} onLine called per complete line
   * @param {{keepEmpty?: boolean, maxLineBytes?: number}} opts
   */
  constructor(onLine, opts = {}) {
    this.onLine = onLine;
    this.keepEmpty = opts.keepEmpty ?? true;
    this.maxLineBytes = opts.maxLineBytes ?? 4096;
    this._pending = [];
    this._pendingLen = 0;
    this._prevCR = false;
  }

  push(chunk) {
    for (const byte of chunk) {
      if (byte === LF) {
        if (this._prevCR) { this._prevCR = false; continue; } // CRLF: CR already emitted the line
        this._emit(this._pending);
        this._pending = [];
        this._pendingLen = 0;
      } else if (byte === CR) {
        this._emit(this._pending);
        this._pending = [];
        this._pendingLen = 0;
        this._prevCR = true;
      } else {
        if (this._prevCR) this._prevCR = false;
        if (this._pendingLen < this.maxLineBytes) {
          this._pending.push(byte);
          this._pendingLen += 1;
        }
      }
    }
  }

  /** Emit the remaining partial line (call on close). */
  flush() {
    if (this._pendingLen > 0) {
      this._emit(this._pending);
      this._pending = [];
      this._pendingLen = 0;
    }
    this._prevCR = false;
  }

  _emit(line) {
    if (line.length === 0 && !this.keepEmpty) return;
    this.onLine(new Uint8Array(line));
  }
}

/**
 * Time-window coalescer: accumulates bytes and emits ONE chunk per windowMs
 * (default 100ms), so bursty binary/hex streams don't produce one LogLine
 * per tiny serialport chunk. windowMs=0 disables merging (chunk-immediate).
 * A timer restarts only when empty, so continuous streams flush every
 * windowMs and trailing bytes always flush after the last data event.
 */
export class TimeWindowMerger {
  constructor(onChunk, opts = {}) {
    this.onChunk = onChunk;
    this.windowMs = Math.max(0, opts.windowMs ?? 100);
    this.maxBytes = opts.maxBytes ?? 8192;
    this._buf = [];
    this._len = 0;
    this._timer = null;
  }
  push(chunk) {
    for (const b of chunk) {
      if (this._len < this.maxBytes) { this._buf.push(b); this._len += 1; }
    }
    this._schedule();
  }
  _schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, this.windowMs);
  }
  /** Change the coalesce window at runtime; pending bytes flush on the new window. */
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
