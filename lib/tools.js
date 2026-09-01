/**
 * Agent tools `serial_*` (goal G1): let the internal agent drive serial
 * device debugging — enumerate ports, open/close sessions, write commands,
 * and read the structured ms-timestamped LogLine log.
 *
 * Registered through the dsh tool runtime (`ctx.tools.register`), the same
 * mechanism dsh-better-sidebar uses for its `terminal_*` tools. `ctx.tools`
 * is a cordis service, so `'tools'` MUST be declared in the plugin's
 * `inject` (see lib/index.js) — accessing it otherwise throws
 * "cannot get property ... without inject".
 *
 * `@deepseek-ai/dsh-tools` is lazy-loaded (resolves at runtime via the
 * plugin/web/node_modules/@deepseek-ai junction to the engine's embedded
 * deps; a passthrough shim keeps this module importable in dev tests /
 * degraded environments where the package is absent).
 */
import { parseHex } from './codecs.js';

let cachedDefineTool;
async function loadDefineTool() {
  if (cachedDefineTool !== undefined) return cachedDefineTool;
  try {
    cachedDefineTool = (await import('@deepseek-ai/dsh-tools')).defineTool;
  } catch {
    // Dev/test shim: registry-ready definition = the plain options object.
    cachedDefineTool = (opts) => opts;
  }
  return cachedDefineTool;
}

// ── small schema/render helpers (dsh-tools ValueSchemaSpec DSL) ─────────
const objectSchema = (properties) => ({ type: 'object', properties, additionalProperties: false });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const integer = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const boolean = (description, extra = {}) => ({ type: 'boolean', description, ...extra });
const array = (items) => ({ type: 'array', items });
/** render helper: (args, value) => ContentBlock[] (a text block). */
const textRender = (fn) => (_args, value) => [{ type: 'text', text: fn(value) }];

