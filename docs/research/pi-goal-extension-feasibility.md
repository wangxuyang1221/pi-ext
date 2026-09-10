# Pi goal extension feasibility

## Scope and evidence

本轮属于 adventure [#2](https://github.com/wangxuyang1221/adventure/issues/2) 的规划证据，不是已批准 spec，也不是功能验收报告。

用户确认对齐 Codex CLI `0.153.4`，固定提交 `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`。C3 已确认首版只保证 OpenAI Codex，其他 provider 暂不保证兼容。C4 已确认首版仅支持交互 TUI，非交互入口不自动续跑 goal。C5 已确认用户界面使用英文，沿用 Codex 文案；命令、工具名和模型指令保留英文。详细上游行为见 [Codex audit](./codex-goal-0.153.4.md)。

C6 已确认错误分类适配：明确识别账户使用额度耗尽时记为 `usage_limited`；信息不足以区分额度耗尽与临时限流的终止错误记为 `blocked`，保留可用错误信息。沿用 Pi 原生重试，终止后停止 goal 自动续跑，允许用户手动恢复，不增加无限重试。goal 自身 token 预算仍独立使用 `budget_limited`。这可能使实际账户额度耗尽显示为 `blocked`，不影响停止续跑；没有证据说明该差异发生频率。确认依据为用户在澄清两类额度与状态差异后回复“接受你的方案”。

C7 已确认会话级目标：同一 Pi 会话共用一个 goal。`/tree` 切换历史分支不回退目标、状态或累计消耗，不复活已完成目标。确认依据为用户了解 `/tree` 后选择选项 `1`。此决定仅覆盖同一会话内的树导航，不自动决定 `/fork` 或 `/clone` 新会话的继承规则。

C8 已确认新会话显式继承：普通 `/fork`、`/clone` 不继承 goal；通过专门入口显式继承时复制目标、状态和累计消耗，并持久化初始自动续跑门禁。该门禁不等于强制把状态改为 `paused`。新会话不能仅因打开、reload 或查看 goal 自动开跑。确认依据为用户选择选项 `1`。入口和门禁解除的具体设计见候选方案，尚未实现。

C9 已确认 Pi 适配：Codex exec 对应 Pi 内置 bash，连续三轮实际执行失败且每轮没有成功工具时自动 blocked；拒绝、未执行及取消不计入。轮指完整 agent turn，不是单次工具调用。首版不自动对接第三方 plan-mode 的免计费行为，普通规划照常计入预算。使用 Pi TUI 与现有 codex-ui，不追求像素级复刻。确认依据为用户澄清轮次后回复“ok, 接受你的推荐适配方案”。

地图同步：C9 与十三项双版本实验已保存到 [最新证据评论](https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5598111320)，主地图与规划关正文均已回读核对。C4 至 C8 已写入 [主地图 #1](https://github.com/wangxuyang1221/adventure/issues/1) 与 [规划关 #2](https://github.com/wangxuyang1221/adventure/issues/2)，两处正文均已回读核对。[候选设计](./pi-goal-design-candidate.md) 全文另存于 [证据评论](https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5597947951)。三项适配已按 C9 确认。新增 [七项双版本存储实验](./pi-goal-storage-probe.md) 发现新会话首条 assistant 前的 custom entry 不会写盘，原唯一存储假设失效。C10 已确认：用户选择独立状态文件与恢复入口保留 goal-first，不限制到已落盘会话。正式 [spec #3](https://github.com/wangxuyang1221/adventure/issues/3) 与七片方案已获用户确认，实施 #4 至 #10 及原生依赖均已创建。用户要求保存后暂不实施；[完整存档](https://github.com/wangxuyang1221/adventure/issues/1#issuecomment-5598659084) 已保存并核对。下次用户明确继续时从 #4 开始，不再询问 C1 至 C10 或重复审核未修订的切片。规划为有条件通过，V1 至 V5 在对应切片验收前验证，功能尚未实现。

Pi 仓库开发依赖实测为 `0.84.3`，对应官方 tag 提交 `4e58f324fae8ebfa98a3d45181fb248072a2afac`。当前宿主为 `0.85.1`，对应提交 `d981de1229ef899957bbe968bc8dcda02a21f477`。本轮主要完整读取本地 `0.84.3` 包内 README、extensions、session-format、compaction、tui、keybindings 文档，并定点核验编译后的运行源码；后续在两个版本都执行了十三个真实 Pi runtime 的本地调度实验，见 [Runtime probe](./pi-goal-runtime-probe.md)，不宣称完整双版本功能验收。

Context7 定位请求返回 `TypeError: fetch failed`，因此采用版本匹配的官方包内文档和源码。以下链接固定到对应 Pi 提交，不将 main 文档作为旧版本依据。

## Available extension mechanisms

| 目标能力 | 已核验 Pi 能力 | 判断与限制 |
| --- | --- | --- |
| `/goal` 命令与三个 goal 工具 | `registerCommand`、`registerTool`、TypeBox schema | 可以在扩展内实现，不需修改宿主。业务约束仍需自行编码 |
| 目标状态与预算持久化 | `appendEntry` 写入非模型上下文的 custom entry；`getEntries` / `getBranch` 读取 | 可在会话内保存状态，但必须明确 goal 是会话级还是分支级，不能默认取任意分支最后一个 entry |
| 目标提醒与自动续跑 | `context`、`before_agent_start`、`sendMessage`、`sendUserMessage`、`agent_end`、`agent_settled` | 具备实现基础。事件与队列交错须验证，不能用无条件定时发送“继续”替代调度规则 |
| token 用量 | assistant `usage`、tool result 可选 `usage`、compaction 和 branch summary 可选 `usage` | 能统计已暴露的用量；不自动获得其他进程或未上报的嵌套调用用量，也不代表与 Codex 相同任务的数值相同 |
| 中断与恢复 | `ctx.abort()`、`ctx.signal`、assistant `stopReason`、session 生命周期、终端输入监听 | 可以实现状态转换；中断发生于模型、工具、重试、压缩或弹窗时需要分别处理 |
| 状态与菜单 | `setStatus`、`setWidget`、`ui.custom`、`ui.editor`、`ui.select` | TUI 有充分组件能力。精确布局不能直接照搬 Rust TUI，须适配 Pi 和现有 codex-ui |
| 会话切换、fork 与树导航 | `session_before_switch`、`session_shutdown`、`session_start`、`session_before_fork`、`session_tree` | 有生命周期入口。切换会重新实例化扩展，旧 ctx/pi 不可继续使用；fork 与树导航规则不同 |

来源：[extensions.md](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/extensions.md)、[session-format.md](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/session-format.md)、[tui.md](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/tui.md)。

## Scheduling constraints

`agent_end` 仅表示底层运行结束，Pi 之后仍可能重试、压缩或处理扩展刚加入的队列。`agent_settled` 在 `_runAgentPrompt` 的 finally 中发出，先将运行标志设为 idle，再调用扩展。不能将两个事件视作同一边界。

`sendCustomMessage` 在运行中排队，在 idle 且 `triggerTurn` 时直接启动 `_runAgentPrompt`；它不经 `prompt()` 的输入和 `before_agent_start` 链。若自动续跑依赖每轮 `before_agent_start` 注入，必须考虑这个差异。`sendUserMessage` 则调用 `prompt()`，但消息以用户角色进入上下文。选择哪条路径尚未批准。

`ctx.hasPendingMessages()` 通过 `pendingMessageCount` 读取用户 steering/follow-up 文本数组。`sendCustomMessage` 直接调用底层 agent 队列，不加入这两个数组。因此不能把此接口当成所有扩展消息队列的完整枚举或空队列证明。扩展 API 也未提供按 goal 标识撤回指定队列项的通用方法。应避免提前排入之后可能失效的 goal 续跑消息，或设计可验证的失效处理。

需要用实际 Pi runtime 核验的交错场景：

- 自动续跑与用户输入、其他扩展 follow-up 同时发生，不吞用户消息，不重复开跑。
- 暂停、清除、替换目标后，旧续跑不再执行。
- 重试及自动压缩结束前不重复启动 goal 回合。
- 扩展在 `agent_settled` 中启动后续运行时，print/JSON/RPC 与其他 settled 监听者是否仍符合预期。
- 切换、fork、reload 后旧闭包和定时器不得继续向旧会话发消息。

来源：[agent-session.ts](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/agent-session.ts)，已核验本地 `dist/core/agent-session.js` 的 `_emitAgentSettled`、`_runAgentPrompt`、`_handlePostAgentRun`、`sendCustomMessage`、`sendUserMessage`、`pendingMessageCount` 与扩展 context 绑定。

## Accounting and error boundaries

Pi 的 `Usage` 区分 `input`、`output`、`cacheRead`、`cacheWrite` 与 `totalTokens`。Codex 正常单调计数下按非缓存 input 加 output 计算 goal 消耗，并汇总子孙代理；预算到达后只抑制后续 goal 回合，当前回合收到收尾提示且仍可超额。预算映射不能直接拿 Pi footer 总数代替。已核验 Pi `openai-responses-shared` 会从 provider 的 input 中减去缓存读取和写入，将它们分别记录到 cacheRead/cacheWrite，因此映射非缓存输入不能再次减去 cacheRead，并须考虑缓存写入。`anthropic-messages` 也独立记录 input/cacheRead/cacheWrite。跨 provider 的统一口径尚待确认，未实测真实服务用量。压缩的 `tokensBefore` 是上下文长度而非压缩请求消耗。

Pi 支持工具主动上报嵌套 LLM 用量，但本仓库 subagent 工具当前未返回此类 `usage`，其状态管理也没有向 goal 提供子进程用量事件。若上游要求统计整个 agent 树，仅开发一个孤立 goal 扩展不能假定该信息已经存在。可能需要在本仓库 subagent 扩展增加协作接口；这不等于一定需要 fork Pi。

Pi assistant 的终止状态包括 `error`、`aborted`，并暴露 `errorMessage`。HTTP `after_provider_response` 只提供状态与 headers，且文档明确不同 provider/transport 的可见性不同。Codex provider 对某些 `429` / usage-limit 响应会转为易读文本；公开事件并不等价于 Codex 内部完整的结构化错误。

C3 收窄到 OpenAI Codex 后，此限制仍存在：Pi Codex provider 的 HTTP 错误处理可能把不同 code 或 `429` 变成同一条 ChatGPT usage-limit 文本，而公开 assistant message 没有保留完整结构化错误。SSE 的 `response.failed` 路径可把 code 放入 errorMessage，但不能推断所有传输都如此。首版也不能仅凭 `429` 声称精确区分账户额度耗尽、临时限流和服务故障。不识别的终止错误应停止 goal，而不是无限续跑；具体分类规则须在设计中确定并注明证据边界。

来源：[session-format.md](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/session-format.md)、[extensions.md](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/extensions.md)、[openai-codex-responses.ts](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/openai-codex-responses.ts)。用量拆分源码：[openai-responses-shared.ts](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/openai-responses-shared.ts)、[anthropic-messages.ts](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/anthropic-messages.ts)。本仓库依据：`extensions/subagent/src/index.ts`、`extensions/subagent/src/tools.ts`。

## Existing repository integration

`extensions/codex-ui/src/index.ts` 已替换主 editor 与 footer。`extensions/codex-ui/src/footer.ts` 的 renderer 仅选取 fast 和 permissions 状态，没有通用展示所有 extension statuses。goal 只调用 `setStatus` 不足以保证在当前 UI 显示。

可选实现包括独立 widget 或修改 codex-ui 使其显示 goal；尚未确定视觉方案。不要用 goal 的 `setFooter` 覆盖整个现有 footer，也不要直接接管 editor 导致其他扩展失效。

subagent 扩展在 `agent_settled` 更新任务完成游标，因此 goal 的续跑边界还影响外部观察者是否过早认为子代理完成。本轮只确认存在该监听关系，尚未运行验证。

来源：`extensions/codex-ui/src/index.ts`、`extensions/codex-ui/src/footer.ts`、`extensions/subagent/src/index.ts`，代码基准 `f4a7e44b43070748f082523b7377b165c9471e9e`。

## Current conclusion

C2：用户已选择标准 Pi + 扩展，不修改或 fork Pi 核心，允许联动本仓库其他插件。Pi 的公开扩展接口具备承载 goal 核心机制的基础；真实 runtime 实验也验证了有条件的自动续跑路径。现有证据不足以宣称完全等价，也未证明必须修改 Pi 核心。

应分别讨论用户可见行为对齐、Pi 调度与存储适配、Codex 专属服务和跨进程集成。界面、底层数据库格式、实际 token 数值和 Codex app-server 协议不能因名称相同就宣称兼容。

已运行独立的 [Runtime probe](./pi-goal-runtime-probe.md)，模型使用本地 faux 响应；没有实现正式 goal 原型或调用付费模型验证，未修改数据库、宿主或用户配置。正式实现仍须等待设计取舍与切片审核。
