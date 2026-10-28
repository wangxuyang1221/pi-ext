# Child Fast Mode inheritance

验证 openai-fast-mode 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `fast-child-inherit`：child 继承 root 默认值。
- `fast-child-override`：显式参数覆盖默认值。
- `fast-role`：角色 fast 默认参与选择。
- `fast-child-reload`：child reload 保留开关。
- `fast-child-resume`：恢复读取 session 保存值。
- `fast-shared-config`：child 不改 root 与角色配置。

## How to get to it (user POV)

subagent_spawn 的 fast/agent_type；child /fast；/reload；恢复同一 child session。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- fast footer 只表示请求 priority，不证明服务端使用了 priority 或响应更快。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run subagent`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui openai-fast-mode`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 宿主组用真实私有 tmux child 验证接收任务、/fast 和 reload；恢复用例通过 SDK SessionManager.open 读取同一 child session。分别记录这两层证据，检查 session custom entry、payload 及 root/角色配置字节不变。若验收 CLI 冷恢复，另在同一受控目录停止 child、用原 sessionFile 重启 CLI 并再次发请求，核对保存值优先于启动初值；缺少此步骤时保留该分支 unverified。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/openai-fast-mode/__tests__/child-session.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

此入口运行 subagent 的完整宿主组，是产品内被测 child，不是委派本任务。需 tmux 和 fish；缺失任一工具即 blocked。

验收依据为 [child-session.test.ts](../../../../extensions/openai-fast-mode/__tests__/child-session.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
