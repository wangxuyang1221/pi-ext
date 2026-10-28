# Print refusal and RPC approval

## Sub-features

- `permissions-print`：print/json 无 UI 时拒绝需要审批的修改。
- `permissions-rpc`：RPC 通过客户端审批，拒绝不写入，确认后才执行；Full access 升级也须确认。
- `permissions-headless-upgrade`：无 UI 的 print/json 拒绝升级 full。

## How to get to it (user POV)

Pi `--print --mode json`、`--mode rpc`，修改工具以及 `/permissions full`。RPC 虽没有本地 TUI，仍通过 `extension_ui_request` 提供交互审批。

## Driving it with Pi CLI and RPC

先完成 [Launch 与 Doctor](../SKILL.md)，再运行：

```bash
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run permissions-modes
```

驱动用隔离配置和固定模型响应，真实 CLI、审批策略和 write 保持生产实现。所有子进程显式设置 `PI_PERMISSIONS_MODE=default`，依次验证：

1. print/json 发送 WRITE_PROOF：工具结果解释没有 UI，proof.txt 不存在。
2. print/json 先执行 `/permissions full` 再请求写入：升级被拒绝，文件仍不存在。
3. RPC prompt 请求写入，客户端收到 `extension_ui_request` 的 select；回复同一 id 的 `extension_ui_response`、value=Deny，等待 agent_end，文件不存在。
4. RPC `/permissions full` 的确认选择器取消后，再次写入仍需审批。
5. RPC 接受 `Yes, continue anyway` 后再写入，文件内容为 approved 加换行，该次写入没有再次审批。

核对 evidence 中的 journey.json、三个进程的 stdout/stderr、RPC 发送动作和最终文件。升级与工具执行分别记录，不能仅凭通知判成功。

## Gotchas

RPC 的审批请求必须由客户端回复；等待中的审批不是“无 UI 拒绝”。本驱动验证了拒绝、取消升级和接受升级，未证明失联客户端的全部超时/重连行为。普通 TUI smoke 也不能替代本入口。

当前 host-compatibility 和 permission-policy 测试没有覆盖上述完整 CLI/RPC 旅程。它们只能作具体断言的补充证据，不能当作这些行为已经通过的依据。清理标准遵循 [共享说明](../../verify-pi-ext/README.md#cleanup)。
