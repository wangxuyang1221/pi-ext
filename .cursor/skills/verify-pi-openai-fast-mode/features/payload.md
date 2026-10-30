# Priority requests and unsupported models

验证 openai-fast-mode 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `fast-openai`：OpenAI 模型精确匹配。
- `fast-codex`：Codex 任意模型注入 priority。
- `fast-unmatched`：非目标模型不注入。
- `fast-unsupported`：Codex 明确不支持后提示失败与标准重试。
- `fast-error-scope`：Codex 拒绝后的禁用只限当前会话和模型。

## How to get to it (user POV)

选择匹配模型后发送消息；遇到明确不支持 Fast 的错误后重试。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- fast footer 只表示请求 priority，不证明服务端使用了 priority 或响应更快。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-openai-fast-mode/scripts/verify.mjs full`。provider 种子、实际终端输入和期望值见 [request journey](../scripts/README.md)。
2. 对照 journey 的 checks、events 和相应画面逐项核对下表。不能从零退出码单独判定通过。
3. 运行共享 `run subagent`，补充不同 child/session 的拒绝隔离。读取 evidence 的 fast-source.json、fast-dist.json 请求和 checkpoint。最后按需运行下列定向测试定位错误。

| ID | Required observation |
| --- | --- |
| fast-openai | 七个当前默认名单逐次通过真实 `/model` 选择并发送 priority 请求 |
| fast-codex | 两个任意 Codex ID 和 managed child 均注入 priority |
| fast-unmatched | 相似 OpenAI ID、第三方同名 ID 无字段；切回匹配模型恢复 |
| fast-unsupported | 明确 unsupported 请求失败并提示用户重试；无自动重放；用户重试仅一个标准请求 |
| fast-error-scope | 被拒模型切走切回、off/on 后仍标准；其他模型和 sibling 仍 priority；普通 400 不禁用；新 session 恢复 priority；配置仍 true |

```bash
pnpm test extensions/openai-fast-mode/__tests__/payload-status.test.ts extensions/openai-fast-mode/__tests__/extension.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

两个入口均使用真实 request builder，在 fetch 边界记录序列化 payload 并返回固定离线响应。它们证明本地发出的字段与错误处理，不证明远端采用 priority、billing 或性能。定向测试补充 429、网络、普通 400 与暂时不可用错误，认证错误文案未纳入该矩阵；远程错误实测另记层级。

验收依据为 [payload-status.test.ts](../../../../extensions/openai-fast-mode/__tests__/payload-status.test.ts)、[extension.test.ts](../../../../extensions/openai-fast-mode/__tests__/extension.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
