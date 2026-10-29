# Request journey

从仓库根目录在安装、build 和 doctor 后运行：

```bash
pnpm exec node .cursor/skills/verify-pi-openai-fast-mode/scripts/verify.mjs full
```

运行要求与共享 helper 相同的 Node、pnpm、Conda `codex-py312` 和 pyte。此入口不使用共享 fixture 文件或 tmux，不占共享验证锁。运行期间保持 dist 不变。

默认进程期限为 180 秒，Conda Python 路径探测另限 30 秒。`--timeout-ms <正整数>` 可缩短进程期限；`--python <绝对路径>` 可指定已经核实的 Conda Python。后者也用于验证启动失败路径。超时或中断后先给 TERM 两秒宽限，再强制回收 driver 进程组，最后依据 `owners.json` 回收独立 PTY 组。启动失败和断言失败同样归档配置，并把最终 summary 记为 failed；进程、证据归档或清理无法确认时保留 scratch，cleanup 记为 unverified。

## Seed and transport

wrapper 用 `createTestEnvironment` 创建仓库 `.tmp` 内的 HOME、agent、sessions 和 workspace。settings 关闭 retry、compaction 与 cache warming。生产 Fast dist 和 `request-provider.ts` 通过显式 `-e` 加载，关闭其他扩展和用户资源。

provider 注册七个精确匹配的 OpenAI 模型、相似但不匹配 ID、两个任意 Codex ID，以及第三方同名模型。它调用安装的真实 OpenAI/Codex adapter，仅用固定 SSE 响应替换 fetch。`reject-fast` 返回明确 unsupported 错误，`ambiguous-error` 返回普通 HTTP 400 文案，其他输入返回固定文本。所有请求在序列化后记录，零真实模型凭据、零远端服务调用。

## Actions and assertions

| Run | Actions | Required observation |
| --- | --- | --- |
| root | 空配置加 `--fast`，逐次 `/model provider/id` 并发送消息 | 配置为 true；全部精确 OpenAI 名单及任意 Codex 模型为 priority，相似 ID 和其他 provider 无字段 |
| root rejection | `reject-fast`，用户重试，off/on，再切其他模型和切回 | 失败通知明确要求重试；每次输入仅一个请求；原模型停用 priority，其他模型继续；普通 400 不停用；off/on 不清除原模型拒绝 |
| root-restarted | `/quit` 后使用同一 agent 配置启动新 session，发消息，再保存 off | 新进程恢复 priority，随后配置为 false |
| root-restarted-off | 再次冷启动并发送消息 | 保留 false，请求无 priority |
| novel-combination | `--fast`，`/fast on now`，`/reload`，切相似 ID，toggle，切匹配 ID，bare | 非法命令不改配置字节，reload 完成，三次请求依次无字段、无字段、priority |
| child-initial | 受控 child 环境初值 true，保存 off，`/reload`，发送消息 | session custom entry 保存 false；reload 后无 priority |
| child-cold-resume | 用上一 session `--session` 冷启动，launch=true 且 `--fast`，再保存 on | 保存 false 优先于启动初值和 flag；请求无 priority |
| child-resume-no-launch | 不传 child 环境，重开同一 session，发消息再 reload 发消息 | 保存 true 使宿主识别 child；两次请求均 priority，user 配置字节不变 |
| project-scope | 将实际 dist 复制到隔离项目 `.pi/extensions/fast`，`--approve --fast`，请求，保存 off | `.pi/pi-openai-fast-mode/config.json` 先 true 后 false，user 配置字节不变 |

受控 child 的种子只用于检查 Fast 自身的持久化边界。完整 managed spawn 和实际 managed session 的 CLI 冷恢复由 [child journey](../features/child.md) 提供。

## Evidence and cleanup

wrapper 首行输出 evidence 与 scratch。`owners.json` 在每次创建 PTY 后记录 driver 和全部已创建的 Pi PID，供强制退出后的核实与清理。`journey.json` 的 `runs` 保留每个实际 CLI 参数、PID、session 路径、输入、画面，以及每次动作完成后的 user/project 配置原文 `fileStates`；`checks` 保留每条请求的期望 tier、实际 tier 和原始 payload；`events` 保留 ready、model、request 和 settled 顺序。对应 `.ansi` 是原始终端流。`agent/`、`sessions/`、`workspace/` 是清理前的文件副本。

每个请求必须恰好一次且在 settled 后核对 `service_tier`。driver 读取真实 config/session 后才判定命令完成，不用 footer 推断字段。通过条件为所有断言通过、全部 Pi PID 消失、summary 清理为 removed。缺失 journey 时行为验收失败；wrapper 仍归档已知文件，并用 owners 与进程组核对完成清理。进程退出或归档无法核实时，保留 scratch 并标记 cleanup=unverified。

## Limits

此入口证明本地 CLI 动作、请求构造、SSE 错误处理和磁盘状态。它未连接真实 OpenAI/Codex，也不证明远端 billing、priority 采用情况、响应速度或服务质量。需要验收这些远程指标时，另取得允许使用的真实服务和计费证据，并单独记录。