/** Generate a fresh session id when the caller does not supply one. */
function newSessionId() {
  return `serial:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Build the byte payload for a write: { text } | { hex }, + newline. */
function writeBytes(input) {
  let bytes;
  if (typeof input?.hex === 'string') {
    bytes = parseHex(input.hex);
  } else if (typeof input?.text === 'string') {
    bytes = new TextEncoder().encode(input.text);
  } else {
    return null;
  }
  const nl = input?.newline;
  if (nl === 'CRLF') { const out = new Uint8Array(bytes.length + 2); out.set(bytes); out.set([0x0d, 0x0a], bytes.length); return out; }
  if (nl === 'LF') { const out = new Uint8Array(bytes.length + 1); out.set(bytes); out[bytes.length] = 0x0a; return out; }
  if (nl === 'CR') { const out = new Uint8Array(bytes.length + 1); out.set(bytes); out[bytes.length] = 0x0d; return out; }
  return bytes;
}

/**
 * Define the `serial_*` tool set bound to a shared serial service.
 * @param {ReturnType<import('./serial-service.js').createSerialService>} service
 */
export async function defineSerialTools(service) {
  const defineTool = await loadDefineTool();
  const logLineSchema = objectSchema({
    seq: integer('会话内序号'),
    tsMs: integer('epoch 毫秒'),
    iso: str('ISO 时间'),
    dir: str('方向', { enum: ['RX', 'TX', 'Q', 'AR'] }),
    level: str('级别', { enum: ['V', 'D', 'I', 'W', 'E'] }),
    text: str('按所选编码解码后的文本'),
    hex: str('HEX 表示'),
    bytes: integer('字节数'),
  });
  const portInfoSchema = objectSchema({
    path: str('端口路径'),
    label: str('展示名'),
    vendorId: str('USB vendor id'),
    productId: str('USB product id'),
    serialNumber: str('序列号'),
    manufacturer: str('厂商名'),
    usbVendorId: integer('USB vendor id（十进制）'),
    usbProductId: integer('USB product id（十进制）'),
  });

  return [
    defineTool({
      name: 'serial_list_ports',
      description: '枚举本机串口（含 USB 描述符 / 友好名），用于让 agent 发现可用调试端口。',
      parameters: {},
      output: {
        schema: objectSchema({ ports: array(portInfoSchema) }),
        render: textRender((v) => (v.ports.length === 0 ? '未发现串口' : `发现 ${v.ports.length} 个串口：` + v.ports.map((p) => `${p.label} (${p.path})`).join('，'))),
      },
      async execute() { return { ports: await service.list() }; },
    }),
    defineTool({
      name: 'serial_open',
      description: '打开串口，返回 sessionId（后续 serial_write / serial_read / serial_get_log / serial_close 使用）。重复打开同一 sessionId 会先关闭旧端口。',
      parameters: {
        sessionId: str('可选；不填自动生成并返回'),
        path: str('端口路径，如 COM3 / /dev/ttyUSB0', { required: true }),
        baudRate: integer('波特率', { default: 115200 }),
        dataBits: integer('数据位', { enum: [5, 6, 7, 8], default: 8 }),
        parity: str('校验', { enum: ['none', 'even', 'odd', 'mark', 'space'], default: 'none' }),
        stopBits: str('停止位（"1" / "1.5" / "2"）', { enum: ['1', '1.5', '2'], default: '1' }),
        flowControl: str('流控', { enum: ['none', 'hardware', 'xonxoff', 'dsrdtr'], default: 'none' }),
        encoding: str('接收解码编码（utf-8/gbk/big5/shift_jis 等）', { default: 'utf-8' }),
        hex: boolean('日志同时记录 HEX 表示', { default: false }),
      },
      output: {
        schema: objectSchema({
          sessionId: str('会话句柄'),
          opened: boolean('是否已打开'),
          opts: objectSchema({ baudRate: integer('波特率'), dataBits: integer('数据位'), parity: str('校验'), stopBits: integer('停止位'), flowControl: str('流控') }),
          info: portInfoSchema,
        }),
        render: textRender((v) => {
          const o = v.opts ?? {};
          const p = o.parity ?? 'none';
          const cfg = `${o.baudRate ?? 115200}bps ${o.dataBits ?? 8}${(p[0] ?? 'n').toUpperCase()}${o.stopBits ?? 1}` + (o.flowControl && o.flowControl !== 'none' ? `, flow:${o.flowControl}` : '');
          return `串口打开成功：${v.info?.path ?? v.sessionId}，当前配置：${cfg}，sessionId：${v.sessionId}`;
        }),
      },
      async execute(args) {
        const sessionId = args.sessionId || newSessionId();
        try {
          return await service.open(sessionId, args.path, {
            baudRate: args.baudRate, dataBits: args.dataBits, parity: args.parity,
            stopBits: args.stopBits === undefined ? undefined : Number(args.stopBits),
            flowControl: args.flowControl,
          }, { encoding: args.encoding, hex: args.hex });
        } catch (e) {
          const cfg = `${args.baudRate ?? 115200}/${args.dataBits ?? 8}/${args.parity ?? 'none'}/${args.stopBits ?? 1}` + (args.flowControl ? `, flow:${args.flowControl}` : '');
          throw new Error(`打开串口 ${args.path} 失败（配置 ${cfg}）：${e.message ?? e}`);
        }
      },
    }),
    defineTool({
      name: 'serial_write',
      description: '向已打开的串口写文本或 HEX（可选换行追加，dir 标记发送来源）。',
      parameters: {
        sessionId: str('serial_open 返回的会话句柄', { required: true }),
        text: str('文本内容（与 hex 二选一）'),
        hex: str('HEX 串（与 text 二选一，如 "41 42 43"）'),
        newline: str('换行追加', { enum: ['none', 'CRLF', 'LF', 'CR'], default: 'none' }),
        dir: str('发送来源标记', { enum: ['TX', 'Q', 'AR'], default: 'TX' }),
      },
      output: {
        schema: objectSchema({ ok: boolean('是否成功'), bytes: integer('写入字节数'), tsMs: integer('epoch 毫秒') }),
        render: textRender((v) => `已发送 ${v.bytes} 字节`),
      },
      async execute(args) {
        const bytes = writeBytes(args);
        if (!bytes) throw new Error('需提供 text 或 hex');
        return service.write(args.sessionId, bytes, args.dir || 'TX');
      },
    }),
    defineTool({
      name: 'serial_read',
      description: '读取串口最近 N 行结构化日志（带毫秒时间戳、方向、级别、文本），供 agent 查看设备最新输出。',
      parameters: {
        sessionId: str('serial_open 返回的会话句柄', { required: true }),
        limit: integer('返回行数', { default: 50 }),
      },
      output: {
        schema: objectSchema({ lines: array(logLineSchema) }),
        render: textRender((v) => v.lines.map((l) => `[${l.tsMs}] ${l.dir}${l.level ? `/${l.level}` : ''}: ${l.text}`).join('\n') || '（无日志）'),
      },
      async execute(args) {
        return service.readLines(args.sessionId, args.limit || 50);
      },
    }),
    defineTool({
      name: 'serial_get_log',
      description: '按条件拉取会话结构化日志（时间/级别/方向过滤），用于分析设备交互与响应时序。',
      parameters: {
        sessionId: str('serial_open 返回的会话句柄', { required: true }),
        since: integer('仅返回 tsMs >= since 的行'),
        level: str('按级别过滤', { enum: ['V', 'D', 'I', 'W', 'E'] }),
        dir: str('按方向过滤', { enum: ['RX', 'TX', 'Q', 'AR'] }),
        limit: integer('返回行数上限', { default: 500 }),
      },
      output: {
        schema: objectSchema({ lines: array(logLineSchema), total: integer('会话日志总行数') }),
        render: textRender((v) => `共 ${v.total} 行，返回 ${v.lines.length} 行` + (v.lines.length ? '\n' + v.lines.map((l) => `[${l.tsMs}] ${l.dir}: ${l.text}`).join('\n') : '')),
      },
      async execute(args) {
        return service.getLog(args.sessionId, args);
      },
    }),
    defineTool({
      name: 'serial_close',
      description: '关闭串口会话并释放端口。',
      parameters: {
        sessionId: str('serial_open 返回的会话句柄', { required: true }),
      },
      output: {
        schema: objectSchema({ ok: boolean('是否成功'), closed: boolean('是否已关闭') }),
        render: textRender((v) => (v.closed ? '串口已关闭' : '该会话不存在')),
      },
      async execute(args) {
        return service.close(args.sessionId);
      },
    }),
  ];
}

/**
 * Register all `serial_*` tools against the host tool runtime. Requires
 * `'tools'` in the plugin's `inject`. Returns a disposer that unregisters.
 * @param {import('cordis').Context} ctx
 * @param {ReturnType<import('./serial-service.js').createSerialService>} service
 */
export async function registerTools(ctx, service) {
  const disposers = [];
  for (const tool of await defineSerialTools(service)) {
    disposers.push(ctx.tools.register(tool));
  }
  return () => { for (const d of disposers) d(); };
}
