# Print refusal and RPC approval

## Sub-features

| ID | Observable result |
| --- | --- |
| `permissions-print` | text/json print 中 write/edit/bash/MCP 需要审批时返回 no UI，文件不变，MCP 无调用。 |
| `permissions-rpc` | 四种工具均向客户端发 extension_ui_request；Deny 无副作用，回复 Allow once 后才执行；full 升级取消与接受均有后续写入验证。 |
| `permissions-headless-upgrade` | text/json print 消费 `/permissions full` 本地命令，拒绝升级，后续写入仍因 no UI 拒绝。 |

## Drive

完成 [Launch 与 Doctor](../SKILL.md)，运行：

```bash
pnpm exec node .cursor/skills/verify-pi-permissions/scripts/run.mjs headless
```

检查 `headless/journey.json` 的逐进程命令、RPC actions、events、MCP 调用和 results，结合每个进程的 stdout/stderr、工作目录及 sessions。print 的拒绝理由必须来自本次进程的 toolResult，不能由之前进程的事件推断。升级命令不能作为普通模型输入；后续真实写入仍必须拒绝。

RPC 客户端收到 select 后，先核对没有文件或服务调用，再回复匹配 id 的 extension_ui_response。Deny 后不执行，Allow once 后核对 write/bash 字节、edit 结果和 MCP 请求参数。取消 full 后下一次写入仍应审批；接受后新目标写入成功且没有审批。

## Limits

等待中的 RPC 审批不是无 UI 拒绝。本驱动不证明失联客户端的超时和重连。普通 PTY smoke 不能替代 print/RPC 入口；清理标准见 [skill](../SKILL.md#cleanup)。
