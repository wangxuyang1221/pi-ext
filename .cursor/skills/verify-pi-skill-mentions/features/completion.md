# Inline skill completion

验证 skill-mentions 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `skill-dollar`：任意合法位置美元符号补全。
- `skill-multiline`：多行引用定位正确。
- `skill-tab`：Tab 选择候选。
- `skill-enter-select`：首次 Enter 只选择。
- `skill-enter-send`：菜单关闭后 Enter 发送。
- `skill-boundaries`：代码转义与邻接边界不误激活。

## How to get to it (user POV)

输入 用 $re；Tab/Enter 候选；再次 Enter 发送。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- skills helper 通过本地 pi install 加载当前 checkout 的 dist，不做 pnpm 发布包安装；发布 tarball 另跑 skill-mentions:acceptance。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui skill-mentions`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 驱动创建 alpha/beta/research/Unicode skills，输入中间或多行 $ 引用，用 Tab 和 Enter 补全。第一次 Enter 只选候选，第二次才产生 request；代码、转义、左侧紧邻正文保持原文。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/skill-mentions/__tests__/autocomplete.test.ts extensions/skill-mentions/__tests__/references.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

不同 editor 与 fullscreen 必须独立跑。脚本 native 模式只证明原生编辑器，不自动覆盖 CodexEditor。

验收依据为 [autocomplete.test.ts](../../../../extensions/skill-mentions/__tests__/autocomplete.test.ts)、[references.test.ts](../../../../extensions/skill-mentions/__tests__/references.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
