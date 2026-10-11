/**
 * 回归护栏（静态）：本仓库曾用 catch { cachedDefineTool = (opts) => opts; } 兜底，
 * 而 dsh 的 register() 是原样入库、只有 defineTool() 会把参数规格表转成 JSON Schema
 * （注入 type:'object'）—— 于是缺依赖时参数表被当成 schema 发给 provider，
 * 报 got 'type: null' 并让每一轮对话失败（BLE 插件实测，2026-10-11）。本用例锁死该写法。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../lib/tools.js', import.meta.url), 'utf8');

test('兜底不得恒等返回选项对象', () => {
  assert.ok(!/cachedDefineTool = \(opts\) => opts;/.test(src),
    "不得保留 cachedDefineTool = (opts) => opts;（会把参数表当 schema 发给 provider）");
});

test('兜底必须自建合法 JSON Schema（type=object）', () => {
  assert.match(src, /type: 'object'/, '兜底分支必须产出 { type: "object", properties, additionalProperties:false }');
});

test('必须有来源自报（便于下次一眼看出走哪条分支）', () => {
  assert.match(src, /dsh-tools/, '应打印 defineTool 来源');
});
