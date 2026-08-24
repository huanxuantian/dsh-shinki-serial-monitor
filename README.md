# dsh-shinki-serial-monitor

DSH 底部面板**串口监控（Serial Monitor）**插件：端口检测/选择、HEX 与文本收发、多编码显示、**毫秒级时间戳结构化日志**；AI 可对接（`serial_*` agent 工具）+ OTA 二进制传输。功能对标 `UCANFD/tool/serial_debug`，参考 `eclipse-cdt-cloud/vscode-serial-monitor` 的双后端分层。

**当前版本：v0.1.0（M0+M1 骨架）**

- **双后端**：浏览器 **Web Serial API**（M0，零原生依赖，NW.js/Chromium 桌面壳可用）+ **host `serialport`**（M1 核心数据面，agent 工具 + 完整串口参数）。
- **默认底部面板打开**：经 `ctx.betterSidebar.registerTab` 注册，首次打开自动搬移到底部面板（`tab.meta.dockedBottom` 门控一次）。
- **结构化毫秒日志**：`LogLine{seq, tsMs, iso, dir, level, text, hex, bytes}` 为 UI 与 agent 共用模型（总目标载体）。

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

- **host 半区**（`lib/index.js`）：`/shinki-serial/status` + `POST /shinki-serial/api`（`list/open/write/read/getLog/update/close/stats`）+ `serial_*` agent 工具；信任围栏（回环 + `--trusted-host`）；会话注册表 + 环形日志缓冲 + 单写者锁（`lib/serial-service.js`）。
- **browser 半区**（`lib/client.js`，自包含 bundle，内联共享工具副本）：`registerTab` + 底部面板搬移 + 最小串口监视 UI（端口检测/热插拔、HEX/文本、编码切换、ms 时间戳 + 级别着色、采集状态指示）。
- **共享纯模块**：`codecs`（12 编码解码 + HEX + 时间戳）、`levels`（级别检测着色）、`buffer`（环形缓冲 + 行切分）、`presets`、`logline`（结构化毫秒日志）。

## 测试

```sh
node --test            # 在插件目录（28 用例：codecs/levels/buffer/presets/logline/tools）
```

## 已知限制

- **Web Serial 参数**：仅 7/8 数据位、none/even/odd 校验、1/2 停止位、none/hardware 流控（默认 8N1 覆盖主场景）；完整参数走 M1 host 后端。
- **TX 编码**：`TextEncoder` 仅支持 UTF-8——发送侧 GBK/BIG5 等回退 UTF-8（接收解码全覆盖）；中文 GBK 发送需 `iconv-lite`（后续）。
- **换波特率**：Web Serial 需关闭重开（UI `reopen()` 封装）；host 后端支持运行时 `update`。
- **M1 待接线**：`/shinki-serial/ws` WebSocket 流式推送与 dsh 工具注册 API 需在真实运行时确认（当前 HTTP 轮询 + 探测式注册）。
- **OTA（M4）**：`serial_send_file` / XMODEM / YMODEM 未实现，见 `doc/设计-串口监控插件.md`。

## 设计文档

`doc/设计-串口监控插件.md`（项目 doc/ 下）：目标（G1 agent 可调用 / G2 OTA / G3 快速预览）、架构、里程碑 M0–M4、ADR。
