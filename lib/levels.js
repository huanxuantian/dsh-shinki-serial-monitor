/**
 * Log-level detection + colors, ported from UCANFD serial_debug levels.py.
 * Parses common log markers (ulog [W/tag], <ERROR>, [E], ERROR:, inline
 * keywords) and maps to the same foreground colors as the MCU log viewer.
 */

export const LEVEL_FOREGROUND = {
  V: '#8A8A8A',
  D: '#4D96FF',
  I: '#2E9E4F',
  W: '#E6A23C',
  E: '#E6533C',
};

const ULOG_TAG = /^\[([VDIWE])\s*\/\s*[^\]]*\]/i;
const ANGLE = /^<([A-Za-z]+)>/;
const SQUARE = /^\[([VDIWE])\]/i;
const KEYWORD_PREFIX = /^([A-Za-z]+)[:：]\s*/;

const LETTER_MAP = { v: 'V', d: 'D', i: 'I', w: 'W', e: 'E' };
const WORD_MAP = {
  verbose: 'V', verb: 'V',
  debug: 'D', dbg: 'D',
  info: 'I', inf: 'I',
  warn: 'W', warning: 'W',
  error: 'E', err: 'E',
  fail: 'E', failed: 'E',
  fatal: 'E', fault: 'E',
  exception: 'E', abort: 'E',
  panic: 'E', assert: 'E',
};

const ERROR_RE = /\b(error|fail|failed|fault|fatal|exception|panic|assert|abort)\b/i;
const WARN_RE = /\b(warn|warning)\b/i;
const DEBUG_RE = /\b(debug|dbg)\b/i;

/**
 * Detect the level of one line; returns 'V'|'D'|'I'|'W'|'E' (default 'I').
 */
export function detectLevel(line) {
  const s = String(line).replace(/^\s+/, '');
  let m = ULOG_TAG.exec(s);
  if (m) return LETTER_MAP[m[1].toLowerCase()] ?? 'I';
  m = ANGLE.exec(s);
  if (m) return WORD_MAP[m[1].toLowerCase()] ?? 'I';
  m = SQUARE.exec(s);
  if (m) return LETTER_MAP[m[1].toLowerCase()] ?? 'I';
  m = KEYWORD_PREFIX.exec(s);
  if (m) return WORD_MAP[m[1].toLowerCase()] ?? 'I';
  const low = s.toLowerCase();
  if (ERROR_RE.test(low)) return 'E';
  if (WARN_RE.test(low)) return 'W';
  if (DEBUG_RE.test(low)) return 'D';
  return 'I';
}
