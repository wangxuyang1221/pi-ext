# Handoff

> 继承下述工作状态，从 Continuation Point 继续。完整规格以 Spec Issue 正文为准，报告与实验只提供证据，不替代用户确认。

## Independent Review Update

2026-09-20：GPT6 Astra Pro 已完成独立可行性复核，结果见 [Skill Feasibility Second Review](evidence/skill-feasibility-second-review.md)。

- 确认 Pi 0.86.0 无公开原生 skill renderer 替换入口；前一轮候选不穷尽可行路线。
- 优先补入普通 user 完整 skill 快照 + Markdown 显示转换的公开 API 组合。它可继续使用原生 user 发送和队列链路，但改变封装文本、独立展开与部分编辑显示行为；尚待用户选择。
- 紧邻汉字的输入也存在公开 editor factory + SelectList 组合；并非只加 triggerCharacters 即可。新增 5 项输入、8 项渲染、8 项消息表示离线探针全部通过，完整插件/PTY/lifecycle 未验。
- [Planning #4](https://github.com/wangxuyang1221/pi-ext/issues/4) 继续 open；下一步由用户选择路线，再围绕新缺口补验。#5/#6 尚未通关，不进入产品实施。
- 本轮报告保留两份原审计，不覆盖纠正依据。以下是复核前的完整冒险存档；其中“等待复核”和原三项候选的当前性由本更新及新报告替代。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

在 Pi 中实现输入框任意位置的 `$` skill 选择与激活，并在 codex-ui 中定制发送后的 skill 声明展示。先查可行性，再确认交互规则与外观，审核实施切片后开发。

- [Map #1](https://github.com/wangxuyang1221/pi-ext/issues/1)
- [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)
- 当前关卡：[插件可行性 #4](https://github.com/wangxuyang1221/pi-ext/issues/4)

## Evolution

用户提供截图，关注发送后的 `[skill] adventure (ctrl+o to expand)` 折叠块，同时希望像 Codex 一样在输入框任意位置用 `$` 激活 skill。用户已批准独立冒险工作区与 GitHub 操作范围，并选择同时推进两个诉求。方向确认关 #3 已通关，后续拆为可行性 #4、输入规则 #5、展示设计 #6。#5 与 #6 通过 GitHub 原生依赖受 #4 阻塞。

## Agreed Decisions and Constraints

- 已确认的目标与工作约定见 [Spec](https://github.com/wangxuyang1221/pi-ext/issues/2#working-agreement)。本次同时覆盖输入与发送后展示，不只做美化。
- worktree：`/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`；分支：`adventure/skill-mentions`；基准：`28656ed`。
- 仅提交推送本任务的代码和资料，不改 `main`，不创建 PR、不合并、不部署。
- 不把插件可行性或候选方案当作已确认需求。需要用户取舍时一次问一个问题。
- 产品实施前须审核切片。实施遵循 adventure 的独立 worker 流程；当前仅做规划与验证。
- 所有文本写入前遵循 `docs/agents/repository-language-policy.md`。用户可见产品文案语言尚未确认。

## Established Facts and Required Context

- 项目在 `package.json` 锁定 Pi `0.86.0`。本机 Node.js `v22.22.2`，pnpm `11.9.0`。
- `extensions/codex-ui/src/components.ts` 中 `CodexEditor` 继承 `CustomEditor`；`src/index.ts` 通过 `ctx.ui.setEditorComponent` 安装它。Pi `ctx.ui.addAutocompleteProvider` 可以直接为它叠加 `$` 补全，不必再替换编辑器。
- 输入可通过公开 `input` transform 接入原生 skill 展开，单 skill 的最小链路已验证。上游 slash 展开只识别消息开头的一次调用，多 skill 需要后续设计。
- 前一轮审计未发现原生 `SkillInvocationMessageComponent` 的公开 renderer 替换入口。它不走 Markdown transformer，也不是 custom message。该结论限于直接替换原生块，用户要求再由 GPT6 Astra Pro 复核。保留原生消息格式完全不变不是用户明确提出的硬约束，还需检查公开 API 组合能否用不同的消息表示满足实际体验。
- [输入 API 报告](evidence/skill-input-api-audit.md) 和 [渲染 API 报告](evidence/skill-rendering-api-audit.md) 保存锁定版本源码、在线比对与边界。恢复 #4 必读。
- [输入实验](experiments/skill-input-feasibility.test.ts) 11 项通过，运行 `pnpm exec vitest run --config adventure/experiments/vitest.config.ts`。使用实际上游类和 CodexEditor，但不是完整 TUI/session 端到端验收。没有运行 prototype patch，也没有证明最终产品可发布。
- `pnpm run check` 的类型检查通过，1953 项测试通过、5 项跳过，但一个 MCP suite 因基准缺失 prototype 文件失败。单独 build 通过；package:check 因基准缺失 `docs/goal-descendant-acceptance.md` 失败。细节和日志见输入 API 报告，未修复这些无关基准缺口。
- 截图是发送后的 skill 折叠块，不是输入时的候选菜单。
- GitHub Map 已原生关联 Spec 与 Planning 子 Issues；#3 已关闭，#4、#5、#6 未通关。
- 当前未改产品代码，未启动测试服务或真实模型会话。
- Pi 官方文档入口为已安装 `@earendil-works/pi-coding-agent` 的 `docs/extensions.md`、`docs/tui.md`、`docs/skills.md`。前一轮已比对锁定版本源码；独立复核按证据缺口补验。
- 本场使用 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md` 的关卡、存档与交付流程。恢复时完整读取该 skill 及按阶段需要的引用。

## Current Assumptions

候选路线尚未获用户确认：推荐补上游正式 skill renderer 接口，再由 codex-ui 定制显示；代价是上游采纳前需要维护 Pi 补丁或定制版本。另一条路线是在插件内对导出组件的内部 prototype 做有版本检查和降级的补丁，但兼容性及完整生命周期尚未实验验证。较轻的选择是先只交付 `$` 激活，暂缓原生块美化，但这会缩小已确认的双目标范围，需要用户明确同意。

`请用 $adventure` 的现成补全链路已通过；`请用$adventure` 不会默认自动触发。紧邻文本、多个 skill、转义、手写引用是否等价于菜单选择等规则留给 #5。

## Continuation Point

用户要求手动保存并提供 handoff，由 GPT6 Astra Pro 先独立复核可行性，本轮到此停止。复核入口：[handoff-20260920-152245.md](../handoff/handoff-20260920-152245.md)，其类型为 branch，包含具体复核问题、源码入口和证据局限。

#4 保持 open，当前先等待独立复核，再请用户选择路线。复核重点是“缺少直接替换原生组件的 API”是否被过度推广成“公开 API 无法满足用户体验”。上游接口、内部补丁、缩小范围都尚未确认，也不应被当作穷尽选项。不要重复询问两项功能是否都想要，该目标已经确认。涉及修改另一仓库或 Pi 全局安装时，要另行确认位置与授权，当前授权仅覆盖本冒险 worktree 和指定 GitHub 仓库。

渲染调研 subagent 已完成并关闭。报告已由主代理核对并修正多 XML block 的解析描述。未启动服务器，子代理进程及其 tmux server 已停止，没有监听端口；实验临时夹具已删除。

用户选择路线后，对新增或受影响部分补验并完成 #4，再继续 #5 与 #6。形成 Spec 后按 slicing 审核实施切片。产品实施前还需确认用户可见文案语言。所有实施完成后运行完整检查及 Spec 整体验收，提交用户确认，用户确认前 Map 与 Spec 保持 open。
