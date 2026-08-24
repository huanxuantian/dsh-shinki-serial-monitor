/**
 * Shared LogLine builder — the connective tissue of the whole plugin
 * (overall goal: AI-readable detailed interaction + ms-timestamped logs).
 * Used by the host serial service AND both browser serial backends so the
 * UI and the agent always see the same structured line model.
 */
import { decodeBytes, formatHex } from './codecs.js';
import { detectLevel } from './levels.js';

/**
 * @param {object} p
 * @param {Uint8Array} [p.bytes]  raw bytes (for hex/byte count)
 * @param {string} [p.text]       pre-decoded text (skips decoding)
 * @param {boolean} [p.hexMode]   include a HEX representation
 * @param {string} [p.encoding]   TextDecoder label for decoding bytes
 * @param {number} [p.seq]        per-session sequence number
 * @param {number} [p.tsMs]       epoch milliseconds (authoritative timestamp)
 */
export function buildLogLine({ dir, bytes, text, hexMode = false, encoding = 'utf-8', seq = 0, tsMs = Date.now() }) {
  const resolvedText = text != null ? text : (bytes ? decodeBytes(bytes, encoding) : '');
  return {
    seq,
    tsMs,
    iso: new Date(tsMs).toISOString(),
    dir,
    level: dir === 'RX' ? detectLevel(resolvedText) : null,
    text: resolvedText,
    hex: bytes ? formatHex(bytes) : undefined, // always present → UI can switch text/HEX anytime
    bytes: bytes ? bytes.length : 0,
  };
}
