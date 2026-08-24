/**
 * dsh-shinki-serial-monitor host half: mounts the serial service HTTP/WS
 * routes (`/shinki-serial/*`) and the `serial_*` agent tools once the web
 * profile activates. The browser half (lib/client.js) registers the bottom
 * panel tab and renders the serial monitor.
 *
 * M0: the browser half can talk serial via the Web Serial API with NO host
 * involvement (this host half then only exposes /shinki-serial/status).
 * M1: the host `serialport` data plane becomes the core (serves the UI via
 * HTTP/WS and the agent via serial_* tools) — see lib/serial-service.js.
 */
import { createHandler } from './routes.js';
import { createSerialService } from './serial-service.js';
import { registerTools } from './tools.js';

export const name = 'dsh-shinki-serial-monitor';

/**
 * Services required before mounting (cordis inject). `webServer` mounts the
 * HTTP prefix; `webRuntime` feeds the trust fence's --trusted-host list;
 * `tools` is the host tool runtime that `serial_*` tools register against
 * (cordis REQUIRES declaring every accessed service here — accessing an
 * undeclared ctx property throws "cannot get property ... without inject").
 * Serial ports are host-global (not session-scoped), but sessionId is
 * carried for per-session log association / agent correlation.
 */
export const inject = ['webServer', 'webRuntime', 'tools'];

/**
 * @param {import('cordis').Context} ctx
 */
export function apply(ctx) {
  // One shared serial service instance drives routes AND agent tools, so
  // the UI (host backend) and the agent see the same sessions + ms log.
  const service = createSerialService(ctx);

  ctx.effect(() => {
    const disposers = [
      // HTTP: GET /shinki-serial/status + POST /shinki-serial/api
      ctx.webServer.register({
        kind: 'prefix',
        path: '/shinki-serial',
        handler: createHandler(ctx, service),
      }),
    ];
    // Agent tools (serial_*): registered against ctx.tools (async load of
    // @deepseek-ai/dsh-tools). A failure here must NOT take down the plugin
    // tree — routes/UI keep working; the agent just lacks serial_* tools.
    registerTools(ctx, service)
      .then((d) => { disposers.push(d); })
      .catch((e) => { console.warn('[dsh-shinki-serial-monitor] serial_* 工具注册失败：', e?.message ?? e); });
    return () => { for (const d of disposers) d(); };
  }, 'dsh-shinki-serial-monitor: host');
}

// NOTE (M1 follow-up): WebSocket RX streaming (`/shinki-serial/ws`) is
// designed in doc/设计-串口监控插件.md §6.2 but NOT wired yet — the exact
// `ctx.webServer.register({kind:'ws',...})` surface must be confirmed
// against the real dsh (model: better-sidebar `/sidebar/ws/terminal`).
// Until then the browser half streams RX over HTTP polling; switching to
// WS is a drop-in for HostSerialBackend (see lib/serial-backend.js).
