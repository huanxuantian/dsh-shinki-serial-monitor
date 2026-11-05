# dsh-shinki-serial-monitor

DSH Web GUI 的**串口监控插件**：在底部面板（或右侧栏）打开串口，收发 HEX/文本、按所选编码显示，
并把每次收发记成带毫秒时间戳的结构化日志。

插件分两半 —— host 半边（`serialport` 数据面 + `/shinki-serial` 路由 + agent 工具）与浏览器半边
（面板视图，走 Web Serial 或 host HTTP）；两侧共用同一条 `LogLine` 模型。

刻意只做"调试串口 + 让 AI 读日志"这条链路：不做协议解析、不做自动应答脚本、不做波形分析，
OTA 文件传输（XMODEM/YMODEM）也未实现。

---

## 功能

| 区域 | 能力 |
|---|---|
| 串口监视器视图 | 端口枚举 / 刷新 / 添加端口、打开与关闭、连接状态；Web Serial 后端支持设备插拔后自动刷新列表；首次打开自动搬到底部面板（每标签只做一次） |
| 收发 | 文本 / HEX / 转义三种显示模式（转义模式把不可打印字节渲染成 `\xHH`）；发送文本或 HEX，可追加 CRLF / LF / CR，方向标记 TX / Q / AR |
| 编码 | 12 个编码选项：ASCII、UTF-8、GBK、GB2312、GB18030、BIG5、UTF-16 LE/BE、Latin-1、Windows-1252、Shift-JIS、EUC-KR |
| 结构化日志 | 每行 `LogLine{seq, tsMs, iso, dir, level, text, hex, bytes}`；`HH:mm:ss.mmm` 时间戳、RX 级别识别（V/D/I/W/E）与配色、清屏、自动滚动、RX 合并窗口；面板保留最近 2000 行，host 环形日志 10000 行 |
| 后端选择 | 自动 / Web Serial / Host；自动优先 host（完整端口列表与全部线路参数），host 不可用时回落到 Web Serial |
| 串口占用视图 | 列出 host 后端打开的串口、占用方（AI 会话 / 本地面板）、线路参数与 AI 侧编码；可改参、关闭（动作回传占用会话）、「监听」进入只读实时视图 |
| 监听详情 | 双页签：「数据交换」（显示编码与 text/hex/esc 可切换，仅影响本地展示）与「操作日志」（AI 工具调用 + 用户动作回传记录） |
| agent 工具 | `serial_ports`（list / occupancy）与 `serial`（open / write / read / log / close） |
| 插件设置 | `pluginToggles` 声明：启动自动打开、默认波特率 / 模式、线路参数默认值、接收最大行数、RX 合并间隔、串口后端（部分键尚未接线，见「容易踩的坑」） |

---

## 核心设计

- **一份服务、两个出口**：`createSerialService()` 在 `apply(ctx)` 里只创建一次，同时喂给 HTTP 路由
  （面板走 host 后端时用）与 `serial` / `serial_ports` 工具，所以用户与 AI 看到同一个会话注册表、
  同一份日志、同一把写锁（`writeChain` 串行化写入）。
- **单端口独占 + owner 归属**：`byPath` 保证一个端口同一时刻只属于一个 sessionId；被占时 `open`
  返回 `port-busy`，除非显式 `takeover`（会先关掉占用方）。每次打开都记 `owner`：工具调用记
  `{kind:'agent', id: 会话 id}`，HTTP 面板打开记 `{kind:'ui'}` —— 占用视图的"谁占着这个口"就来自这里。
- **用户动作回传给 AI**：用户在占用视图改参或关闭 agent 持有的端口时，host 用注入的 `notifyOwner`
  钩子查 `ctx.agents` 拿到那个会话，`agent.followup(createUserMessage(...))` 投一条中文提示（端口、
  会话 id、新参数或关闭原因）；投递结果写进 `notify.delivered` 与操作日志，投递失败不影响关闭本身。
- **权限围栏**：`/shinki-serial/*` 只接受回环 socket，或 Host 头命中 `ctx.web.trustedHosts`（取不到时
  退化为仅回环），因此对外暴露的 dsh web 不能借浏览器驱动本机串口；请求体上限 256 KB。
- **工具面合并**：`lib/tools.js` 定义 7 个 `serial_*` 规格，再按类合并成 `serial_ports` + `serial` 两个
  入口（`mergeToolSpecs`）；同名参数类型冲突用 `transform` 改写（`hexMode`→`hex`、`hexBytes`→`hex`），
  输出仍走原规格的 `render`。
- **各自降级**：`serialport` 解析失败时 host 半边只报 `serial-unavailable`，面板自动落到 Web Serial；
  `tools` 注册失败只打警告，不影响路由与视图。

---

