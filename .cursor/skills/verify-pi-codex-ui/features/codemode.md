# Codemode tree and inspector

验证 codex-ui 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `ui-codemode-order`：调用树按开始顺序保持父子。
- `ui-codemode-failure`：父完成仍显示子失败。
- `ui-inspect-tabs`：inspect 切换 Calls/Script/Output。
- `ui-inspect-scroll`：选择与滚动显示对应详情。
- `ui-codemode-cache`：缓存淘汰明确标识缺失。
- `ui-codemode-resume`：恢复只重建已保存元数据。

## How to get to it (user POV)

codemode 工具；Ctrl+O；/inspect；Tab/Shift+Tab；方向键/翻页。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 普通 TUI 与 fullscreen 是不同入口。renderer 固定帧不能替代真实工具执行的文件副作用核验。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run codex-ui`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-ui`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 真实 QuickJS 与本地 MCP 执行后，检查 Script completed 和 1 failed、Output to model 与子结果分离。打开 /inspect 切换 Calls/Script/Output、resize、恢复/compaction 后显示 Raw result unavailable。默认 many 的 24 个调用全部成功，不覆盖预览外失败或缓存淘汰；补充种子需让第 7 个调用失败，确认折叠摘要仍显示失败，再实际读取足够大的结果超过 4MiB，核对旧项 Raw result unavailable 和末项仍可查看。另用真实方向键、PgDn/PgUp、Shift+Tab 核对选中项及正文滚动，记录实际驱动与断言。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-ui/__tests__/codemode-integration.test.ts extensions/codex-ui/__tests__/codemode-model.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

另运行 codex-ui-fullscreen。缓存缺失不能当作工具失败或回滚，父脚本完成不能当全部子调用成功。

验收依据为 [codemode-integration.test.ts](../../../../extensions/codex-ui/__tests__/codemode-integration.test.ts)、[codemode-model.test.ts](../../../../extensions/codex-ui/__tests__/codemode-model.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
