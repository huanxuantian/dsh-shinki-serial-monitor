# 历史重演说明（REPLAY-NOTES）

本仓库是 **`dsh-shinki-serial-monitor` 插件**的独立工程，其历史由原单仓 `dsh_nwjs`
中 `plugin/web/dsh-shinki-serial-monitor` 目录的历史**重演**而来。

## 来源

| 项 | 值 |
|---|---|
| 原仓库 | `dsh_nwjs`（本机 `D:\AI\dsh_nwjs`） |
| 原路径 | `plugin/web/dsh-shinki-serial-monitor` |
| 重演提交数 | 8（覆盖该目录自创建起的全部改动） |
| 时间范围 | 2026-08-24 ～ 2026-09-11 |
| 重演方式 | git 底层原语逐提交重建：导出该提交的插件子树 → 入索引 → `commit-tree`（不引入原仓库其他模块的对象） |

## 与原历史的差异（有意为之）

1. **身份统一**：所有重演提交的**作者与提交者**均为
   `huanxuantian <huanxuantian@msn.cn>`；**日期沿用原始提交**，时间线保持不变。
2. **提交信息脱敏**：只保留与 serial-monitor 插件相关的描述。原仓库中跨模块的混合提交
   （8 条里有 6 条同时改了其他插件/宿主接线/单仓文档）已人工重写，剔除其他模块、宿主打包链、
   单仓文档与索引、本机环境实测细节等无关内容；主题 scope 统一为 `(serial-monitor)`。
3. **内容范围**：仅插件代码目录本身 —— `lib/`、`tests/`、`package.json`、`cordis.patch.yml`、
   `README.md`。原仓库其他路径不在本仓库内。
4. **独立工程适配**（唯一一处代码改动）：`package.json` 的测试脚本由
   `node --test tests/` 改为 **`node --test`**（Node ≥ 22 会把目录参数当模块入口，报
   `MODULE_NOT_FOUND`）；其余源码与上游一致。另加 `.gitignore` 与本说明。
5. 目标目录原有的 `LICENSE`（Apache-2.0）与骨架提交 `Initial commit` 予以保留，
   重演的历史接在其后。

## 运行与复核

```bash
git log --oneline     # 骨架提交 + 8 条重演提交
node --test           # 全量测试（53 例；无需 node_modules，测试对宿主能力做了 shim）
```

说明：本仓库是 **DSH 插件**，脱离宿主（dsh web + Electron 壳）无法独立运行；
`react`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm` 等由宿主在运行期提供，
`serialport` 为声明依赖（宿主环境内已随引擎提供）。
