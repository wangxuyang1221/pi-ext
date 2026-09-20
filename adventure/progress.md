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
- #7 最新已确认 A：排队消息实际被消费、送给模型前读取 skill 文件，之后保存本次快照。排队期间修改会生效；不采用入队时固定版本。此项暂在 #7 维护，通关后移交 Spec。
- 产品实施前审核切片，然后遵循 adventure 的独立 worker 流程。当前仍只有证据与实验，没有产品改动。
- 文本写入遵循 `docs/agents/repository-language-policy.md`。若新增用户可见产品文案，仍须先确认语言；现已明确不写读取失败提示。

## Established Facts and Required Context

- Pi 0.86.0、Node.js 22.22.2、pnpm 11.9.0 已核验。Context7 只返回 main 文档，版本结论以锁定安装包和测试为准。
- CodexEditor 继承 CustomEditor，可叠加 `ctx.ui.addAutocompleteProvider`；不必替换编辑器。`pi.getCommands()` 提供 skill 与真实来源路径。
- [输入 API 审计](evidence/skill-input-api-audit.md) 提供锁定源码与最初单 skill 证明。[输入实验](experiments/skill-input-feasibility.test.ts) 现为 15 项，含 native/CodexEditor 的 Tab/Enter 不误提交探针。
- [独立复核](evidence/skill-feasibility-second-review.md) 是远端 540ac13 的报告。其 Node 24 结果为输入 5、渲染 8、消息表示 8 项。本机 Node 22 已重跑消息表示 8/8，旧日志不是本机重跑日志。
- [多 skill 组件实验](experiments/multi-skill-native-components.test.ts) 5/5。本轮补齐构造类型要求的 `userMessage`，未改产品。
- [前轮生命周期审计](evidence/multi-skill-lifecycle-audit.md) 与 [实验](experiments/multi-skill-lifecycle.test.ts)，前轮新增 18/18，本轮该实验增至 21/21。实际 loader、extension runner、AgentSession、队列和官方离线 faux provider 均参与执行；terminal/editor 宿主是替代对象，不是完整 PTY。
- **接续必读**：[历史编辑与恢复审计](evidence/skill-history-recovery-audit.md)。公开 editor factory 适配可清理 setText/addToHistory 的完整封装，保留底层 CodexEditor；新增 [编辑器探针](experiments/skill-history-editor.test.ts) 4/4。消费时文件版本实验通过；compaction 保留 user 却裁掉前置卡片的场景已复现，补写卡片会移到当前 leaf，不能当作无可见差异。
- 最新 [组合实验日志](evidence/skill-history-recovery-tests.log) 共 45/45，通过命令 `pnpm exec vitest run --config adventure/experiments/vitest.config.ts`。本轮涉及的生命周期与编辑器实验独立 tsc 检查通过。
- 本轮全仓 `pnpm run check` 仍为类型检查通过、1953 tests 通过、5 skip，一个 MCP suite 缺失基准 prototype 文件失败，见最新 [日志](evidence/skill-history-recovery-check.log)。后续 build/package:check 未执行。前轮 build 通过，package:check 缺失 `docs/goal-descendant-acceptance.md`，未修无关基准缺口。
- 旧 [多 skill API 审计](evidence/multi-skill-api-audit.md) 的 input/context 路线不再穷尽候选。新证据说明后置展示会改变卡片位置和批次顺序；提前展示候选能避免正常场景下这两个问题。
- 真正 `navigateTree(userId)` 移到 user 的 parent，并把持久化 user 内容交回 editor，不等于 `SessionManager.branch(userId)`。原始回填拿到完整封装，本轮公开 editor 适配已验证可还原；真实 fork/resume 集成尚待验收。
- `message_start/end` 没有 input source 标记。提前展示探针以 `ctx.mode === "tui"` 限定终端，但会识别其他插件生成的普通 user 消息。用户已选择允许识别这些消息，来源边界不再阻碍该候选。
- 没有运行中的 subagent、服务或真实模型请求。新测试临时 skills 位于 worktree 内并已清理。凭证、models store 和 session 均使用内存。
- 冒险流程入口 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`，按阶段读取引用。

## Current Assumptions

#7 当前询问压缩或异常修复后的卡片位置：

- A，推荐：允许缺失的历史 skill 卡片补在当前历史末尾。正常发送仍维持卡片在正文前，加载的快照不变，详情保持可访问。
- B：历史卡片也必须保持原位。当前候选不能直接定案，继续核验其他公开方案，不自动允许内部补丁或上游修改。

用户尚未选择。测试已证实本候选在 compaction 裁掉 Display、保留 User 时只能 append 到当前 leaf；不声称其他所有公开路径都做不到。

提前展示加最终 user 替换、公开 editor factory 适配仍是技术候选，不是已批准整套方案。安装顺序、reload 避免重复包裹、fork/runtime 实际回填以及具体协议需在最终方案和实施验收中明确。补全本身只需 provider；干净历史编辑需要额外 editor 适配，这不等于修改原生组件原型。

## Continuation Point

#5 已关闭完成，输入行为已移交 Spec。#7 的快照时点已按 A 确认并通过实验，当前等待压缩/修复后卡片是否允许移位的选择；不要重复询问加载时点、来源或其他已确认输入规则。

随后基于新证据收敛完整候选方案，明确原生 slash 隔离、历史编辑和压缩修复边界。必要时补最小验证，不重做已通过的基础 API 调查。出现可见行为或原约定变化时解释并取得确认。

#7 通过后移交 Spec。规格可实施时按 slicing 给出可验收切片供审核，未经审核不实施产品行为。完整插件加载、真实 PTY、发布包及全仓基准缺口的处理留给明确的实施/整体验收关卡。用户确认交付前 Map 与 Spec 保持 open。
