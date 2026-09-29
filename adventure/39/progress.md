# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

将 `get_goal`、`create_goal`、`update_goal` 的对话展示与 codex-ui 中 Bash、Write、Edit 等工具统一。当前只确定范围，仍需确认摘要、详情和状态展示，再设计、实施和验收。

## Evolution

用户认为 Goal 工具功能工作良好，唯一问题是 UI 不一致。用户同意新建独立冒险、创建更新 Issues、提交推送本次代码和资料。随后明确选择只统一工具展示，不扩大到整个 Goal 界面。首关 #41 已通关，展示设计关卡 #42 已建立。

## Agreed Decisions and Constraints

- 只覆盖三个工具的标题、状态、间距、结果摘要和详情展开。不修改 Goal 执行逻辑、模型接收的数据、footer 或 `/goal` 界面。
- 仓库：`wangxuyang1221/pi-ext`；分支：`adventure/goal-tool-ui`。
- worktree：`/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/goal-tool-ui`。
- 资料根目录：`adventure/39/`。Spec 仅在 Issue #40 正文维护。
- 只提交和推送本次代码与资料，不创建 PR、不合并、不部署。
- 原工作区存在已有文档删除；本 worktree 从已提交的 main `31f1ed84526cd9df5fc035e881245cbefb627e00` 建立，不纳入原工作区改动。
- 主代理负责 Planning；实施切片经用户审核后，按 adventure 派发独立 worker，一次推进一个实施关卡。
- 修改 src 与测试，不手动编辑 dist。实施交付前运行 `pnpm run check`。

## Established Facts and Required Context

- `extensions/goal/src/tools.ts` 注册三个 Goal 工具，尚无 `renderCall`、`renderResult`，返回 JSON 文本与结构化 details。这是源码事实，不是运行时视觉验证。
- `extensions/codex-ui/src/tools.ts` 为 Bash、Write、Edit 等工具定义专用渲染。具体规则尚待核对。
- 本轮只建立工作区与 Issues，未修改产品代码，未运行测试。
- [Map #39](https://github.com/wangxuyang1221/pi-ext/issues/39)：查看进度与入口。
- [Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40)：读取已确认范围和操作约定。
- [已通关 Planning #41](https://github.com/wangxuyang1221/pi-ext/issues/41)：范围确认依据。
- [当前 Planning #42](https://github.com/wangxuyang1221/pi-ext/issues/42)：展示规则与集成方案，未通关，尚未形成候选设计。
- 使用 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md` 及对应 Issue 模板推进；写材料前读取 `docs/agents/repository-language-policy.md`。
- 项目依赖 Pi `0.87.0`；当前 harness 文档路径是 `0.87.1`。设计时核验目标版本文档或源码，不将两者混同。

## Current Assumptions

沿用 codex-ui 现有渲染组件可能足以完成统一，但尚未核验跨扩展集成方式。默认摘要、展开字段、异常规则及是否制作原型均未获用户确认。

## Continuation Point

首关通关后的自动保存。保存后继续推进 #42，不等待用户再次发出开始指令。

1. 核对 codex-ui 的工具标题、状态、间距和折叠习惯，以及 Pi 对应版本的渲染 API 和跨扩展集成方式。
2. 根据现有代码与文档形成展示候选，每次只问一个产品决策。需要原型时先读取 adventure 的 Prototyping 流程，与用户商定范围。
3. 用户确认且必要技术证据足够后，关闭 #42，更新 Spec 并保存。
4. 使用 slicing 形成切片，用户审核后创建 Implementation 并派发 worker；不得把范围确认当作实现方案或切片确认。
5. 实施后核对证据，完成整体验收和资源清理，提交用户确认。Map 和 Spec 保持 open，直到用户确认交付。
