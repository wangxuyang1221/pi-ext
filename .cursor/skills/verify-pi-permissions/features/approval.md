# Approval and file side effects

## Sub-features

| ID | Observable result |
| --- | --- |
| `permissions-allow-once` | write/edit/bash/MCP 在批准前没有副作用，Allow once 后实际执行；再次调用仍需审批。 |
| `permissions-deny` | 四种工具 Deny 和 Escape 后文件不变，MCP 没有请求。 |
| `permissions-deny-note` | 四种工具 Deny with note 后不执行，后续模型请求中的真实 toolResult 含输入说明。 |
| `permissions-cancel-call` | 四种工具 Cancel 后无副作用，tool result 为 aborted，模型没有接续请求。 |
| `permissions-read-safe` | read/grep/find/ls 完成且没有审批，目录文件不变。 |

## Drive

完成 [Launch 与 Doctor](../SKILL.md)，运行：

```bash
pnpm exec node .cursor/skills/verify-pi-permissions/scripts/run.mjs matrix
```

驱动使用正式 [provider.ts](../scripts/provider.ts) 的 `VERIFY_TOOL {"name":"write","args":{"path":"example.txt","content":"approved\n"}}` 种子协议，真实工具仍由 Pi 执行。矩阵已包含 edit 的原文件、bash 的真实写入和 alpha/beta 两个本地 MCP server；无需审计临时文件或外部服务。

检查 `matrix/journey.json` 每次 action 的 beforeFiles/afterFiles、beforeCalls/afterCalls、choice，连同 events 和 mcpEvents。Allow once 后逐项核对文件字节或 server 参数；拒绝、说明拒绝和取消须保持快照相同。取消还需检查 aborted 与没有后续模型请求，不能只检查文件不存在。

## Regression sensitivity

```bash
pnpm exec node .cursor/skills/verify-pi-permissions/scripts/regression.mjs
```

正常 probe 应通过，隔离副本禁用 Deny 后同一 probe 应因实际禁写文件产生而失败。`regression.json` 记录两次 evidence，副本保留供审查，生产源码无需恢复。

## Supplemental checks

`pnpm test extensions/permissions/__tests__/permission-policy.test.ts` 只补充其明确断言的规则，不替代真实工具和文件验证。
