# dsh-shinki-serial-monitor

DSH 底部面板**串口监控（Serial Monitor）**插件：端口检测/选择、HEX 与文本收发、多编码显示、**毫秒级时间戳结构化日志**；AI 可对接（`serial_*` agent 工具）+ OTA 二进制传输。功能对标 `UCANFD/tool/serial_debug`，参考 `eclipse-cdt-cloud/vscode-serial-monitor` 的双后端分层。

**当前版本：v0.2.0（M0+M1 + 串口占用视图，issue #4；2026-09-02 真实环境验证 OK）**

- **双后端**：浏览器 **Web Serial API**（M0，零原生依赖，NW.js/Chromium 桌面壳可用）+ **host `serialport`**（M1 核心数据面，agent 工具 + 完整串口参数）。
- **默认底部面板打开**：经 `ctx.betterSidebar.registerTab` 注册（两个 Tab：串口监视器 + 串口占用），首次打开自动搬移到底部面板（`tab.meta.dockedBottom` 门控一次）。
- **结构化毫秒日志**：`LogLine{seq, tsMs, iso, dir, level, text, hex, bytes}` 为 UI 与 agent 共用模型（总目标载体）。
- **串口占用视图（issue #4）**：列出 host 后端已打开的串口及其**占用会话**（AI 会话/本地面板），可**更新串口参数**、**关闭串口**（操作会**回传给占用它的会话**）；点击**监听**进入会话详情，分两个页签：**数据交换**（默认按 AI 配置的编码/格式呈现，可切换**显示编码**与 **text/hex/esc** 模式——只影响本地展示，不影响 AI 调用侧）与**操作日志**（AI `serial_*` 工具调用 + **用户操作→AI 的回传记录**）。

## 安装

```sh
# 本地开发（link: 方式）
dsh plugin --profile web add link:/绝对路径/plugin/web/dsh-shinki-serial-monitor

# 或从 npm 安装（发布后）
dsh plugin --profile web add dsh-shinki-serial-monitor
```

M1 host 后端需 `serialport@^12`（原生模块，走 plugins-ensure `npm install --prefix` + npmmirror 预编译二进制；未安装时插件优雅降级为仅 Web Serial）。

## 卸载

```sh
dsh plugin --profile web remove dsh-shinki-serial-monitor
```

## 设置（声明式，`pluginSettings`）

- **启动自动打开**（switch）
- **默认波特率**（select）、**默认模式**（文本/HEX）
- **接收最大行数**（number）
- **串口后端**（自动 / Web Serial / Host）

## 架构

- **host 半区**（`lib/index.js`，inject：`webServer`/`webRuntime`/`tools`/`agents`/`sessionTitle`）：`/shinki-serial/status` + `POST /shinki-serial/api`（`list/open/write/read/getLog/update/close/stats`）+ `serial_*` agent 工具（含 `serial_occupancy`）；信任围栏（回环 + `--trusted-host`）；会话注册表 + **单端口独占锁 + owner 归属** + 环形日志缓冲 + 单写者锁（`lib/serial-service.js`）。用户关闭/改参动作经 `ctx.agents` + `ctx.sessionTitle` 装配：查占用会话 → `agent.followup` 一条中文动作消息。
- **browser 半区**（`lib/client.js`，自包含 bundle，内联共享工具副本）：`registerTab` **双 Tab**——①串口监视器（端口检测/热插拔、HEX/文本、编码切换、ms 时间戳 + 级别着色、采集状态指示）；②**串口占用** `SerialSessionsTab`（占用列表轮询 `stats`、行内参数编辑、关闭并回传、attach 只读实时监听——**数据交换 / 操作日志双页**，操作页轮询 `opLog`）。
- **共享纯模块**：`codecs`（12 编码解码 + HEX + 时间戳）、`levels`（级别检测着色）、`buffer`（环形缓冲 + 行切分）、`presets`、`logline`（结构化毫秒日志）。

## 测试

```sh
node --test            # 在插件目录（49 用例：codecs/levels/buffer/presets/logline/tools/serial-service）
```

## 已知限制

- **串口占用视图仅覆盖 host 后端**打开的端口（AI `serial_open` 或本地面板走 host）；浏览器 Web Serial 直连的端口不经 host，不出现在占用列表。
- **动作回传 / 会话标题**依赖 dsh 运行时 `agents` 与 `sessionTitle` 服务（已在真实 dsh 环境验证 OK，2026-09-02）；服务不可用时占用/关闭仍工作，仅通知投递降级（响应带 `notify.delivered:false`）。
- **Web Serial 参数**：仅 7/8 数据位、none/even/odd 校验、1/2 停止位、none/hardware 流控（默认 8N1 覆盖主场景）；完整参数走 M1 host 后端。
- **TX 编码**：`TextEncoder` 仅支持 UTF-8——发送侧 GBK/BIG5 等回退 UTF-8（接收解码全覆盖）；中文 GBK 发送需 `iconv-lite`（后续）。
- **换波特率**：Web Serial 需关闭重开（UI `reopen()` 封装）；host 后端支持运行时 `update`。
- **M1 待接线**：`/shinki-serial/ws` WebSocket 流式推送未接线（当前 HTTP 轮询；监听区 300ms 轮询 `read` 增量拉取）。
- **OTA（M4）**：`serial_send_file` / XMODEM / YMODEM 未实现，见 `doc/设计-串口监控插件.md`。

## 设计文档

`doc/设计-串口监控插件.md`（项目 doc/ 下）：目标（G1 agent 可调用 / G2 OTA / G3 快速预览）、架构、里程碑 M0–M4、ADR。
