# Search queries and result presentation

验证 codex-search 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `search-responses`：responses 查询批次。
- `search-standalone`：standalone 独立网页动作。
- `search-progress`：查询进度逐项更新。
- `search-sources`：汇总来源与引用。
- `search-expand`：展开查询详情。
- `search-error`：失败保留诊断。
- `search-timeout`：超时单独展示。
- `search-cancel`：取消停止请求。

## How to get to it (user POV)

codex_search；可选 codex_standalone_web；Ctrl+O；Esc。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- codex-search 不在 package.json 的 pi.extensions 中。使用 -e extensions/codex-search/src/index.ts；不得把八扩展发布包检查当作搜索已打包。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-search`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 真实 Pi TUI 播放查询进度，检查 2/5 queries completed，再到 17 sources · 5 queries；展开逐项查询与来源。驱动还覆盖失败、超时及重启；查看状态颜色和未泄漏内部请求 JSON。协议定向测试核对实际请求构造。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-search/__tests__/codex.test.ts extensions/codex-search/__tests__/renderers.test.ts extensions/codex-search/__tests__/compact-renderers.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

离线 fixture 替换搜索结果，不证明实时网页准确性、账号认证或 freshness。实时查询需已授权账号，记录 query、来源和请求边界。

验收依据为 [codex.test.ts](../../../../extensions/codex-search/__tests__/codex.test.ts)、[renderers.test.ts](../../../../extensions/codex-search/__tests__/renderers.test.ts)、[compact-renderers.test.ts](../../../../extensions/codex-search/__tests__/compact-renderers.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
