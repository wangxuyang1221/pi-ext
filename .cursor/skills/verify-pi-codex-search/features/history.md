# Search history across resume and reload

验证 codex-search 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `search-resume`：恢复显示搜索摘要。
- `search-reload`：reload 保留历史卡片。
- `search-disabled-history`：禁用新请求仍展示历史。
- `search-theme`：主题切换正确渲染。
- `search-fullscreen`：fullscreen 恢复路径。

## How to get to it (user POV)

/resume；/reload；Ctrl+O；禁用工具后打开旧历史。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- codex-search 不在 package.json 的 pi.extensions 中。使用 -e extensions/codex-search/src/index.ts；不得把八扩展发布包检查当作搜索已打包。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search-resume`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-search`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行 regular/fullscreen/disabled 三种真实 TUI；检查 1 source · 1 query · 13s、展开、主题及 reload，禁用新请求仍保留历史卡片。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-search/__tests__/history-renderers.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

driver 预置历史用于恢复验证，不代表本次进行了实时搜索；需与 queries 的实际调用证据分别报告。

验收依据为 [history-renderers.test.ts](../../../../extensions/codex-search/__tests__/history-renderers.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
