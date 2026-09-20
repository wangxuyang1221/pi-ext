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
- 三个实施切片已由用户审核通过：[输入闭环 #8](https://github.com/wangxuyang1221/pi-ext/issues/8)、[排队与历史 #9](https://github.com/wangxuyang1221/pi-ext/issues/9)、[可安装交付 #10](https://github.com/wangxuyang1221/pi-ext/issues/10)。均为 Map 子 Issue，依赖顺序为 #8 → #9 → #10；#8 的规划前置 #7 已关闭。
- 用户最新明确要求创建实施关卡、保存后暂停。当前已暂停，未派发 worker、未开始产品编码。

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
- 产品切片已获审核，但用户明确要求暂停。恢复前不得派发 worker 或开始实现；恢复后遵循 adventure 的独立 worker 流程。当前仍只有证据与实验，没有产品改动。
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

方案和切片均已确认，无待决设计提案。完整切片范围、验收、依赖和工作约束分别保存在 #8、#9、#10；Spec Deferred verification 已绑定相应责任，不在存档中维护第二份切片列表。

未验证的仍是产品实现与完整集成，不是用户意图。当前只有离线探针通过，不能据此关闭 Implementation。已知全仓基准缺口不在本功能修复范围内，#8 开始前核对，#10 负责报告；若阻挡安装产物验收则请求额外修复授权。新增产品文案仍须先确认语言。

## Continuation Point

已按用户要求手动保存并暂停。#8、#9、#10 均 open 且未开始，Execution 等待 worker；不把用户此前批准方案和切片理解为撤销暂停。等待用户明确恢复后再继续，不自动运行下一关。

恢复时先读 Map、Spec、本存档和 #8，核对本地/远端 HEAD 与未提交改动。首个可执行关卡为 #8，其规划前置 #7 已完成。建关基准为 `9633d68677647a60b98552ce5ad4bcb4c2fae96b`；后续保存只有资料变化，派发时用实际最新 HEAD 更新工作基准。无需重建 Issues 或重新审核同一套切片。

恢复后由主代理协调，派发独立 worker 执行 #8，不继承整段对话。向 worker 提供完整任务、Spec、Issue、工作区及以下 skill 绝对路径，并要求行动前完整读取 SKILL.md 与必要引用：

- `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md`

worker 在 Implementation 正文维护执行计划。主代理验收后按 #8 → #9 → #10 推进；若公开 API 不能满足契约则重开 #7，不偷偷改范围或加入内部补丁。#10 的 worker 负责完整 Spec 整体验收与清理，用户确认交付前 Map 与 Spec 保持 open。

当前没有运行中 worker、服务或本任务占用的监听端口。
