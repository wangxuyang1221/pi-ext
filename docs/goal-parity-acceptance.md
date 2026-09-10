# Goal Parity Acceptance

## Scope

本轮实现研究建议排名 1–7、9，共八个 slice；不包含排名 8 的执行故障分类重做、排名 10 的任意后代计费协议。不修改上游 Pi，不创建真实 goal，不调用付费模型。本文记录 worker 的实现证据与主代理独立验收结果，主代理复核见 Main acceptance。

参考基线为 Codex `rust-v0.154.0`；新增暂停契约、模板和空回合规则固定到 [Codex main b348fc2](https://github.com/openai/codex/tree/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal)。三个模板及更新工具描述已与该 SHA 的原始文件逐字比较。完整差异和原始来源见仓库内 `docs/research/goal-codex-parity-review.md`；许可证与拷贝来源见 [UPSTREAM.md](../extensions/goal/UPSTREAM.md)。

本地核验环境：Node.js 22.22.2、pnpm 11.9.0、项目 Pi 0.84.3。Context7 文档仅作索引；steer、followUp、初始化和用量字段行为以已安装 0.84.3 源码核验。harness 使用的 0.85.1 不等于项目运行版本。

## Slice Evidence

| Slice / rank | 实现和证据 | 已观察的 Red → Green |
| --- | --- | --- |
| S1 / 1 | `storage.ts` 在共同控制入口保护 `budget_limited`；`controls.test.ts`、`commands.test.ts` 覆盖用户 pause、模型 paused/blocked、abort、同回合 crossing，并保留 complete/usage_limited 优先规则。通知返回实际保存状态。 | 原先预算目标被改为 paused；修复后保持 budget_limited。另一个 Red 发现通知仍称 paused，现与保存结果一致。 |
| S2 / 2 | `scheduler.ts` 用独立 edit ticket 通过 `steer` 发送编辑，不被旧 pending followUp 挡住；不逐次追加上下文。`scheduler.test.ts` 覆盖 idle、live edit、旧请求取消、已送达历史和 native checkpoint。 | 原先编辑不能越过 pending。验收追加完整 `message_end → context → aborted agent_end → settled` 链，原先只发送两次而停留 active；现发送新目标的第三次 continuation。 |
| S3 / 3 | `tools.ts`、`upstream.ts` 支持 `update_goal(paused)`，同步三个固定模板和工具契约；schema、handler 和预算优先级有测试。 | 原先 schema 拒绝 paused；现接受并通过控制入口保存实际状态。授权边界由明确用户请求的工具描述约束，不声称存在自然语言授权验证器。 |
| S4 / 4 | 自动 continuation 实际进入 context 后才计数，三个无活动空最终回复后 blocked，无第四次续跑。文本、thinking、流式活动、工具（含失败）、用户输入、外部 custom、编辑、resume、compaction、abort/error 重置独立计数。 | 原先第三次后仍 active；现 blocked。未送达队列、同请求重试不计数；待处理用户消息前不另排自动任务。保留原有重复调用和执行失败测试。 |
| S5 / 5 | 主/子用量均为 `input + cacheWrite + output`；`accounting.test.ts` 和 subagent `usage.test.ts` 用实际 reporter 对照主正规化函数，覆盖缺失、非法值、溢出、非零缓存和 receipt 去重。 | 缓存写入算例原先 60，现 90。cacheRead 和 reasoning 不重复相加。两个 extension 独立构建，保留两个实现，以交叉 fixture 锁定同一口径。 |
| S6 / 6 | `storage.ts`、`accounting.ts`、`children.ts` 和 `index.ts`：paused/blocked/usage_limited/complete 冻结统计；预算收尾仅在途期间继续计费。停止期 child 推进 baseline，resume 前 checkpoint；root activation fence 排除停前迟到响应。 | 原先停止后 child 继续收费、停前 response 在 resume 后串账；现分别只推进 baseline、记账为零。测试覆盖 reload、最终报告、预算收尾、已缓冲 root/child 用量及 checkpoint 失败。累计缺失标记在重新活跃计费时保守保留不完整性。 |
| S7 / 7 | 新 `capability.ts` 统一 persistent TUI + openai-codex + root 条件；工具启停不删除其他工具，create/update 执行时再次校验。只读 get 保留，本地 TUI inspect/pause/clear 仍可用；不支持时禁止新建、编辑、resume、root 用量及新 child 归属。 | 原先不支持环境仍暴露 mutable tools、可替换目标、计入 root 用量并分配 child source；各对应测试现通过。支持矩阵覆盖 provider、mode、持久性和 child。 |
| S8 / 9 | `session_start` 记录候选，在初始化后的 `resources_discover` 显示可取消恢复确认。只接受有剩余预算的 paused/blocked/usage_limited；跳过 reload/fork。接受后重验 session、identity、revision、status、budget、provider，共用显式 resume 路径。 | 原先没有提示、接受后仍 paused；现提示且接受后恢复。取消无写入无请求；shutdown、替换、revision/budget/provider 改变使旧确认失效。 |

## Review Regressions

主代理复现的 S2 两项缺陷均补入原有调度测试：

- `steers a live edit past an obsolete pending continuation`：新 steer 完成后，旧 pending 请求取消不能消耗新目标的下一次续跑；检查第三次发送和新 ticket 入场后没有第二次 abort。
- `does not cancel user input delivered beside an obsolete edit ticket`：用户消息和旧 ticket 同批送达时，不 abort 用户，也不删除已持久化的历史。ticket 失效只撤销调度权限；第一次和第二次相同 history 的 projection 均保留原位置。两次序列化输入一致，native checkpoint 均复用，remote compaction 调用数为零。

后一项最初尝试记忆被删除的 ticket，虽然修复第二次 projection，却仍使原始持久历史与 native checkpoint 前缀不匹配，回归实际触发 remote compaction。最终撤销历史删除，统一采用原有“已送达提醒属于历史”的规则；不添加替代尾部提示，也不更改 compact extension。

## Verification

所有行为按逐测试 Red → Green 推进；上表记录的是实际观察到的失败，不把缺模块或 fixture 配置错误算作行为证据。2026-09-10 SDK fixture 修复后再次完整运行 `pnpm run check`（16:24），退出码为 0：类型检查通过，81 个测试文件通过、2 个跳过；1012 个测试通过、2 个跳过；构建和发布包校验通过。`dist/` 仅由构建生成。跳过项为原有 subagent 集成测试，未为本轮扩大跳过范围。

测试在仓库内临时目录运行，root fixture 命令显式移除继承的 child 标志：

```sh
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH \
  TMPDIR="$PWD/.tmp/goal-parity-impl" pnpm run check
```

发布清单和 `scripts/check-package.mjs` 同步包含本文，避免 README/UPSTREAM 中的发布包链接失效。发布校验先观察到缺少本文条目的 Red，再补齐清单。

## SDK Lifecycle Follow-up

主代理退回验收后，实际运行了项目安装的 Pi 0.84.3 SDK 入口。原 `runtime.mjs` 和 `lifecycle-runtime.mjs` 的自定义 provider 被新 capability 拒绝，分别出现 record/source 为 undefined；现改用离线 `openai-codex` provider，测试适配层明确抑制 goal 自动发送，仅保留原存储/生命周期断言所需的显式请求，不修改生产门禁。`integration-runtime.mjs` 先断言不支持 provider 被拒绝，再切换支持 provider，并仅在 pre-reply recovery 阶段抑制自动请求；执行阶段恢复正常 SDK 发送。

| SDK entry | 0.84.3 实际结果 |
| --- | --- |
| `runtime.mjs` | 6 项通过；0 次模型请求，零网络尝试。 |
| `lifecycle-runtime.mjs` | 15 项通过；8 次显式 faux 请求，零网络尝试；保留两项故意注入的生命周期错误断言。 |
| `restore-runtime.mjs` | 新增真实 SDK create/bind/reload/dispose/reopen 测试；取消确认 1 次、请求 0 次且记录不变；接受确认 1 次、离线请求 1 次，以构造 quota error 收尾。两者 reload 均不增加确认或请求。 |
| `execution-runtime.mjs` | 15 个场景通过，涵盖重复调用、用户/foreign 队列、失败回合、原生 retry/compaction；零网络尝试。 |
| `budget-runtime.mjs` | 11 个场景通过，真实 Codex adapter 解析构造的 SSE；零网络尝试，无需调整冻结期望。 |
| `child-runtime.mjs` | budget、duplicate、late 三个独立进程场景均通过；每项 root 请求 4 次，所有 child 进程退出，零网络尝试。预算提醒断言改为唯一 scheduleId 和持久消息均为 1，避免把同一已送达历史在后续 context 重现误算为重复发送；late 为 0。child 继承仓库内 TMPDIR。 |
| `content-runtime.mjs` | Unicode 边界、长内容与工具契约通过；5 次 faux 请求，零网络尝试。 |
| `integration-runtime.mjs` | 从当前仓库发布入口原生加载所有 extension，长内容恢复、interrupt、fork、编辑和预算收尾通过；4 次离线 adapter 请求，不支持 provider 请求为 0，零网络尝试。 |

`restore-runtime.mjs` 没有手工 emit 生命周期事件。它注册一个位于 goal 之后、异步完成的 `session_start` handler，在 SDK 真正调用 `resources_discover` 时确认 UI；发送入口和 adapter 请求均断言所有 session_start 初始化已完成且用户已接受。观察到顺序为 `initializing → initialized → resources-discover → confirm → model-request`，取消分支无最后一步。UI 使用测试实现，不等同于 PTY 渲染测试。这是已有实现的 SDK 补充覆盖，不宣称新测例先经历过生产行为 Red。

可从仓库运行，先创建仓库内临时目录，并为每次进程移除继承的 child 标志：

```sh
mkdir -p .tmp/goal-parity-runtime
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH \
  TMPDIR="$PWD/.tmp/goal-parity-runtime" \
  node extensions/goal/__tests__/restore-runtime.mjs
```

其他入口使用同样环境：`runtime.mjs`、`lifecycle-runtime.mjs`、`execution-runtime.mjs` 无额外参数；budget/child 分别设置仓库内 `GOAL_BUDGET_EVIDENCE` / `GOAL_CHILD_EVIDENCE`，child 场景用 `GOAL_CHILD_SCENARIO=budget|duplicate|late`；content 设置 `GOAL_CONTENT_EVIDENCE` 并传 SDK 路径；integration 设置 `GOAL_INTEGRATION_EVIDENCE`，传 SDK 路径和分发目录 `.`。以上独立 `.mjs` 入口不计入 Vitest 的 1012 项统计。worker 本轮未跑 tmux 或额外 Pi 版本矩阵；主代理另测 0.85.1 的恢复和执行入口，范围见 Main acceptance，不外推至未运行的版本组合。

## Main acceptance

2026-09-10，主代理独立审查实现、测试、存储迁移兼容和发布文档，验收研究排名 1–7、9。主代理没有代写生产实现，以下退回问题由原 astra medium worker 修复：

1. 新目标编辑已生效后，取消旧 pending continuation 会使目标停留 active 却不再续跑。补完整事件链后恢复正确续跑。
2. 同批用户输入与过期提示的第一次、第二次 context projection 不一致。修复后保留已送达历史、撤销旧 ticket 权限，native checkpoint 不再因该差异失效。
3. 新 capability 使既有 SDK 存储/生命周期 fixture 无法建目标。调整离线测试 provider 和自动请求控制，保持生产门禁及原验收意图，另补真实 SDK 恢复确认测试。

独立复跑结果：

- `pnpm run check`：1012 passed、2 skipped，类型检查、构建、发布包检查通过。跳过仍为原有两项。
- Pi 0.84.3：`runtime.mjs`、`lifecycle-runtime.mjs`、`restore-runtime.mjs`、`execution-runtime.mjs`、`budget-runtime.mjs`、`content-runtime.mjs`、`integration-runtime.mjs` 全部通过；`child-runtime.mjs` 的 budget、duplicate、late 三场景均通过。
- 当前安装的 Pi 0.85.1：另行复跑 `restore-runtime.mjs` 和 `execution-runtime.mjs` 均通过。0.85.1 未跑完整其余矩阵。
- 真实 SDK 恢复确认取消为0请求、接受为1次离线构造请求，reload 不重复提示；初始化时序断言通过。
- fixture child 退出记录均为exitCode 0，主代理核验其PID已退出，无任务测试进程或监听端口遗留。临时日志和证据仅放在仓库内 `.tmp/goal-parity-main-review/`，验收收尾清理，不随包发布。

上述是离线行为和实际SDK验证，不是付费模型或PTY端到端效果保证。实现范围不含研究排名8、10，也未修改上游Pi或node_modules。

## Limits

- 本轮有离线事件链、存储、reporter、真实 SDK 生命周期、UI 测试实现和真实序列化/native checkpoint 协调器测试，没有真实 provider 网络请求或新增 PTY 端到端验收。非零 cacheWrite fixture 证明算式，不证明 Codex 端点实际出现频率。
- 自动续跑使用 extension ticket admission，不等同于 Codex host 原子 idle admission。Pi `ctx.abort()` 的队列副作用仍存在；同批已送达用户输入有保护，但不承诺保护尚未送达的全部队列项。
- 已送达的旧目标提示保留为历史，不承诺删除或改写模型已见内容。恢复确认不是自动执行，也不会在初始化中启动目标。
- 停止 goal 不自动 kill 子代理；预算只能在已有观察点收敛，不是跨进程硬实时上限。仅覆盖现有 managed child ownership，不扩展任意后代。
- elapsedSeconds 仍是本地 active 状态累计时间，不声称等于官方精确模型执行时间；原有命令失败保护仍不等同于 host execution unavailable 分类。
