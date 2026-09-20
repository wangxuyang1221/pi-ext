# Handoff

> 继承下述工作状态，从 Continuation Point 继续。完整规格以 Spec Issue 正文为准，报告与实验只提供证据，不替代用户确认。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

本批只实现 Pi 输入框中的 `$` 行内 skill 选择与激活，采用公开扩展 API，保留发送后的原生 skill 展示。用户已选择方案 3，不再等待渲染路线决定。

- [Map #1](https://github.com/wangxuyang1221/pi-ext/issues/1)
- [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)
- 当前关卡：[输入规则 #5](https://github.com/wangxuyang1221/pi-ext/issues/5)

## Evolution

用户最初希望同时改进行内调用和发送后的 skill 折叠块，方向关 #3 按该目标通关。可行性调查发现输入侧有公开 API，原生块缺少直接替换入口。用户先要求另一个模型复核，随后明确选择方案 3，只做输入功能，暂缓美化。

该最新选择取代此前的双目标范围。#4 已通关，有效范围与路线移交 Spec；展示关 #6 按延期关闭，不是验收通过。旧独立复核 handoff 保留为历史快照，其等待路线决定的停点已失效。

本轮推送遇到远端新增提交 `540ac13`，读取后确认是 GPT6 Astra Pro 独立复核，已合并并保留其全部报告、实验与日志。复核确认缺少直接替换原生组件的 API，但发现普通 user 完整正文加 Markdown 显示转换等公开组合，因此纠正了原先候选不全面的问题。复核时的双目标前提和继续等待渲染路线已被用户最新的方案 3 覆盖，不自动扩大本批范围。

用户同时新增“如果 `$` 左右相邻有字则不显示 skill 候选”，随后明确选择 B：`$ad` 可以继续按名称筛选，相邻限制作用于引用片段与两侧正文。用户又选择 A，完整有效的手写、粘贴与菜单补全引用在提交时同样激活。当前进入每条消息允许的 skill 数量决定。

## Agreed Decisions and Constraints

- 已确认的范围与工作约定见 [Spec](https://github.com/wangxuyang1221/pi-ext/issues/2#scope)。本批不做原生块美化、内部 monkey patch、Pi 上游修改或定制版本。
- worktree：`/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`；分支：`adventure/skill-mentions`；原始产品代码基准：`28656ed`。
- 仅提交推送本任务的代码和资料，不改 `main`，不创建 PR、不合并、不部署。
- 相邻文字规则、允许 `$ad` 过滤，以及完整有效引用的手写/粘贴/菜单补全等价均已确认，完整规则仍在 #5 收敛。候选显示限制和提交激活语义分别判断，不依赖菜单选择状态。
- 产品实施前须审核切片。实施遵循 adventure 的独立 worker 流程；当前仅做规划与验证。
- 所有文本写入前遵循 `docs/agents/repository-language-policy.md`。用户可见产品文案语言尚未确认。

## Established Facts and Required Context

- 项目在 `package.json` 锁定 Pi `0.86.0`。本机已核验 Node.js `v22.22.2`，pnpm `11.9.0`。
- `CodexEditor` 继承 `CustomEditor`。Pi `ctx.ui.addAutocompleteProvider` 可为它叠加 `$` 补全，不必再替换编辑器。
- `pi.getCommands()` 可取得已发现的 skill。公开 `input` transform 在原生 skill 展开前执行，单 skill 最小链路已验证；多个 skill 不能简单串联 slash 调用。
- [输入 API 报告](evidence/skill-input-api-audit.md) 保存锁定版本源码、在线比对与边界，是 #5 的技术证据入口。
- [输入实验](experiments/skill-input-feasibility.test.ts) 本轮再次运行 11 项通过，命令为 `pnpm exec vitest run --config adventure/experiments/vitest.config.ts`。实际使用上游类与 CodexEditor，但 host、资源加载器和队列接收端是替代对象，不是完整 TUI/session 端到端验收。
- 现有实验支持句中及后续行的 `$`。独立复核指出原负向用例的 provider 同样要求空白，单看该用例不能隔离宿主限制；其放宽 provider 的新探针仍观测到宿主不自动触发，补足了证据。用户新增的完整双侧限制尚未验证，需在规则确定后补验。
- [独立复核报告](evidence/skill-feasibility-second-review.md) 和对应源码探针来自远端 `540ac13`。报告记载在 Node 24 隔离环境运行 5 项输入、8 项渲染、8 项消息表示探针通过，本机未重跑这些新增脚本。其 Input Boundary Review 与消息表示边界对 #5 有参考价值；公开展示方案留待未来恢复美化目标。完整插件/PTY/lifecycle 仍未验证。
- 前一轮全仓 `pnpm run check` 的类型检查通过，1953 项测试通过、5 项跳过，但一个 MCP suite 因基准缺失 prototype 文件失败。单独 build 通过；package:check 因基准缺失 `docs/goal-descendant-acceptance.md` 失败。详情和日志见输入报告，未修复这些无关缺口；本轮只有规划文档改动，没有声称问题已解决。
- [渲染 API 报告](evidence/skill-rendering-api-audit.md) 仅在未来恢复美化目标时读取。本批无需继续证明内部补丁或设计上游 renderer。
- 没有产品代码变更、运行中的 subagent 或服务。原调研进程已关闭，实验临时夹具已清理。
- 完整冒险流程为 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`，按阶段读取其引用。

## Current Assumptions

当前正在提问：每条消息最多一个不同 skill，还是支持多个？

- A：首版最多一个，复用原生单 skill 展开与展示。助手推荐，尚未确认。
- B：同一请求加载多个，需要确定内容表示、去重与原生显示兼容；不等于按顺序启动多轮执行。

其余规则仍未定，包括重复与超过限制的处理、标点与空白边界、光标在查询词中间、代码与转义、取消、错误处理及非 TUI 来源范围，按 #5 的决策依赖逐项确认。

## Continuation Point

#4 已通关，当前 #5 已确认 `$ad` 名称过滤和手写/粘贴完整有效引用的激活。等待用户确认每条消息的 skill 数量；不要重复询问已确认的过滤、激活或暂缓美化决定。最新决定已写入 #5，尚未形成可实施的完整输入规格。

用户回答后简短回显结果，核验新增边界能否用当前 API 实现，必要时补最小实验。保持每次一个问题，主要流程和异常收敛后更新 Spec，再按 slicing 形成切片供审核。未批准切片前不实施产品行为。

#5 后的正式交付仍需完整插件生命周期和 PTY 验证，并处理或明确全仓检查基准缺口的影响。所有实施通过后提交用户确认，确认前 Map 和 Spec 保持 open。
