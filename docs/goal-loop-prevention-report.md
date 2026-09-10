# Goal loop prevention report

## Changes

完整目标提醒在工作轮次开始时投递，不再由每次 `context` 删除后追加到工具结果或用户新指令后面。保留固定上游模板正文。新增 English 预警与暂停文案已获用户确认。

工具调用检测独立于已有失败轮次计数。连续重复成功调用可以在同一 agent run 内触发暂停，不必等模型产生最终回答。保存 `status: paused` 与 `pauseReason: repeated_tool_calls`，保留目标、token 和时间统计。`/goal` 显示原因，`/goal resume` 清除原因并重新开始检测。程序不会自动宣布完成，也不会将重复调用写成 `blocked`。

新暂停路径使用公开 `tool_call` 的 `block + terminate`，不调用 `ctx.abort()`。暂停失败时拦住后续同批工具，避免重复写盘；旧目标保存失败不会挂起替换后的目标。原有 C11/C12 行为未扩大。

实现位置为 `extensions/goal/src/scheduler.ts`、`loop.ts`、`storage.ts` 与 `index.ts`，对应测试在 `extensions/goal/__tests__/`。

## Delivery contract

| Event | Reminder behavior |
| --- | --- |
| 显式工作轮次 | `before_agent_start` 投递一次，持久化于原始位置 |
| 自动续跑 | 一个带目标身份票据的 follow-up，开始下一完整工作轮次 |
| 同轮工具调用、原生重试 | 保留原位置和内容，不追加新审计，不因计量增长重新渲染 |
| 用户 steer / follow-up | 不在最新指令后补旧审计；实际投递外部消息时重置循环检测，不在仅排队时重置 |
| 目标编辑 | 旧票据失效，一次 edited 提醒；下一自动工作轮次使用普通提醒 |
| 预算耗尽 | 一次 budget steer；重试仍保留同一消息，不重新创建 |
| 压缩丢失提醒、模型在同轮创建目标 | 恢复缓存的前置提醒，不在工具证据后追加；后续请求复用 |
| 手动操作、替换、reload、会话切换、fork | 沿用身份失效和恢复规则；运行内检测窗口不跨 scheduler 实例恢复 |

这里的“一次”指消息只投递一次，不是以后每个请求都删掉它。历史提醒会随上下文一起发送，如同普通历史消息。

## Detection contract

默认窗口 32，连续重复观察 4 次预警，8 次进入暂停候选。首次观察不是重复。因此完全相同的串行调用在第 5 次结果后预警，第 9 次结果后达到阈值，第 10 次模型请求中的重复工具被拦截。窗口内 A/B 交替或不规则短循环也会累计。

| Observation | Action |
| --- | --- |
| 工具名、规范化参数、完整结果与最近窗口中的一次观察相同 | 增加重复计数 |
| 新参数或新结果 | 清零连续重复计数；只表示当前没有重复证据，不声称任务取得语义进展 |
| 成功写文件或计量 revision 增长 | 不单独作为进展依据 |
| 失败结果、不可规范化或超限输出 | 清空本检测器；原有失败审计保留 |
| `subagent_wait` 返回匹配 agentId、timeout、running 的结构化回执 | 视为本仓库已确认活跃等待，清空重复计数 |
| 普通文本声称 running、错配 ID、任务终态回执 | 不享受等待豁免 |
| 预警尚未进入模型上下文 | 不让同批并行兄弟工具消耗预警后的观察机会 |
| 达到阈值后的已知重复调用 | 暂停并终止该工具批次；不会清空外部消息队列 |
| 达到阈值后的新动作或显式 complete 尝试 | 允许执行，获得新结果则解除重复候选 |
| 最终文字回答仍未解除重复候选 | 在完整轮次结束时暂停，不再自动续跑 |

同一重复阶段只预警一次。用户输入或新证据清除阶段后，新的重复阶段可以再次预警。并行批次包含 `update_goal(complete)` 时允许整个批次尝试完成，避免兄弟工具先暂停目标。终态、预算状态及已失效工具结果不被循环暂停覆盖。

检测器不解决所有空转。不断变化的时间戳、输出、超出窗口的循环、超限结果或反复失败的完成尝试可能绕过它。对其他任务系统的合法长轮询，目前没有自动豁免，应增加有明确回执契约的适配，而不是豁免所有 wait/poll 工具。它也可能暂停合理但无法验证必要性的重复读取，用户可显式恢复。

## Bounded cost

每次观察最多规范化 128 KiB、4096 节点、16 层深度，保存两组各 32 个 SHA-256 十六进制指纹，合计最多 4096 个指纹字符，不保留完整工具输出。预执行身份表最多 64 项；超量同批结果不进入检测。它不是工具总数上限，也不保证限制单次模型响应中已经发出的巨大并行批次。

