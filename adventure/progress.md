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
- [Planning #7](https://github.com/wangxuyang1221/pi-ext/issues/7) 已通关，完整兼容方案已由用户确认并移交 Spec。
- 当前等待实施切片审核。尚未创建 Implementation Issue 或修改产品。

## Evolution

用户最初希望同时改善输入位置与发送后的折叠块。#3 按初始目标通关；调查缺少直接替换原生 user skill renderer 的公开入口后，用户选择只做输入。#4 通关，#6 按延期关闭，不是验收通过。旧 `handoff/handoff-20260920-152245.md` 只保留历史背景，不从其等待渲染路线的停点继续。

远端独立复核 `540ac13` 已合并。它补充普通 user 完整快照加显示转换等公开替代表示，纠正了最初候选不完整的问题。没有据此重新启动美化。

用户确认一条消息支持多个 skill 后，单次 `/skill:name` 转换不再足够。先验证了完整 user 加后置展示 entry，随后本轮发现并实测 `message_end` 可替换 user 最终内容。再结合 `message_start` 提前创建原生卡片，可在正常 live/restore 与多条队列消费中保留卡片在正文前，并让待发送队列仍是原始输入。该组合后来与公开 editor 适配一起由用户明确确认，现已移交 Spec Design；调查过程的候选标记保留为历史记录，不再作为当前待决事项。

用户选择终端中其他插件生成的普通 user 消息同样识别后，#5 输入规则已完成并移交 Spec。快照时序、历史编辑与压缩修复是新发现的独立兼容主题，已建立 #7 承接，并通过原生依赖关联 #5。#7 是 Map 子 Issue；没有重新开启美化。

## Agreed Decisions and Constraints

- 交付范围和工作约定见 [Spec](https://github.com/wangxuyang1221/pi-ext/issues/2)。不美化原生块、不 monkey patch、不改 Pi 上游或定制发行版，真正 `/skill:` 原入口保持原样。
- worktree `/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`，分支 `adventure/skill-mentions`，原始产品基准 `28656ed`。仅提交推送本任务资料和代码，不改 main，不创建 PR、不合并、不部署。
- 已移交 Spec 的输入规则包括：`$ad` 名称过滤；完整有效引用的手写、粘贴、菜单补全等价；同一消息多个 skill；仅空格、换行、Tab 或输入边界分隔；代码与转义不触发；未知名称和读取失败均静默按普通文本发送。
- 用户最新明确确认：重复引用只加载一次，不同 skill 按首次出现顺序组织；Tab/Enter 均选择候选且不发送；关闭菜单不删除引用；光标在名称中间不弹候选。不要重复提问这些行为。
- 最新来源决定已移交 Spec Scope：TUI 内其他插件生成的普通 user 消息也按相同规则识别；RPC/print、assistant/tool/custom 消息不纳入。
- 用户最新确认完整方案，#7 已关闭完成，要求已移交 Spec：消费时加载、普通 user 保存快照、提前原生展示、公开 editor 适配还原历史原文；不补回丢失卡片，不固定或重注入被压缩的全文。历史快照不等于模型始终可见的活动上下文。
- 产品实施前审核切片，然后遵循 adventure 的独立 worker 流程。当前仍只有证据与实验，没有产品改动。
- 文本写入遵循 `docs/agents/repository-language-policy.md`。若新增用户可见产品文案，仍须先确认语言；现已明确不写读取失败提示。

## Established Facts and Required Context

- Pi 0.86.0、Node.js 22.22.2、pnpm 11.9.0 已核验。Context7 只返回 main 文档，版本结论以锁定安装包和测试为准。
- CodexEditor 继承 CustomEditor，可叠加 `ctx.ui.addAutocompleteProvider`；不必替换编辑器。`pi.getCommands()` 提供 skill 与真实来源路径。
- [输入 API 审计](evidence/skill-input-api-audit.md) 提供锁定源码与最初单 skill 证明。[输入实验](experiments/skill-input-feasibility.test.ts) 现为 15 项，含 native/CodexEditor 的 Tab/Enter 不误提交探针。
- [独立复核](evidence/skill-feasibility-second-review.md) 是远端 540ac13 的报告。其 Node 24 结果为输入 5、渲染 8、消息表示 8 项。本机 Node 22 已重跑消息表示 8/8，旧日志不是本机重跑日志。
- [多 skill 组件实验](experiments/multi-skill-native-components.test.ts) 5/5。本轮补齐构造类型要求的 `userMessage`，未改产品。
- [前轮生命周期审计](evidence/multi-skill-lifecycle-audit.md) 与 [实验](experiments/multi-skill-lifecycle.test.ts)，前轮新增 18/18，后续该实验增至 23/23。实际 loader、extension runner、AgentSession、队列和官方离线 faux provider 均参与执行；terminal/editor 宿主是替代对象，不是完整 PTY。
- **接续必读**：[历史编辑与恢复审计](evidence/skill-history-recovery-audit.md)。公开 editor factory 适配可清理 setText/addToHistory 的完整封装，保留底层 CodexEditor；新增 [编辑器探针](experiments/skill-history-editor.test.ts) 4/4。消费时文件版本实验通过；compaction 裁掉卡片而保留 user 时，禁用补卡仍可向模型提供完整快照；user 也被摘要覆盖后不重新注入。两项追加探针覆盖用户最新决定。
- 最新 [组合实验日志](evidence/skill-compaction-policy-tests.log) 共 47/47，通过命令 `pnpm exec vitest run --config adventure/experiments/vitest.config.ts`。本轮涉及的生命周期与编辑器实验独立 tsc 检查通过。
- 本轮全仓 `pnpm run check` 仍为类型检查通过、1953 tests 通过、5 skip，一个 MCP suite 缺失基准 prototype 文件失败，见最新 [日志](evidence/skill-compaction-policy-check.log)。后续 build/package:check 未执行。前轮 build 通过，package:check 缺失 `docs/goal-descendant-acceptance.md`，未修无关基准缺口。
- 旧 [多 skill API 审计](evidence/multi-skill-api-audit.md) 的 input/context 路线不再穷尽候选。新证据说明后置展示会改变卡片位置和批次顺序；提前展示候选能避免正常场景下这两个问题。
- 真正 `navigateTree(userId)` 移到 user 的 parent，并把持久化 user 内容交回 editor，不等于 `SessionManager.branch(userId)`。原始回填拿到完整封装，本轮公开 editor 适配已验证可还原；真实 fork/resume 集成尚待验收。
- `message_start/end` 没有 input source 标记。提前展示探针以 `ctx.mode === "tui"` 限定终端，但会识别其他插件生成的普通 user 消息。用户已选择允许识别这些消息，来源边界不再阻碍该候选。
- 没有运行中的 subagent、服务或真实模型请求。新测试临时 skills 位于 worktree 内并已清理。凭证、models store 和 session 均使用内存。
- 冒险流程入口 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`，按阶段读取引用。

## Current Assumptions

方案本身无待确认事项。实施切片草案尚未获批，拟按以下可验收结果顺序交付：

1. 输入到模型的闭环：原生/CodexEditor 的完整美元补全与识别、idle 实际加载、同一 user 快照与原生展示、静默回退和 slash 隔离。
2. 排队与历史继续使用：消费时版本、JSONL 持久化、reload/resume/tree/fork、历史原文回填、正常压缩、editor 安装顺序和重复 reload。
3. 可安装交付：包入口与构建/清理/包检查、说明文档、真实 PTY 和仓库扩展组合，并负责完整 Spec 整体验收。

拟依赖 1 → 2 → 3，不并行修改共享扩展和包装入口。完整字段在本轮回复中提交用户审核；审核后按 adventure 创建 Implementation Issues 保存接受的切片。

已知全仓基准缺口不在本功能修复范围内，不绕过测试或捏造缺失文件。Slice 1 前核对，Slice 3 报告；若阻挡可安装产物验证则请求额外修复授权。新产品文案如有需要，写入前确认语言，优先复用 skill 自带名称/描述和原生组件。

## Continuation Point

#7 已关闭完成，Spec 已标记设计确定、实施切片待审核。当前停在三个切片的审核，不再询问完整方案是否确认。用户要求调整时按 slicing 修订完整列表再审核；不得把本轮对方案的 yep 当作接受尚未呈现的切片。

切片获批后创建 Map 子 Implementation Issues，设置原生依赖，将 Spec Deferred verification 的责任绑定具体 Issues，保存进度并派发首个独立 worker。skill 入口 `/Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md`；worker 需提供 adventure、develop-with-tdd 和 write-todo-list 的绝对路径并要求完整读取，不继承整段对话。

当前没有产品实现或运行中 worker。实施不满足公开 API 契约时重开 #7，不偷偷改范围或加入内部补丁。最后一个 Implementation worker 负责整体 Spec 验收与清理；用户确认交付前 Map 与 Spec 保持 open。