## HTTP API（host 半边）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/shinki-serial/status` | 探针，返回 `pluginVersion`、`backend`（`host` 或 `webserial-only`）与 `hostAvailable` |
| POST | `/shinki-serial/api` | 请求体 `{ sessionId, method, ...payload }`；成功 `{ ok: true, value }`，业务失败返回 HTTP 200 + `{ ok: false, error: { code, message } }` |

`/api` 支持的 method（`lib/routes.js`）：

- `list` 枚举端口；`open` 打开端口（未带 `extra.owner` 时记为本地面板）。
- `write` 发送 `text` 或 `hex`（可选 `newline`）；`read` 取最近 N 行，默认 50。
- `getLog` 按 `since` / `level` / `dir` / `limit` 过滤；`opLog` 取操作事件；`stats` 取占用快照。
- `update` / `close` 是 UI 侧改参与关闭，会回传占用会话；`close` 可传 `notify: false` 关闭回传。

围栏与协议错误走 4xx：非回环且不在白名单 403、非 `application/json` 415、缺 `method` 或未知 method 400。

---

## 目录结构

```
dsh-shinki-serial-monitor/
├── package.json          # dsh.bundle.patch + dsh.client(platform: web)
├── cordis.patch.yml      # 把插件行插进 profile roster
├── lib/
│   ├── index.js          # host 半边：装配服务、挂 /shinki-serial、注册工具
│   ├── routes.js         # status + JSON 分派（method 白名单）
│   ├── serial-service.js # 会话注册表 / 端口独占锁 / 环形日志 / 回传钩子
│   ├── tools.js          # 7 个 serial_* 规格 → 合并成 2 个入口
│   ├── trust-fence.js    # 回环 / 受信 Host 栅栏
│   ├── client.js         # 浏览器半边：两个视图（自包含 bundle）
│   ├── serial-backend.js # 浏览器双后端：Web Serial / host HTTP
│   ├── bottom-dock.js    # 首次打开把标签搬到底部面板
│   ├── buffer.js         # 环形缓冲 / 行切分 / 时间窗合并
│   ├── codecs.js         # 编码表 + HEX + 时间戳
│   ├── levels.js         # 级别检测与配色
│   ├── logline.js        # LogLine 构造
│   ├── presets.js        # 波特率表 / 默认参数 / Web Serial 子集
│   └── locales.js        # zh / en 文案（命名空间 serialMonitor）
├── tests/                # node --test，8 个文件 56 例
└── REPLAY-NOTES.md       # 历史重演说明
```

---

## 安装与生效

前置：宿主需已安装 `dsh-shinki-sidebar-tools`（提供 `shinkiViews` 视图中间件；缺失时插件不注册任何
视图，只在控制台打一行等待超时日志）。`dsh-better-sidebar` 可选：探测到时用于标签页 `meta` 更新与
设置快照。

1. **放行原生模块构建**，否则 pnpm 会以 `ERR_PNPM_IGNORED_BUILDS` 让整条安装失败：

   ```powershell
   $profileDir = "$env:USERPROFILE\.dsh\profiles\desktop"
   @"
   allowBuilds:
     '@serialport/bindings-cpp': true
   "@ | Add-Content "$profileDir\pnpm-workspace.yaml"
   ```

2. **登记进 profile**：

   ```sh
   dsh plugin --profile desktop add "file:E:\TEST\dsh-plugin\dsh-shinki-serial-monitor"
   ```

   该命令跑 pnpm 并把包名追加进 profile 的 `dsh.profile.bundles`，插件自带的 `cordis.patch.yml`
   （`dsh.bundle.patch`）作为 bundle 层生效 —— 这**不同于**手工往 `cordis.patch.yml` 写 `insert`
   roster 行，只写 roster 不会被 Loader 挂载。本地反复迭代可用 `link:` 代替 `file:`（源码即被服务，
   改完刷新即可，host 半边仍需重启）。换别的 profile 时把 `desktop` 换成目标 profile 名即可。

3. **验证原生绑定可用**：`serial_ports`（`action: list`）应能枚举出本机串口；Node 侧等价检查是从
   profile 目录加载 `serialport` 后调 `SerialPort.list()`。只装 JS 依赖时插件会**自动降级为仅
   Web Serial**，表现为工具报后端不可用（`serial-unavailable`）。

4. **生效**：官方客户端是**热挂载**的 —— `dsh plugin add` 完成后通常**不需要重启**，运行中的会话里
   立刻出现 `serial` / `serial_ports` 工具。没生效时再重启客户端。

5. **卸载**：`dsh plugin --profile desktop remove dsh-shinki-serial-monitor`。

> ⚠️ 生效副本是 profile 里 pnpm 安装的那份快照（`file:` 不是软链）。改源码后必须重跑第 2 步刷新
> 快照，或改用 `link:`；host 半边（`lib/*.js`）改动需重启 dsh web。

