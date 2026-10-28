# Long objectives and attachments

验证 goal 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `goal-long`：超长目标写内容包。
- `goal-content-edit`：编辑展开完整正文。
- `goal-attachment-copy`：确认复制图片附件。
- `goal-attachment-text`：选择仅保留路径文本。
- `goal-content-cancel`：取消不改变旧目标。
- `goal-content-validation`：限制和路径校验失败保留旧状态。

## How to get to it (user POV)

/goal 输入超过 4000 Unicode 字符；/goal edit；提交 Pi 临时图片路径。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 只在持久化 root TUI 验证自动推进；临时会话、headless、managed child 和无普通 function tools 的模型不具备同一执行保证。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui goal`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 在同一次隔离 TUI 用括号粘贴输入长目标，暂停后 /goal edit 检查完整正文；从该次 Pi 临时目录创建合法 pi-clipboard 图片，分别选择 Copy attachment、Keep as text、Cancel。读取 goals/content 与权威引用，删除临时源后附件仍可用。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/goal/__tests__/content.test.ts extensions/goal/__tests__/content-paths.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

tool-ui 不覆盖内容 UI。不得读取真实剪贴板。正文 1 MiB、32 图、单图 20 MiB、路径/符号链接/校验和失败需要边界证据；已提交旧包不得在清理目标时误删。

验收依据为 [content.test.ts](../../../../extensions/goal/__tests__/content.test.ts)、[content-paths.test.ts](../../../../extensions/goal/__tests__/content-paths.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
