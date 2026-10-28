# Model metadata configuration

验证 codex-compact 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `metadata-status`：查询有效版本和来源。
- `metadata-save`：保存全局目录版本。
- `metadata-reset`：重置时保留其他字段。
- `metadata-project-priority`：受信任项目版本优先。
- `metadata-invalid`：非法版本不写配置。

## How to get to it (user POV)

/codex-metadata；/codex-metadata version 0.157.0；/codex-metadata reset。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 远程压缩只适用于 openai-codex/openai-codex-responses。离线 CLI 使用 faux 模型，只能验收配置命令；远程协议由真实 SDK 加 HTTP 边界夹具验证，线上质量需要另行实跑。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run metadata`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-compact`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 读取状态不创建配置；设置后从 agent/pi-codex-compact.json 读回 metadataClientVersion；reset 保留驱动种入的其他字段。再运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run metadata-project`：它在新隔离 workspace/.pi 中种入版本 0.158.0，以 --approve 冷启动该进程，验证项目覆盖、全局保存/reset 不改项目字节及六种非法输入不写文件。
4. 对两个 evidence 目录分别运行 [skill Helpers](../SKILL.md#helpers) 的 `check-metadata.mjs`。核对普通场景的 default → global → default，以及项目场景始终为 project；每个状态必须在当前 Effective 通知后出现完整 Usage 尾行。共享驱动只检查屏幕上出现 Usage，不能独自证明当前通知绘制完整。检查器失败时保留原证据，运行 doctor 后重开隔离会话复查。
5. 对照以下已有定向测试定位边界。它们是补充证据，不替代命令动作、画面和文件结果。

```bash
pnpm test extensions/codex-compact/__tests__/metadata-command.test.ts extensions/codex-compact/__tests__/config.test.ts extensions/codex-compact/__tests__/model-metadata.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

metadata 与 metadata-project 是未信任和显式信任两个冷启动。后者只信任本次生成的 workspace，不写用户信任设置；没有测试交互 /trust 后重启的流程。若验收 /trust，须用可重开的专用驱动在同一隔离目录完成信任与重启，普通 tui helper 退出后会删除 scratch，不能接着复用。目录 GET 的缓存、未知 hash 与账号隔离由定向测试补充，不能用命令未报错证明联网目录可用。

验收依据为 [metadata-command.test.ts](../../../../extensions/codex-compact/__tests__/metadata-command.test.ts)、[config.test.ts](../../../../extensions/codex-compact/__tests__/config.test.ts)、[model-metadata.test.ts](../../../../extensions/codex-compact/__tests__/model-metadata.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
