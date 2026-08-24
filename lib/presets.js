/**
 * Serial parameter presets (ported from UCANFD serial_debug presets.py).
 * `SerialOpenOptions` shape: { baudRate, dataBits, parity, stopBits,
 * flowControl }. Web Serial supports dataBits 7|8, parity none|even|odd,
 * stopBits 1|2, flowControl none|hardware; the host serialport backend
 * additionally supports 5/6 data bits, Mark/Space parity, 1.5 stop bits and
 * xonxoff/dsrdtr software/hardware flow control.
 */

export const COMMON_BAUDRATES = [
  1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
  230400, 460800, 500000, 576000, 921600, 1000000, 1500000,
  2000000, 3000000, 4000000,
];

export const DEFAULT_BAUDRATE = 115200;

export const DEFAULT_OPTIONS = {
  baudRate: DEFAULT_BAUDRATE,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: 'none',
};

export const DATA_BITS = [5, 6, 7, 8];
export const PARITIES = ['none', 'even', 'odd', 'mark', 'space'];
export const STOP_BITS = [1, 1.5, 2];
export const FLOW_CONTROLS = ['none', 'hardware', 'xonxoff', 'dsrdtr'];

/** Web Serial API only supports this subset. */
export const WEB_SERIAL_LIMITS = {
  dataBits: [7, 8],
  parity: ['none', 'even', 'odd'],
  stopBits: [1, 2],
  flowControl: ['none', 'hardware'],
};

/** Parse a baud rate string (thousands separators allowed), positive int. */
export function parseBaudrate(text) {
  const cleaned = String(text).replace(/[,_\s]/g, '').trim();
  if (!/^\d+$/.test(cleaned)) throw new Error(`无效波特率: ${text}`);
  const value = Number(cleaned);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`无效波特率: ${text}`);
  return value;
}

/** Clamp options to what a given backend supports. */
export function clampOptions(opts, supported) {
  const out = { ...opts };
  if (supported?.dataBits && !supported.dataBits.includes(out.dataBits)) {
    out.dataBits = DEFAULT_OPTIONS.dataBits;
  }
  if (supported?.parity && !supported.parity.includes(out.parity)) {
    out.parity = DEFAULT_OPTIONS.parity;
  }
  if (supported?.stopBits && !supported.stopBits.includes(out.stopBits)) {
    out.stopBits = DEFAULT_OPTIONS.stopBits;
  }
  if (supported?.flowControl && !supported.flowControl.includes(out.flowControl)) {
    out.flowControl = DEFAULT_OPTIONS.flowControl;
  }
  return out;
}
