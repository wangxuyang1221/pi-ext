# Low-power rendering

验证 codex-ui 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `ui-lowpower-on`：启用短工具预览。
- `ui-lowpower-off`：关闭恢复完整显示。
- `ui-lowpower-status`：status 只查询。
- `ui-lowpower-reset`：reload 或会话替换恢复默认。

## How to get to it (user POV)

/lowpower on；/lowpower off；/lowpower status；/reload。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 普通 TUI 与 fullscreen 是不同入口。renderer 固定帧不能替代真实工具执行的文件副作用核验。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run tool-status`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-ui`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 比较开关前后 write/edit/bash/codemode 的短预览与展开，Thinking 保留全文；status 不更改值，reload 或新会话恢复关闭。确认 lowpower 下 Write 不采集旧正文或生成 diff。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-ui/__tests__/index.test.ts extensions/codex-ui/__tests__/rendering-pipeline.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

低功耗不改变工具执行和底层文件。是否未读取旧正文需要执行测试的 I/O 证据，不能从短卡片推断。

验收依据为 [index.test.ts](../../../../extensions/codex-ui/__tests__/index.test.ts)、[rendering-pipeline.test.ts](../../../../extensions/codex-ui/__tests__/rendering-pipeline.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