不增加远程模型请求，不重读工作区，不扫描全会话。现有 `context` 过滤仍会处理历史消息，本改动没有将其变成常数成本。微基准只测检测器，不能替代整个 scheduler 性能对照。

Node 22.22.2 下，`loop-replay.mjs` 预热后重复三次所得范围如下。未设置缺少依据的硬性毫秒门槛。

| Input | Total ms | Per-observation p95 ms |
| --- | --- | --- |
| 原始循环 178 次 | 1.550 至 1.753 | 0.013 至 0.016 |
| 相同结果 178 次 | 0.632 至 1.432 | 0.004 至 0.007 |
| 不同研究结果 10000 次 | 39.529 至 42.928 | 0.004 至 0.005 |
| 每次 50 KiB 输出，共 178 次 | 19.196 至 21.959 | 0.114 至 0.131 |
| 超限 200 KiB 输出，共 178 次 | 1.216 至 2.221 | 0.007 至 0.014 |

所有测试窗口不超过 32。脚本同时输出禁用检测器的循环开销、均值与 heap delta。原始循环三次 heap delta 为约 -7.0 MB 至 +2.1 MB，受 GC、输入和测量数组影响，不能将其解释成保留内存或内存泄漏证明。有界保留量由结构与断言约束。

## Evidence

- TDD 覆盖提醒原位保留、稳定前置恢复、重复检测阈值、工具级暂停、暂停原因持久化，以及旧目标保存失败不影响替换目标。各行为先观察预期失败，再实现通过。预算重试断言改为“保留同一 scheduleId 的同一消息”，不再要求重试删除预算提醒。
- `pnpm run check` 通过，940 个测试通过，2 个既有集成测试跳过；类型检查、构建、发布包校验通过。
- Pi 0.84.3 与 0.85.1 的 `execution-runtime.mjs`、`runtime.mjs`、`lifecycle-runtime.mjs`、`budget-runtime.mjs` 全通过，网络请求为零。
- execution runtime 提供 178 个候选重复调用，10 次模型请求后暂停，恢复再用 2 次请求完成。A/B 交替在第 11 次请求暂停。40 次不同研究调用正常完成且无预警。两种用户排队方式与外部扩展消息在暂停后保留。
- 两个版本真实 InteractiveMode PTY 均通过 `loop-pause`、`c11`、`retry-c12`、`input-steer`、`input-followup`。循环暂停文案可见，恢复后目标 ID 与用量保留；C11/C12 原有断言通过。
- 七个扩展针对 Pi 0.85.1 声明重新编译，JavaScript 与发布构建逐字节一致。
- 原始 session 第 168 至 703 条记录中的 178 次工具结果回放，第 40 次预警、第 44 次达到暂停阈值。这是结果流回放，不等同于调度器真的在原会话执行了暂停。
- 同 session 第 55 至 166 条记录中的 23 次正常研究工具结果未触发。合成不同文件、新结果、结构化活跃等待和超限负例均未预警。

本机原始证据位于 `.scratch/goal-loop/`，不作为发布包内容。未复制或提交用户原始 session 正文。测试进程均已退出，本任务未启动监听服务。

## Reproduction

```bash
pnpm run check
pnpm exec node extensions/goal/__tests__/execution-runtime.mjs
pnpm exec node extensions/goal/__tests__/loop-replay.mjs

# Optional context capture, with fixture data only.
GOAL_EXECUTION_EVIDENCE=.scratch/goal-loop/execution-contexts.json \
  pnpm exec node extensions/goal/__tests__/execution-runtime.mjs

# Optional private transcript replay. Record bounds are inclusive and 1-indexed.
pnpm exec node extensions/goal/__tests__/loop-replay.mjs SESSION.jsonl 168 703

# Each PTY run requires a fresh output directory.
GOAL_TUI_SCENARIO=loop-pause conda run -n codex-py312 python \
  extensions/goal/__tests__/acceptance-tui-driver.py \
  .scratch/goal-loop/new-pty-run node_modules/@earendil-works/pi-coding-agent
```

SDK 脚本接受目标 Pi package 路径作为第一个参数；PTY 脚本第二个参数选择版本。上下文采集记录消息顺序、请求数、预警、目标状态和用量，便于后续对照。

## Remaining evidence gaps

未运行真实模型三组对照。旧投递、仅修时机、时机加保护的固定模型、样本、初始上下文和费用上限仍须确认；专用真实模型三组运行入口也未交付。离线回放和脚本模型不能证明时机是唯一诱因，不能证明真实任务误停率，也不能保证模型永不循环。

已交付检测器启用/禁用微基准和上下文采集入口，尚无相同环境下整个旧、新 scheduler 的耗时与内存对照。正常等待目前由单测与离线回放验证，没有真实后台任务的 PTY 等待验收。上述缺口保留在清单中，不把实现通过当成所有研究问题已解决。
