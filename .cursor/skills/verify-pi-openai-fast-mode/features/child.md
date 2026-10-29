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
2. 宿主组的 Fast case 在真实 SDK root 调用生产 `subagent_spawn`，启动生产 dist 的私有 tmux child。逐项检查下表。源文件为 [fast-production.test.ts](../../../../extensions/subagent/__tests__/fast-production.test.ts)。
3. 证据 fast-source.json、fast-dist.json 的 requests 是实际序列化请求，steps 是操作后的 pane 与完整 session，sharedFiles 是每个 checkpoint 的 root/角色配置字节，sessions 是实际 managed session 的完整 JSONL。coldResumes 保存原 managed child 的 sessionFile、冷启动 CLI 参数、首个请求、画面和最终 session。SDK 恢复与 CLI 冷恢复分别记录。
4. 另运行 Fast `full`，补充仅加载 Fast 的受控 child 环境中 launch=true、`--fast` 与保存值冲突的优先级。此种子不替代真实 managed spawn。最后按需运行下列测试定位边界。

| ID | Required observation |
| --- | --- |
| fast-child-inherit | root true/false 均继承；root 当前模型不匹配时，enabled=true 仍传给显式匹配模型 child；父子/sibling 后续开关独立 |
| fast-child-override | explicit false 覆盖 root/role true；explicit true 覆盖 root/role false，读取 child 初始 session 值和首请求 |
| fast-role | role true/false 覆盖 root；空 role 继承；root reload 更新角色且不改既有 child launch |
| fast-child-reload | child 保存 false 后 reload 保持 false；保存 true 后 reload 保持 true，两次都再发请求 |
| fast-child-resume | 原 `subagent_spawn` 产生的 true/false session 在 child 退出后，用实际 CLI `--session` 冷启动，无 launch 环境且加 `--fast`，保存值优先并发送后续请求；另保留 SDK 恢复证据 |
| fast-shared-config | 上述动作、退出和恢复后的 root/角色文件逐字节不变 |

```bash
pnpm test extensions/openai-fast-mode/__tests__/child-session.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

只验证 root on/off 的真实 child 继承且已有 dist 时，使用 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run fast-managed`，无需安装或构建。先读 [spawn](../../verify-pi-subagent/features/spawn.md)。`managed.json` 保留每个 child 的 launch、首请求及清理 PID；`journey.json` 保留真实按键和画面。该入口还在 agent 内保留活动私有 socket，验证 capture 跳过特殊文件但保存普通配置，随后 End session 关闭 child。它只覆盖 `fast-child-inherit` 的 root on/off 子分支，不替代本文件完整矩阵。

此入口运行 subagent 的完整宿主组，是产品内被测 child，不是委派本任务。需 tmux 和 fish；缺失任一工具即 blocked。冷恢复启动真实 CLI 并读取原 managed session，但重启进程仅加载 Fast 与离线 provider，未重新接入 subagent 管理器；管理器恢复和重新接管另按 subagent skill 验收。

验收依据为 [child-session.test.ts](../../../../extensions/openai-fast-mode/__tests__/child-session.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
