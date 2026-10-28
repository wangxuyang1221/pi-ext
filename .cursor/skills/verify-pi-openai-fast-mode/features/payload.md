# Priority requests and unsupported models

验证 openai-fast-mode 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `fast-openai`：OpenAI 模型精确匹配。
- `fast-codex`：Codex 任意模型注入 priority。
- `fast-unmatched`：非目标模型不注入。
- `fast-unsupported`：明确不支持后提示失败与标准重试。
- `fast-error-scope`：禁用只限当前会话和模型。

## How to get to it (user POV)

选择匹配模型后发送消息；遇到明确不支持 Fast 的错误后重试。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- fast footer 只表示请求 priority，不证明服务端使用了 priority 或响应更快。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run subagent`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui openai-fast-mode`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行真实 root/child 验收，读取 fast-source.json 与 fast-dist.json 中的请求 payload。补跑定向测试核对 openai 精确名单、openai-codex 任意模型、非目标模型及明确 unsupported 后仅当前会话当前模型停止注入。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/openai-fast-mode/__tests__/payload-status.test.ts extensions/openai-fast-mode/__tests__/extension.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

subagent helper 使用合成 provider 记录 payload。不能据此声称真实 OpenAI 服务采用了 priority；模糊网络或认证错误不得禁用 Fast。

验收依据为 [payload-status.test.ts](../../../../extensions/openai-fast-mode/__tests__/payload-status.test.ts)、[extension.test.ts](../../../../extensions/openai-fast-mode/__tests__/extension.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
