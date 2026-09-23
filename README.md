# dsh-shinki-serial-monitor

DSH 底部面板**串口监控（Serial Monitor）**插件：端口检测/选择、HEX 与文本收发、多编码显示、**毫秒级时间戳结构化日志**；AI 可对接（`serial_*` agent 工具）+ OTA 二进制传输。功能对标常见的串口调试上位机，参考 `eclipse-cdt-cloud/vscode-serial-monitor` 的双后端分层。

**当前版本：v0.2.2**（v0.2.1 起 HEX 模式会话正文直接输出字节 HEX + 字节数，便于抓取分析二进制流；v0.2.2 为版本号提升与面板配色加固）

> 代码托管：**主库** [GitHub](https://github.com/huanxuantian/dsh-shinki-serial-monitor) ｜ **备用库** [自建 Git（cpolar 隧道）](https://shinkidocker.cpolar.cn/huanxuantian/dsh-shinki-serial-monitor)（详见「安装 → 仓库地址」）

- **双后端**：浏览器 **Web Serial API**（M0，零原生依赖，NW.js/Chromium 桌面壳可用）+ **host `serialport`**（M1 核心数据面，agent 工具 + 完整串口参数）。
- **默认底部面板打开**：经 `ctx.betterSidebar.registerTab` 注册（两个 Tab：串口监视器 + 串口占用），首次打开自动搬移到底部面板（`tab.meta.dockedBottom` 门控一次）。
- **结构化毫秒日志**：`LogLine{seq, tsMs, iso, dir, level, text, hex, bytes}` 为 UI 与 agent 共用模型（总目标载体）。
- **串口占用视图（issue #4）**：列出 host 后端已打开的串口及其**占用会话**（AI 会话/本地面板），可**更新串口参数**、**关闭串口**（操作会**回传给占用它的会话**）；点击**监听**进入会话详情，分两个页签：**数据交换**（默认按 AI 配置的编码/格式呈现，可切换**显示编码**与 **text/hex/esc** 模式——只影响本地展示，不影响 AI 调用侧）与**操作日志**（AI `serial_*` 工具调用 + **用户操作→AI 的回传记录**）。

## 安装

前置：宿主需已安装 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（提供 `ctx.betterSidebar` 面板注册服务）。

```sh
# 从 npm 安装（发布后）
dsh plugin --profile web add dsh-shinki-serial-monitor

# 从主库 GitHub 安装
dsh plugin --profile web add github:huanxuantian/dsh-shinki-serial-monitor

# 从备用库安装（GitHub 访问不畅时；同一份代码，同一个 main）
dsh plugin --profile web add git+https://shinkidocker.cpolar.cn/huanxuantian/dsh-shinki-serial-monitor.git

# 本地开发（link: 方式：改完重启 dsh web 生效）
dsh plugin --profile web add link:/绝对路径/dsh-shinki-serial-monitor
```

安装后重启 `dsh web`。**仅支持 web profile**。

host 后端（M1）需要 `serialport`（原生模块）：未安装或不可用时插件**自动降级为仅 Web Serial**；
若包管理器默认拦截原生模块的构建脚本，按其提示放行该依赖的构建即可。

### 仓库地址

| 用途 | 地址 |
|---|---|
| 主库（GitHub） | <https://github.com/huanxuantian/dsh-shinki-serial-monitor> |
| 备用库（自建 Git，cpolar 隧道） | <https://shinkidocker.cpolar.cn/huanxuantian/dsh-shinki-serial-monitor> |

两处内容一致（同一个 `main` 分支；以主库为准）。克隆或换源：

```sh
git clone https://github.com/huanxuantian/dsh-shinki-serial-monitor.git            # 主库
git clone https://shinkidocker.cpolar.cn/huanxuantian/dsh-shinki-serial-monitor.git # 备用库
git remote set-url origin https://shinkidocker.cpolar.cn/huanxuantian/dsh-shinki-serial-monitor.git  # 只换抓取源
```

> 备用库走自建隧道，域名/IP 可能变化；长期不可用时以主库为准。

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
node --test            # 在插件目录（53 用例：codecs/levels/buffer/presets/logline/tools/serial-service）
```

## 已知限制

- **串口占用视图仅覆盖 host 后端**打开的端口（AI `serial_open` 或本地面板走 host）；浏览器 Web Serial 直连的端口不经 host，不出现在占用列表。
- **动作回传 / 会话标题**依赖 dsh 运行时 `agents` 与 `sessionTitle` 服务（已在真实 dsh 环境验证 OK，2026-09-02）；服务不可用时占用/关闭仍工作，仅通知投递降级（响应带 `notify.delivered:false`）。
- **Web Serial 参数**：仅 7/8 数据位、none/even/odd 校验、1/2 停止位、none/hardware 流控（默认 8N1 覆盖主场景）；完整参数走 M1 host 后端。
- **TX 编码**：`TextEncoder` 仅支持 UTF-8——发送侧 GBK/BIG5 等回退 UTF-8（接收解码全覆盖）；中文 GBK 发送需 `iconv-lite`（后续）。
- **换波特率**：Web Serial 需关闭重开（UI `reopen()` 封装）；host 后端支持运行时 `update`。
- **M1 待接线**：`/shinki-serial/ws` WebSocket 流式推送未接线（当前 HTTP 轮询；监听区 300ms 轮询 `read` 增量拉取）。
- **OTA（M4）**：`serial_send_file` / XMODEM / YMODEM 未实现（后续里程碑）。

## 设计要点

- 目标：G1 agent 可调用（`serial_*` 工具） / G2 OTA 二进制传输 / G3 快速预览（面板即时收发）。
- 分层：浏览器半包（Web Serial + 面板）与 host 半包（`serialport` + agent 工具 + 会话占用/回传）各自可独立降级；
  两者共用同一份结构化日志模型 `LogLine`（见「架构」）。
- 里程碑：M0 Web Serial → M1 host 后端与 agent 工具 → M2 编码/级别/预设 → M3 占用视图与动作回传 → M4 OTA（未完成）。