### 官方 DSH 桌面端的 profile 名（实测）

官方桌面端在启动代码里写死了它用的 profile（`@deepseek-ai/dsh-desktop-host/lib/index.js` 的 `main()`）：

```js
const profile = loadProfileDirectory("dsh", projectDir, installAnchor);
const application = runProfile({ profile: "desktop", args: ["--no-open", "--port", "19387"] });
```

即目录 `%USERPROFILE%\.dsh\profiles\desktop`。**不要用 agent shell 里的 `DSH_HOME` / `DSH_PROFILE_DIR`
判断目标 profile**：机器上若还留着旧的可移植（EAC）实例，它指向另外的 profile（本机是 `web-desktop`），
装到那里对官方客户端完全无效。

---

## 环境要求

- Node 20+（`package.json` 的 `engines`）。
- `serialport` ^12 原生模块。未安装或构建被拦截时插件自动降级为仅 Web Serial。
- 图形宿主 + Chromium 桌面壳：Web Serial 走 `navigator.serial`。
- 无外部 CLI 依赖，`serialport` 之外没有系统级安装步骤。
- 视图依赖 `dsh-shinki-sidebar-tools`。

---

## 开发

```sh
node --test        # 8 个文件 56 例：codecs、levels、buffer、presets、logline、
                   # serial-service（注入假 serialport）、tools、回归护栏
```

测试不需要 `node_modules`：`serialport` 由测试注入假实现，`@deepseek-ai/dsh-tools` 走内置兜底 schema。
本仓库是 DSH 插件，脱离宿主（dsh web + 桌面壳）无法独立运行。

### 容易踩的坑

- **`node --test tests/` 在 Node ≥ 22 会报 `MODULE_NOT_FOUND`**（目录参数被当成模块入口）。用不带参数
  的 `node --test`，`package.json` 的 `scripts.test` 就是后者。
- **dsh 工具输出边界很严**：`additionalProperties: false`，且只接受 lossless JSON。工具 `execute` 只能
  回传 schema 声明过的字段（早期多回传 `owner` / `notify` 导致 registry 拒收整条结果，agent 拿不到
  sessionId 而端口仍被占用）；可选值不能是 `undefined` / `NaN`（`dropNonJson` 兜底）。
- **cordis 要求 inject 声明**：host 半边用到 `webServer` / `tools` / `agents` / `sessionTitle`，另读
  `ctx.web.trustedHosts`；未声明的属性直接访问会抛 "cannot get property ... without inject"。
- **`lib/client.js` 是自包含 bundle**，内联了 `codecs` / `buffer` / `presets` / `logline` / `levels` /
  `bottom-dock` / `serial-backend` 的副本；改这些纯模块必须同步改 `client.js`，否则面板与 host 行为不一致。
- **设置项有未接线分支**：`autoOpen`、`defaultMode`、`rxMaxLines` 只在 `pluginToggles` 里声明，代码中
  没有消费方；面板初始化读的是 `prefs.baud`，与设置的 `defaultBaud` 键不一致，所以改设置页的默认
  波特率不会影响已开标签页（每个标签自己记住的 `meta` 优先）。
- **`/shinki-serial/ws` 未接线**：监听区靠 HTTP 轮询，不是推送（占用列表 1200 ms、监听数据 300 ms、
  操作日志 1000 ms）。

### 版本号

当前 `package.json` 为 **0.2.10**。`lib/routes.js` 与 `lib/client.js` 各自硬编码了一份 `PLUGIN_VERSION`
（浏览器半边读不到 `package.json`），**两处仍是 0.2.4**：`GET /shinki-serial/status` 返回的
`pluginVersion` 与面板角标显示的都是 0.2.4。改版本时三处一起改。

版本按实际功能增量走，不随每次提交自动累加。发布 npm 包时 `files` 白名单只带 `lib`、
`cordis.patch.yml`、`README.md`，发布前先同步上面三处版本号。

---

## 许可

Apache-2.0（见 `LICENSE`）。

---

## 相关路线图（依赖提示）

- 视图注册依赖 `dsh-shinki-sidebar-tools` 的 `shinkiViews`：`lib/client.js` 里 `waitService(ctx,
  'shinkiViews')` 轮询等待，服务缺失时只记日志、不注册视图，不阻塞插件激活。`dsh-better-sidebar`
  仅可选，用于标签页 `meta` 更新与设置快照。
- 未完成：`/shinki-serial/ws` 流式推送（当前 HTTP 轮询）、M4 OTA（`serial_send_file` / XMODEM /
  YMODEM）。
- 完整计划见 `../dsh-shinki-sidebar-tools/README.md` 的「路线图」小节。
