/**
 * HTTP surface of the plugin under the `/shinki-serial` prefix:
 *  - GET  /shinki-serial/status        → availability / version probe
 *  - POST /shinki-serial/api           → { sessionId, method, ... } dispatch
 * Every method is dispatched against the shared serial service; the trust
 * fence (loopback + --trusted-host) guards all of them.
 */
import { createFence } from './trust-fence.js';
import { parseHex } from './codecs.js';

const API_PATH = '/shinki-serial/api';
const STATUS_PATH = '/shinki-serial/status';
const MAX_BODY_BYTES = 256 * 1024; // HEX payloads can be large-ish

const PLUGIN_VERSION = '0.1.0';

/** Read a JSON body with a size cap. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(text)); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

const OK = (value) => ({ ok: true, value });
const FAIL = (error) => ({ ok: false, error: { code: error.code ?? 'internal', message: error.message } });

/** Encode a payload as bytes: { text } or { hex } → Uint8Array. */
function payloadBytes(payload) {
  if (typeof payload?.text === 'string') return new TextEncoder().encode(payload.text);
  if (typeof payload?.hex === 'string') return parseHex(payload.hex);
  return null;
}

/**
 * Build the route handler bound to one shared serial service.
 * @param {{webRuntime?: any}} ctx
 * @param {ReturnType<import('./serial-service.js').createSerialService>} service
 */
export function createHandler(ctx, service) {
  const fence = createFence(ctx);

  return async (req, res) => {
    const gate = fence.check(req);
    if (!gate.ok) { writeJson(res, 403, FAIL(gate)); return; }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;

    if (pathname === STATUS_PATH) {
      const backend = await service.available();
      writeJson(res, 200, OK({ pluginVersion: PLUGIN_VERSION, backend: backend ? 'host' : 'webserial-only', hostAvailable: backend }));
      return;
    }
    if (pathname !== API_PATH || req.method !== 'POST') {
      res.writeHead(404); res.end(); return;
    }
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      res.writeHead(415); res.end(); return;
    }
    let payload;
    try { payload = await readJsonBody(req); }
    catch { writeJson(res, 400, FAIL({ code: 'bad-request', message: '请求体需为合法 JSON' })); return; }

    const method = typeof payload?.method === 'string' ? payload.method : '';
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : '';
    if (method === '') { writeJson(res, 400, FAIL({ code: 'bad-request', message: '缺少 method' })); return; }

    try {
      switch (method) {
        case 'list': {
          writeJson(res, 200, OK({ ports: await service.list() }));
          return;
        }
        case 'open': {
          const value = await service.open(sessionId, String(payload.path ?? ''), payload.opts, payload.extra);
          writeJson(res, 200, OK(value));
          return;
        }
        case 'write': {
          if (sessionId === '') { writeJson(res, 400, FAIL({ code: 'bad-request', message: '缺少 sessionId' })); return; }
          const bytes = payloadBytes(payload);
          if (!bytes) { writeJson(res, 400, FAIL({ code: 'bad-request', message: '需提供 text 或 hex' })); return; }
          writeJson(res, 200, OK(await service.write(sessionId, bytes, payload.dir ?? 'TX')));
          return;
        }
        case 'read': {
          if (sessionId === '') { writeJson(res, 400, FAIL({ code: 'bad-request', message: '缺少 sessionId' })); return; }
          writeJson(res, 200, OK(await service.readLines(sessionId, Number.isInteger(payload.limit) ? payload.limit : 50)));
          return;
        }
        case 'getLog': {
          if (sessionId === '') { writeJson(res, 400, FAIL({ code: 'bad-request', message: '缺少 sessionId' })); return; }
          writeJson(res, 200, OK(await service.getLog(sessionId, payload)));
          return;
        }
        case 'update': {
          if (sessionId === '') { writeJson(res, 400, FAIL({ code: 'bad-request', message: '缺少 sessionId' })); return; }
          writeJson(res, 200, OK(await service.update(sessionId, payload.opts)));
          return;
        }
        case 'close': {
          writeJson(res, 200, OK(await service.close(sessionId)));
          return;
        }
        case 'stats': {
          writeJson(res, 200, OK(service.stats()));
          return;
        }
        default: {
          writeJson(res, 400, FAIL({ code: 'bad-request', message: `未知 method: ${method}` }));
        }
      }
    } catch (e) {
      writeJson(res, 200, FAIL({ code: e.code ?? 'internal', message: e.message }));
    }
  };
}
