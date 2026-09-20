# Handoff

> 继承下述工作状态，从 Continuation Point 继续。完整规格以 Spec Issue 正文为准，当前关卡的已确认行为以其正文为准；报告与实验不替代用户确认。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

本批只实现 Pi 输入框中的 `$` 行内 skill 选择与激活，使用公开 API，保留原生 skill 外观。用户选择方案 3，发送后美化延期。

- [Map #1](https://github.com/wangxuyang1221/pi-ext/issues/1)
- [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)
- [Planning #5](https://github.com/wangxuyang1221/pi-ext/issues/5) 已通关，输入规则已移交 Spec。
- 当前 [Planning #7](https://github.com/wangxuyang1221/pi-ext/issues/7)，确定多 skill 快照与恢复兼容，尚未审核实施切片。

## Evolution

用户最初希望同时改善输入位置与发送后的折叠块。#3 按初始目标通关；调查缺少直接替换原生 user skill renderer 的公开入口后，用户选择只做输入。#4 通关，#6 按延期关闭，不是验收通过。旧 `handoff/handoff-20260920-152245.md` 只保留历史背景，不从其等待渲染路线的停点继续。

远端独立复核 `540ac13` 已合并。它补充普通 user 完整快照加显示转换等公开替代表示，纠正了最初候选不完整的问题。没有据此重新启动美化。

用户确认一条消息支持多个 skill 后，单次 `/skill:name` 转换不再足够。先验证了完整 user 加后置展示 entry，随后本轮发现并实测 `message_end` 可替换 user 最终内容。再结合 `message_start` 提前创建原生卡片，可在正常 live/restore 与多条队列消费中保留卡片在正文前，并让待发送队列仍是原始输入。此为新技术候选，未被当作已批准产品方案。

用户选择终端中其他插件生成的普通 user 消息同样识别后，#5 输入规则已完成并移交 Spec。快照时序、历史编辑与压缩修复是新发现的独立兼容主题，已建立 #7 承接，并通过原生依赖关联 #5。#7 是 Map 子 Issue；没有重新开启美化。

## Agreed Decisions and Constraints

- 交付范围和工作约定见 [Spec](https://github.com/wangxuyang1221/pi-ext/issues/2)。不美化原生块、不 monkey patch、不改 Pi 上游或定制发行版，真正 `/skill:` 原入口保持原样。
- worktree `/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`，分支 `adventure/skill-mentions`，原始产品基准 `28656ed`。仅提交推送本任务资料和代码，不改 main，不创建 PR、不合并、不部署。
- 已移交 Spec 的输入规则包括：`$ad` 名称过滤；完整有效引用的手写、粘贴、菜单补全等价；同一消息多个 skill；仅空格、换行、Tab 或输入边界分隔；代码与转义不触发；未知名称和读取失败均静默按普通文本发送。
- 用户最新明确确认：重复引用只加载一次，不同 skill 按首次出现顺序组织；Tab/Enter 均选择候选且不发送；关闭菜单不删除引用；光标在名称中间不弹候选。不要重复提问这些行为。
- 最新来源决定已移交 Spec Scope：TUI 内其他插件生成的普通 user 消息也按相同规则识别；RPC/print、assistant/tool/custom 消息不纳入。
- 产品实施前审核切片，然后遵循 adventure 的独立 worker 流程。当前仍只有证据与实验，没有产品改动。
- 文本写入遵循 `docs/agents/repository-language-policy.md`。若新增用户可见产品文案，仍须先确认语言；现已明确不写读取失败提示。

## Established Facts and Required Context

- Pi 0.86.0、Node.js 22.22.2、pnpm 11.9.0 已核验。Context7 只返回 main 文档，版本结论以锁定安装包和测试为准。
- CodexEditor 继承 CustomEditor，可叠加 `ctx.ui.addAutocompleteProvider`；不必替换编辑器。`pi.getCommands()` 提供 skill 与真实来源路径。
- [输入 API 审计](evidence/skill-input-api-audit.md) 提供锁定源码与最初单 skill 证明。[输入实验](experiments/skill-input-feasibility.test.ts) 现为 15 项，含 native/CodexEditor 的 Tab/Enter 不误提交探针。
- [独立复核](evidence/skill-feasibility-second-review.md) 是远端 540ac13 的报告。其 Node 24 结果为输入 5、渲染 8、消息表示 8 项。本机 Node 22 已重跑消息表示 8/8，旧日志不是本机重跑日志。
- [多 skill 组件实验](experiments/multi-skill-native-components.test.ts) 5/5。本轮补齐构造类型要求的 `userMessage`，未改产品。
- **接续必读**：[生命周期审计](evidence/multi-skill-lifecycle-audit.md) 与 [实验](experiments/multi-skill-lifecycle.test.ts)，新增 18/18。实际 loader、extension runner、AgentSession、队列和官方离线 faux provider 均参与执行；terminal/editor 宿主是替代对象，不是完整 PTY。
- [组合实验日志](evidence/multi-skill-lifecycle-tests.log) 共 38/38，通过命令 `pnpm exec vitest run --config adventure/experiments/vitest.config.ts`。新生命周期与组件实验额外独立 tsc 检查通过。
- 本轮全仓 `pnpm run check` 仍为类型检查通过、1953 tests 通过、5 skip，一个 MCP suite 缺失基准 prototype 文件失败，见 [日志](evidence/multi-skill-lifecycle-check.log)。后续 build/package:check 未执行。前轮 build 通过，package:check 缺失 `docs/goal-descendant-acceptance.md`，未修无关基准缺口。
- 旧 [多 skill API 审计](evidence/multi-skill-api-audit.md) 的 input/context 路线不再穷尽候选。新证据说明后置展示会改变卡片位置和批次顺序；提前展示候选能避免正常场景下这两个问题。
- 真正 `navigateTree(userId)` 移到 user 的 parent，并把持久化 user 内容交回 editor，不等于 `SessionManager.branch(userId)`。目前历史编辑拿到完整封装，需设计还原。
- `message_start/end` 没有 input source 标记。提前展示探针以 `ctx.mode === "tui"` 限定终端，但会识别其他插件生成的普通 user 消息。用户已选择允许识别这些消息，来源边界不再阻碍该候选。
- 没有运行中的 subagent、服务或真实模型请求。新测试临时 skills 位于 worktree 内并已清理。凭证、models store 和 session 均使用内存。
- 冒险流程入口 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`，按阶段读取引用。

## Current Assumptions

#7 当前询问快照时点：如果消息排队期间 skill 文件变化，使用哪个版本？

- A，推荐：实际轮到该消息、送给模型前读取当时版本，再保存本次快照。可使用等待期间的更新，队列保持原文。
- B：进入队列时锁定版本。后续文件变化不影响该条消息，但需额外处理快照关联、撤回和重提。

两项尚未选择。静默回退行为已确认，不因加载时点而重新讨论。

提前展示加最终 user 替换是技术候选，不是批准方案。它在队列消费时读取 skill，快照时点与 input 入队前加载不同。历史编辑原文还原、压缩移除卡片却保留 user 的反向边界、异常修复后的显示位置等仍需收敛。已验证的普通恢复和孤立卡片隐藏不能冒充全部恢复情况已通过。

## Continuation Point

#5 已关闭完成，输入行为已移交 Spec。当前 #7 等待快照时点选择；不要重复询问来源或其他已确认输入规则。

随后基于新证据收敛完整候选方案，明确原生 slash 隔离、历史编辑和压缩修复边界。必要时补最小验证，不重做已通过的基础 API 调查。出现可见行为或原约定变化时解释并取得确认。

#7 通过后移交 Spec。规格可实施时按 slicing 给出可验收切片供审核，未经审核不实施产品行为。完整插件加载、真实 PTY、发布包及全仓基准缺口的处理留给明确的实施/整体验收关卡。用户确认交付前 Map 与 Spec 保持 open。
