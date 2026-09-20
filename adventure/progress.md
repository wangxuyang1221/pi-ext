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

用户同时新增“如果 `$` 左右相邻有字则不显示 skill 候选”，随后明确选择 B：`$ad` 可以继续按名称筛选，相邻限制作用于引用片段与两侧正文。用户又选择 A，完整有效的手写、粘贴与菜单补全引用在提交时同样激活。用户随后选择 B，同一条消息允许加载多个不同 skill，放入同一次请求，不自动拆成多轮执行。

## Agreed Decisions and Constraints

- 已确认的范围与工作约定见 [Spec](https://github.com/wangxuyang1221/pi-ext/issues/2#scope)。本批不做原生块美化、内部 monkey patch、Pi 上游修改或定制版本。
- worktree：`/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`；分支：`adventure/skill-mentions`；原始产品代码基准：`28656ed`。
- 仅提交推送本任务的代码和资料，不改 `main`，不创建 PR、不合并、不部署。
- 相邻文字规则、允许 `$ad` 过滤，以及完整有效引用的手写/粘贴/菜单补全等价均已确认，同一条消息支持多个不同 skill 也已确认，完整规则仍在 #5 收敛。候选显示限制和提交激活语义分别判断，不依赖菜单选择状态。
- 用户已选择 A：Markdown 行内代码、围栏代码块及 `\$skill` 不参与候选或激活，保留为原文。这里的“代码”指 Markdown 标记的代码文本，不是泛指编程话题。完整语法边界尚待方案验证。
- 产品实施前须审核切片。实施遵循 adventure 的独立 worker 流程；当前仅做规划与验证。
- 所有文本写入前遵循 `docs/agents/repository-language-policy.md`。用户可见产品文案语言尚未确认。

## Established Facts and Required Context

- 项目在 `package.json` 锁定 Pi `0.86.0`。本机已核验 Node.js `v22.22.2`，pnpm `11.9.0`。
- `CodexEditor` 继承 `CustomEditor`。Pi `ctx.ui.addAutocompleteProvider` 可为它叠加 `$` 补全，不必再替换编辑器。
- `pi.getCommands()` 可取得已发现的 skill。公开 `input` transform 在原生 skill 展开前执行，单 skill 最小链路已验证；多个 skill 不能简单串联 slash 调用。
- [输入 API 报告](evidence/skill-input-api-audit.md) 保存锁定版本源码、在线比对与边界，是 #5 的技术证据入口。
- 本轮 `pnpm exec vitest run --config adventure/experiments/vitest.config.ts` 共 16 项通过，包括既有 [输入实验](experiments/skill-input-feasibility.test.ts) 11 项和新增 [多 skill 原生组件实验](experiments/multi-skill-native-components.test.ts) 5 项。后者验证公开 entry renderer 可组合两张未修改的原生卡，转发展开状态，保持模型消息不重复，支持 JSON 恢复，并暴露 branch 回到 user 后派生 entry 消失。host 和消息输入是受控对象，不是完整 TUI/session 端到端验收。
- 现有实验支持句中及后续行的 `$`。独立复核指出原负向用例的 provider 同样要求空白，单看该用例不能隔离宿主限制；其放宽 provider 的新探针仍观测到宿主不自动触发，补足了证据。用户新增的完整双侧限制尚未验证，需在规则确定后补验。
- [独立复核报告](evidence/skill-feasibility-second-review.md) 和对应源码探针来自远端 `540ac13`。报告记载在 Node 24 隔离环境运行 5 项输入、8 项渲染、8 项消息表示探针通过，本轮在 Node 22 重跑消息表示脚本 8/8 通过，未重跑其余两个脚本，旧日志仍对应独立复核环境。其 Input Boundary Review 与消息表示边界对 #5 有参考价值；其中原生组件组合方案现作为多 skill 兼容候选调查，不代表重新启动美化。完整插件/PTY/lifecycle 仍未验证。
- 本轮重跑全仓 `pnpm run check`，类型检查通过，1953 项测试通过、5 项跳过，但同一个 MCP suite 仍因基准缺失 prototype 文件失败，后续 build/package:check 未执行。日志见 [multi-skill-check.log](evidence/multi-skill-check.log)。前轮单独 build 通过，package:check 因基准缺失 `docs/goal-descendant-acceptance.md` 失败。本轮只增加规划证据与实验，未修复这些无关缺口，没有声称全仓检查通过。
- [多 skill API 审计](evidence/multi-skill-api-audit.md) 给出新增兼容候选：普通 user 保留全部真实 skill 快照，Markdown transformer 仅精简显示，context 阶段按真实 user entry id 追加展示 entry，公开 renderer 组合原生 skill 组件。组件层已验证，排队、恢复缺口与布局尚未完整验证，不能宣称发送后显示完全不变。单纯串联 slash/XML 或只靠 before_agent_start 不能统一覆盖多 skill 与 busy queue。本批无需继续证明内部补丁或设计上游 renderer。
- 没有产品代码变更、运行中的 subagent 或服务。原调研进程已关闭，实验临时夹具已清理。
- 完整冒险流程为 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`，按阶段读取其引用。

## Current Assumptions

当前正在提问：输入形似完整引用但名称不在已发现 skill 清单中的 `$name`，提交时怎么办？

- A，推荐：按普通文本发送，不加载该名称；同一消息里其他有效 skill 照常加载，避免普通美元文本阻断发送。
- B：阻止整条消息发送，提示修改名称或转义后再提交，能发现拼写错误，但可能误拦普通文本。

此问题不涵盖“已发现 skill 的文件读取失败”，该异常另行确定，不能混同未知名称。

多 skill 已确认，但自包含 user 加派生原生卡只是技术候选。若真实生命周期探针显示可见布局、排队或恢复与原约定存在差异，必须向用户说明并确认，不能把保留同一组件 class 当作保留全部显示行为。

其余规则仍未定，包括重复/未知引用、标点与空白边界、光标在查询词中间、取消、错误处理及非 TUI 来源范围，按 #5 的决策依赖逐项确认。

## Continuation Point

#4 已通关，当前 #5 已确认 `$ad` 名称过滤、手写/粘贴完整有效引用的激活和同一消息多个 skill。代码与转义已确认按 A 排除。等待用户确认未知 skill 名称的处理；不要重复询问已确认的代码规则、数量、过滤、激活或暂缓美化决定。最新决定已写入 #5，尚未形成可实施的完整输入规格。

用户回答后简短回显结果，核验新增边界能否用当前 API 实现，必要时补最小实验。保持每次一个问题，主要流程和异常收敛后更新 Spec，再按 slicing 形成切片供审核。未批准切片前不实施产品行为。

#5 后的正式交付仍需完整插件生命周期和 PTY 验证，并处理或明确全仓检查基准缺口的影响。所有实施通过后提交用户确认，确认前 Map 和 Spec 保持 open。
