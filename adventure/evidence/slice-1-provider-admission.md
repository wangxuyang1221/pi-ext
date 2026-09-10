# Provider admission and tool recovery

## Scope

本报告对应 [Implementation #17](https://github.com/wangxuyang1221/adventure/issues/17)，规格入口为 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12)。只交付 Slice 1，未实现 #18 的新 length/deferred/额度分类，也未接管 #19 的原生 adapter 完整计量、真实子代理进程链路和最终文档审计。

接手提交为 `5cfd59f081cdb710f5fbe0bbb6bb453b1a906adb`，产品起点为 `870cf4961436e8252a61c00d29a300a5a4b53760`。执行环境是 Node.js 22.22.2、pnpm 11.9.0。使用已安装的锁定依赖，没有安装新依赖，没有修改模型接入或鉴权配置。

## Implementation

- [`capability.ts`](../../extensions/goal/src/capability.ts) 不再检查 provider 名称，仅保留根会话、TUI、持久化会话和已选模型要求。根计量与受管直接子代理订阅复用此判断，未加入工具可见性条件。
- [`index.ts`](../../extensions/goal/src/index.ts) 只恢复自身因 capability 隐藏的工具，不再无条件加入 `create_goal`、`update_goal`。三个必要工具均按当前 active 集合检查，通知和状态栏列出实际缺失项。
- 权威 goal 快照新增可选布尔字段 `toolRecoveryRequired`。首次观察缺失时持久化它，不改 goal status、generation 或 activation。编辑、普通输入、重载及继承不会清除它。旧记录没有该字段时照常读取，非法字段拒绝加载。恢复工具后，只有显式 `/goal resume` 清除门控，保存目标恢复对话框不能替代该命令。
- [`scheduler.ts`](../../extensions/goal/src/scheduler.ts) 把新续跑的可执行判断与已绑定运行的归属判断分开。工具失效或恢复门控仍在时，不发新 goal continuation，不注入新的自动工作提示；排队的失效 ticket 在 context 边界拦截。已消费的历史提示不获得取消权，用户 steer/follow-up 和其他扩展消息保留。
- 根 usage、预算结算和在途软收尾仍使用既有归属路径。关闭工具不使最后响应变成无归属。旧目标响应不能写入替换目标。没有新增非空纯文本次数上限或 `supportsTools` 标志，没有修改 Pi 核心、HTTP 或鉴权。

## Reload finding

实际 SDK Red 发现，两版 Pi 的 `AgentSession.reload()` 使用 `includeAllExtensionTools: true` 重建工具集合。仅删除 goal 自己的无条件重加逻辑，仍无法保留重载前的禁用意图。

修复只在 extension 内进行。重载 shutdown 时写入 `pi-ext-goal-tools` 会话 custom entry，记录必要工具中由外部禁用的名称，排除插件自身隐藏项。新的 extension instance 在 reload startup 重新应用这些排除项。不修改其他扩展工具。该 entry 只用于重载工具选择，不是 goal 状态恢复来源；goal 恢复门控仍存储在权威 goal 文件中。

另一个 SDK Red 发现，创建目标时工具已经缺失，必须在保存目标后、首次调度前持久化恢复门控，否则用户先恢复工具再输入普通消息会绕过限制。已在命令和工具创建的保存后检查。

上述发现是局部实现缺口，没有推翻 Spec 或改变切片。[重载 Red 日志](./slice-1-sdk-red.log)、[创建 Red 日志](./slice-1-sdk-creation-red.log) 保留首次失败。

## TDD record

每轮先运行对应失败测试，再修改实现。后续扩大回归时，已经满足的行为直接记录为通过，没有为制造 Red 撤回已通过行为。

| Round | First result | Green change |
| --- | --- | --- |
| 任意 provider 准入 | capability 中 `tui/other` 期望 true、实际 false | 删除名称判断，保留未选模型反例 |
| 模型切换提示 | 非 Codex 切换仍出现 OpenAI Codex 警告 | 提示改为实际会话准入原因 |
| 外部禁用意图 | create/update 在 model_select 被重新启用，get 原已正确 | 只恢复插件自己隐藏过的工具 |
| 显式工具恢复 | 三个必要工具逐一关闭后仍发一次自动 continuation | 独立权威门控与调度 runnable 判断 |
| SDK reload | 实际重载后 update_goal 又出现在 active 集合 | 会话内保存并重用外部排除项 |
| SDK 创建时缺工具 | 命令已保存，但 toolRecoveryRequired 为 undefined | 保存后先观察门控，再调度 |
| reload 工具快照失败 | 写入异常中断 shutdown，writer 未释放 | 报告错误后继续资源清理，保留已落盘的恢复门控 |

单测定位命令使用 `env -u PI_SUBAGENT_PARENT pnpm exec vitest run extensions/goal/__tests__/capability.test.ts`，以及 `commands.test.ts` 的 `-t` 名称过滤。相关回归运行 `env -u PI_SUBAGENT_PARENT pnpm exec vitest run extensions/goal/__tests__ --reporter=dot`，最终 13 个文件、185 项通过。

补充回归覆盖了状态与归属不变、非法持久字段、旧记录兼容、继承与显式输入门控独立、耗尽预算不可恢复成 active、旧目标 gate 写入被拒绝。20 轮不变的 model_select/before_agent_start 观测没有重复 commit 或通知。没有新增定时轮询，工具扫描对象固定为三个必要名称。

首次批量单测继承了 worker 宿主的 `PI_SUBAGENT_PARENT`，出现 86 项环境性失败；移除此变量后，剩余 5 项是已取消的 provider 白名单断言，已按新规格改成非 Codex 正例或未选模型反例。这些环境和过时断言失败未计作 TDD 行为 Red。证据版本采集还曾因 pnpm 顶层没有 `pi-agent-core` 链接而失败，现先 realpath SDK 包目录再解析同版本依赖；遗留临时目录已删除。

## SDK method

新增正式夹具 [`provider-runtime.mjs`](../../extensions/goal/__tests__/provider-runtime.mjs)，分别实际加载 Pi 0.84.3 和 0.85.1 的 `createAgentSession`、`ModelRuntime`、`SessionManager`、扩展 runner 和 Agent loop。报告记录 SDK、pi-ai、pi-agent-core 的实际版本。

正常工具调用、模型切换、输入、队列、重载、message/agent 生命周期都由 SDK 产生，没有直接投递伪造 goal lifecycle 来代替验收。退出时显式发送 shutdown 仅用于释放测试资源，不据此证明运行时行为。TUI 准入由 SDK `bindExtensions({ mode: "tui" })` 提供，UI 回调捕获真实 extension 通知；本关不是 PTY 渲染验收，实际 TUI usage 提示的视觉验收仍归 #19。

模型样本分工如下：

| Sample | Loading and transport | Claims supported |
| --- | --- | --- |
| anthropic 内置风格 | 从 SDK catalogue 取得 claude-sonnet-4-5 元数据，以 extension `registerProvider` 注入离线 streamSimple | 非 Codex 名称、已选模型、普通工具与 SDK 流程，不证明 Anthropic HTTP adapter |
| models.json 私有模型 | Pi `ModelRuntime` 实际读取临时 models.json，使用原生 openai-completions adapter，fetch 返回离线 SSE | 私有配置加载、普通 function schema 序列化、结果与 usage 归一化后的 SDK 流程 |
| custom-goal | 另一个 extension 注册自定义 API 与 streamSimple | 合规自定义流的普通工具、消息与终止契约 |
| openai-codex | extension 注册 Codex 名称的离线 streamSimple | 原有名称下的 goal 正常行为回归，不证明真实 Codex 网络传输 |

私有模型 URL 为保留域名 `https://goal-private.invalid`，只有该 URL 的 fetch 会得到本地生成的 SSE。其他 fetch 一律拒绝，报告中意外网络请求数均为 0。只有无效占位 key，未读取或写入真实凭据。四类模型都经过 get-none → create → get-current → 非空文本 → 自动续跑 → complete → 最终回复。每个样本实际请求 6 次，目标创建后计 21 token，完成后的最终回复不转入目标统计。

## SDK results

两版各新增 22 个场景、60 个实际 SDK 模型请求，全部通过。

| Scenarios | Assertions |
| --- | --- |
| 四种正常模型入口 | 创建、查询、function tools、自动续跑、完成和普通根计量 |
| 创建前已经缺工具 | 请求为 0，恢复门控在首次请求前落盘，普通输入不解除 |
| 无目标时禁用工具并 reload | reload 仍保留禁用项 |
| 三个工具各自关闭与恢复 | 最后 7 token 仍计量，状态 active，resume 不启用缺失工具；reload、工具恢复、普通输入和 provider 切换不解锁；计量从 7 到 21 不重置，显式 resume 完成后为 28 |
| 工具关闭与预算 | 最后响应 110 命中 100 预算，已有运行只发一次软收尾，继续计 7，最终保留 117/100；恢复不新增预算或自动请求 |
| 排队失效的四种时序 | 无其他输入时只有原先 1 个请求；steer、follow-up 或其他扩展输入仍执行，合计 2 个请求，状态不被内部取消误改 paused |
| 替换发生在旧请求中 | 旧响应 110 不写入新目标；新目标只计 7 并完成，旧 agent_end 不驱动新状态 |
| 连续非空纯文本 | 5 次文本后仍可正常续跑完成，无新增次数限制 |
| 准入反例 | RPC、print、JSON、非持久、子会话、未选模型均 0 请求，mutating tools 不暴露，查询工具保留 |

机器证据：[0.84.3 JSON](./slice-1-sdk-0.84.3.json)、[0.85.1 JSON](./slice-1-sdk-0.85.1.json)。运行日志：[0.84.3](./slice-1-sdk-0.84.3.log)、[0.85.1](./slice-1-sdk-0.85.1.log)。JSON 包含每次请求的 provider/model/API/tool names、目标 token/status、工具调用结果、通知和生命周期顺序。

另外复跑既有 [`execution-runtime.mjs`](../../extensions/goal/__tests__/execution-runtime.mjs)。两版各 15 个场景、132 个请求通过，覆盖重复工具暂停、有效研究、队列保留、历史重放、工具创建、执行失败、原有重试与压缩恢复。[0.84.3 日志](./slice-1-existing-sdk-0.84.3.log)、[0.85.1 日志](./slice-1-existing-sdk-0.85.1.log)。这不代表 #18 新终态规则已经实现。

## Reproduction

```sh
env -u PI_SUBAGENT_PARENT pnpm run check

env -u PI_SUBAGENT_PARENT \
  GOAL_PROVIDER_EVIDENCE=adventure/evidence/slice-1-sdk-0.84.3.json \
  pnpm exec node extensions/goal/__tests__/provider-runtime.mjs

PI_0851=/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.85.1/4011d0a1b084fee9580232c1f0d858a8429fe70851ed74fe182409e63aa52ab9/node_modules/@earendil-works/pi-coding-agent
env -u PI_SUBAGENT_PARENT \
  GOAL_PROVIDER_EVIDENCE=adventure/evidence/slice-1-sdk-0.85.1.json \
  pnpm exec node extensions/goal/__tests__/provider-runtime.mjs "$PI_0851"

env -u PI_SUBAGENT_PARENT pnpm exec node extensions/goal/__tests__/execution-runtime.mjs
env -u PI_SUBAGENT_PARENT pnpm exec node extensions/goal/__tests__/execution-runtime.mjs "$PI_0851"
```

`PI_0851` 是本机已安装 SDK 路径，其他机器应指向实际 0.85.1 包目录。该变量仅存在于命令环境，不写用户配置。

## Final verification and limits

- `pnpm run check` 通过类型检查、81 个测试文件、1024 项测试、构建及发布包校验。默认跳过的 2 项 subagent 集成测试未运行，不能报为通过。[完整检查日志](./slice-1-check.log)。`dist/` 全部来自该构建，没有手工修改。
- 双版本新增 SDK 与既有 SDK 执行矩阵均通过，没有遗留已知失败断言。
- 保留 [provider feasibility](./provider-feasibility.md)、[exception policy](./exception-policy-review.md)、[budget policy](./budget-policy-review.md) 的既有资料。本轮没有改 `progress.md`，没有更新协调者 Acceptance 结论或关闭 Issue。
- 不保证无工具模型、不合规 adapter 或任意远端服务。工具检查发生在公开生命周期和命令检查点，没有私有工具开关 hook 或后台轮询；在两个检查点之间关闭又恢复、从未被公开事件观察到的瞬时变化不可追溯。
- 会话工具快照写入失败时会报告错误，仍释放 writer 并保留已落盘的 goal 恢复门控；不能承诺写入失败时禁用选择仍可跨 reload 保存。
- 没有真实 provider 端到端实测。本关不证明 Anthropic/Google/Responses 等完整原生 adapter 计量，也不证明所有 provider 的真实远端工具质量。#18/#19 继续承担其分配的验证。

## Cleanup

所有新增夹具目录位于 worktree 的 `.goal-provider-test-*`，已删除。现有 execution SDK 夹具和 check 子进程均已退出。没有启动独立后台服务；新增 SDK 夹具不开监听端口，既有测试的临时服务由其测试关闭。

检查 `find . -maxdepth 1 -name '.goal-*'` 无残留。`lsof -nP -a -d cwd "$PWD"` 只见调用检查命令和本轮宿主 Pi/MCP 进程，没有测试进程；这些宿主进程不是本任务启动的服务，未停止。对该进程集合核对 TCP LISTEN 无输出。没有待释放的本任务监听端口。

## API sources

Context7 选用 `/earendil-works/pi`，名称与官方仓库一致，覆盖扩展及 SDK 文档；未提供固定版本，查询仅用于定位，版本结论复用既有固定版本证据并核对本地安装包。

行动前完整阅读宿主 `extensions.md`、`sdk.md`、`custom-provider.md`、`models.md`、`session-format.md`、`tui.md`，并检查对应 0.84.3 文档差异、SDK 扩展示例和固定版本 `AgentSession.reload()` 实现。没有把 Context7 main 当作版本保证。

- [Pi 0.84.3 extensions](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/extensions.md)
- [Pi 0.84.3 SDK](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/sdk.md)
- [Pi 0.84.3 AgentSession](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/agent-session.ts)
- [Pi 0.85.1 AgentSession](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts)
- [Pi 0.85.1 models](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/models.md)
- [Pi 0.85.1 custom provider](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/custom-provider.md)
