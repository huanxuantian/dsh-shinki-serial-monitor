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
 * `tools` is the host tool runtime that `serial_*` tools register against;
 * `agents` (live agent registry) + `sessionTitle` (dsh session titles) power
 * the occupancy feature: they let a USER close/update an AGENT-owned port and
 * deliver that action back to the owning conversation session.
 * (cordis REQUIRES declaring every accessed service here — accessing an
 * undeclared ctx property throws "cannot get property ... without inject".)
 * Serial ports are host-global; sessionId is carried for per-session log
 * association / agent correlation.
 */
export const inject = ['webServer', 'tools', 'agents', 'sessionTitle'];   // 0.2.1: webRuntime 已移除（服务名改为 ctx.web，且我们只做可选读取）

/** Lazy-load @deepseek-ai/dsh-llm (engine-embedded; absent in dev tests). */
let cachedCreateUserMessage;
async function loadCreateUserMessage() {
  if (cachedCreateUserMessage !== undefined) return cachedCreateUserMessage;
  try {
    cachedCreateUserMessage = (await import('@deepseek-ai/dsh-llm')).createUserMessage;
  } catch {
    cachedCreateUserMessage = null;
  }
  return cachedCreateUserMessage;
}

function shortCfg(opts) {
  if (!opts) return '';
  const p = (opts.parity || 'none')[0]?.toUpperCase() ?? 'N';
  return `${opts.baudRate ?? '?'}/${opts.dataBits ?? 8}${p}${opts.stopBits ?? 1}`;
}

/** One-line Chinese notice describing a user action for the owning agent. */
function describeOwnerAction(session, action) {
  const path = session.info?.path ?? session.id;
  if (action?.kind === 'close') {
    const reason = action.reason ? `原因：${action.reason}。` : '';
    return `【串口占用通知】用户在「串口占用」面板关闭了你（本会话）打开的串口 ${path}（会话 ${session.id}）。该端口已释放，请勿继续对其读写；如需继续调试请用 serial_open 重新打开。${reason}`;
  }
  if (action?.kind === 'update') {
    const ch = action.changes || {};
    const bits = [];
    if (ch.baudRate != null) bits.push(`波特率=${ch.baudRate}`);
    if (ch.dataBits != null) bits.push(`数据位=${ch.dataBits}`);
    if (ch.parity != null) bits.push(`校验=${ch.parity}`);
    if (ch.stopBits != null) bits.push(`停止位=${ch.stopBits}`);
    if (ch.flowControl != null) bits.push(`流控=${ch.flowControl}`);
    return `【串口占用通知】用户修改了你（本会话）打开的串口 ${path}（会话 ${session.id}）的参数：${bits.join('、') || '无'}。当前配置 ${shortCfg(session.opts)}，请确认与设备端一致后继续调试。`;
  }
  return `【串口占用通知】串口 ${path}（会话 ${session.id}）发生了用户操作。`;
}

/**
 * @param {import('cordis').Context} ctx
 */
export function apply(ctx) {
  // One shared serial service instance drives routes AND agent tools, so
  // the UI (host backend) and the agent see the same sessions + ms log.
  const service = createSerialService({
    // User close/update on an agent-owned port → deliver the action back to the
    // owning dsh conversation session (a user-role followup wakes the agent so
    // it reacts: stop writing / re-open / re-sync params).
    notifyOwner: async ({ session, action }) => {
      try {
        const owner = session?.owner;
        if (!owner || owner.kind !== 'agent' || !owner.id) return { delivered: false, reason: 'no-agent-owner' };
        const agent = ctx.agents?.get?.(owner.id);
        if (!agent) return { delivered: false, reason: 'agent-not-live' };
        const createUserMessage = await loadCreateUserMessage();
        if (!createUserMessage) return { delivered: false, reason: 'dsh-llm-unavailable' };
        const text = describeOwnerAction(session, action);
        agent.followup(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: 'dsh-shinki-serial-monitor' },
        }));
        return { delivered: true, kind: action?.kind, path: session.info?.path ?? null };
      } catch (e) {
        return { delivered: false, error: String(e?.message ?? e) };
      }
    },
    // Occupancy view shows the owning dsh session's title when resolvable.
    resolveOwnerTitle: (agentId) => {
      try {
        const agent = ctx.agents?.get?.(agentId);
        if (!agent) return undefined;
        const snap = ctx.sessionTitle?.get?.(agent.session);
        return snap?.title ?? undefined;
      } catch { return undefined; }
    },
  });

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
