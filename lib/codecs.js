/**
 * Text encoding / HEX / timestamp helpers (shared by host + browser).
 * Covers all 12 encodings of UCANFD serial_debug via the Web-standard
 * TextDecoder/TextEncoder (GB2312 → `gbk` label, Latin-1 → `windows-1252`),
 * so no iconv-lite / native module is needed.
 */

// (显示名, TextDecoder/TextEncoder 标签) —— 顺序即 UI 下拉框顺序
export const TEXT_ENCODINGS = [
  ['ASCII（默认）', 'utf-8'],
  ['UTF-8', 'utf-8'],
  ['GBK', 'gbk'],
  ['GB2312', 'gbk'],
  ['GB18030', 'gb18030'],
  ['BIG5', 'big5'],
  ['UTF-16 LE', 'utf-16le'],
  ['UTF-16 BE', 'utf-16be'],
  ['Latin-1', 'windows-1252'],
  ['Windows-1252', 'windows-1252'],
  ['Shift-JIS', 'shift_jis'],
  ['EUC-KR', 'euc-kr'],
];

export const DEFAULT_ENCODING_LABEL = 'utf-8';

/** Look up the codec label by display name (fallback utf-8). */
export function labelByName(name) {
  for (const [display, label] of TEXT_ENCODINGS) {
    if (display === name) return label;
  }
  return DEFAULT_ENCODING_LABEL;
}

/** Decode raw bytes to text with the given label (errors → replacement). */
export function decodeBytes(bytes, label = DEFAULT_ENCODING_LABEL) {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    try {
      return new TextDecoder(DEFAULT_ENCODING_LABEL).decode(bytes);
    } catch {
      return String.fromCharCode(...bytes);
    }
  }
}

/**
 * Encode text to bytes.
 * NOTE: the Web-standard `TextEncoder` supports UTF-8 ONLY — legacy codecs
 * (GBK/BIG5/Shift-JIS/EUC-KR/Windows-1252…) are DECODABLE via TextDecoder
 * but NOT encodable here, so TX falls back to UTF-8 (ASCII-safe for the
 * common MCU command set). iconv-lite would be needed for legacy TX
 * encoding — deferred (see doc/设计-串口监控插件.md §5.6).
 */
export function encodeText(text) {
  return new TextEncoder().encode(text);
}

/** Uppercase HEX string, e.g. 5A FE 00. */
export function formatHex(bytes, sep = ' ') {
  const out = [];
  for (const b of bytes) out.push(b.toString(16).toUpperCase().padStart(2, '0'));
  return out.join(sep);
}

/**
 * Parse HEX input (spaces / newlines / commas / semicolons allowed) to
 * Uint8Array. Throws on odd length or invalid characters.
 */
export function parseHex(hexStr) {
  const s = String(hexStr).replace(/[\s\t\r\n,;]/g, '');
  if (!s) return new Uint8Array(0);
  if (s.length % 2 !== 0) throw new Error('HEX 长度必须为偶数（每个字节占两个十六进制字符）');
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error('HEX 包含非法字符');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ── 时间戳 ──────────────────────────────────────────────────────────────

// (显示名, strftime 模板；%f = 毫秒 3 位)
export const TIMESTAMP_FORMATS = [
  ['HH:mm:ss.mmm', '%H:%M:%S.%f'],
  ['HH:mm:ss', '%H:%M:%S'],
  ['yyyy-MM-dd HH:mm:ss.mmm', '%Y-%m-%d %H:%M:%S.%f'],
  ['yyyy-MM-dd HH:mm:ss', '%Y-%m-%d %H:%M:%S'],
];

export const DEFAULT_TIMESTAMP_FORMAT = '%H:%M:%S.%f';

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

/** Format an epoch-ms timestamp with a strftime-like template. */
export function formatTimestamp(tsMs, fmt = DEFAULT_TIMESTAMP_FORMAT) {
  const d = new Date(tsMs);
  const ms = pad(d.getMilliseconds(), 3);
  const tokens = {
    '%Y': String(d.getFullYear()),
    '%H': pad(d.getHours()),
    '%M': pad(d.getMinutes()),
    '%S': pad(d.getSeconds()),
    '%f': ms,
  };
  return String(fmt).replace(/%[YHMSf]/g, (m) => tokens[m] ?? m);
}
