# Label editing and icon preference

验证 skill-mentions 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `skill-icon-cube`：cube 图标显示。
- `skill-icon-command`：command 图标持久偏好。
- `skill-cursor`：光标移动保持原文位置。
- `skill-selection`：分别验证标签整体删除及终端拖选复制的原文。
- `skill-undo`：撤销恢复原始草稿。
- `skill-mouse`：鼠标命中对应文本。
- `skill-resize`：长标签和窄屏重新排版。

## How to get to it (user POV)

/skill-label-icon cube|command；箭头/删除/撤销/鼠标；resize。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- skills helper 通过本地 pi install 加载当前 checkout 的 dist，不做 pnpm 发布包安装；发布 tarball 另跑 skill-mentions:acceptance。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui skill-mentions`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 驱动切换图标、编辑整体标签、撤销、长标签分页和窄屏 resize；检查 agent/skill-mentions.json、编辑器原文及提交文本。重开后图标偏好保持，缺字环境用 command。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/skill-mentions/__tests__/label-editor.test.ts extensions/skill-mentions/__tests__/label-body.test.ts extensions/skill-mentions/__tests__/label-preference.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

Backspace/Delete 整体删除、SGR 点击定位和终端拖选复制是不同操作。现有 PTY 自动旅程覆盖前两项；拖选复制需可观察的真实终端与已授权的剪贴板操作，核对复制内容为原始 $skill 文本。只有删除/点击证据时，skill-selection 保持 unverified，并单列已通过部分。物理字体和 IME 同样不能由 pyte 单元格推断。

fixture 重绑 F8 撤销、F3 展开和 Ctrl+P/N 历史，这是脚本前置配置，不是产品默认键位。

验收依据为 [label-editor.test.ts](../../../../extensions/skill-mentions/__tests__/label-editor.test.ts)、[label-body.test.ts](../../../../extensions/skill-mentions/__tests__/label-body.test.ts)、[label-preference.test.ts](../../../../extensions/skill-mentions/__tests__/label-preference.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
