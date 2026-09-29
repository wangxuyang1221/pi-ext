# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

将 `get_goal`、`create_goal`、`update_goal` 的对话展示与 codex-ui 中 Bash、Write、Edit 等工具统一。范围已确认；真实 Pi TUI 原型已制作并通过技术检查，当前等待用户体验并选择摘要密度。之后仍需确认展示规则，再进行正式实施与验收。

## Evolution

用户认为 Goal 工具功能工作良好，唯一问题是 UI 不一致。用户同意新建独立冒险、创建更新 Issues、提交推送本次代码和资料。随后明确选择只统一工具展示，不扩大到整个 Goal 界面。首关 #41 已通关。用户无法仅凭文字选择信息密度，于是明确同意在 #42 制作同屏比较两种密度的真实 TUI 原型，覆盖长目标、失败、窄屏与展开。已完成制作，尚未收到审阅决定。

## Agreed Decisions and Constraints

- 只覆盖三个工具的标题、状态、间距、结果摘要和详情展开。不修改 Goal 执行逻辑、模型接收的数据、footer 或 `/goal` 界面。
- 仓库：`wangxuyang1221/pi-ext`；分支：`adventure/goal-tool-ui`。
- worktree：`/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/goal-tool-ui`。
- 资料根目录：`adventure/39/`。Spec 仅在 Issue #40 正文维护。
- 只提交和推送本次代码与资料，不创建 PR、不合并、不部署。
- 原工作区存在已有文档删除；本 worktree 从已提交的 main `31f1ed84526cd9df5fc035e881245cbefb627e00` 建立，不纳入原工作区改动。
- 主代理负责 Planning；实施切片经用户审核后，按 adventure 派发独立 worker，一次推进一个实施关卡。
- 正式实施修改 src 与测试，不手动编辑 dist。原型全部位于 `adventure/39/prototypes/goal-tool-ui/`，不修改产品入口。
- 制作原型的批准不等于批准展示方案或实施切片。用户尚未授权跳过原型审阅。
- 交付前运行 `pnpm run check`。

## Established Facts and Required Context

- `extensions/goal/src/tools.ts` 注册三个 Goal 工具，尚无 `renderCall`、`renderResult`，返回 JSON 文本与结构化 details。这是源码事实，不是运行时视觉验证。
- `extensions/codex-ui/src/tools.ts` 为 Bash、Write、Edit 等工具定义专用渲染，使用 self shell、语义圆点和紧凑结果。
- 已制作原型，未修改产品源码、依赖或锁文件。原型启动时将现有源码转译至隔离目录，Goal 仅替换持久化访问边界，Bash/Write/Edit 真实执行固定临时操作。
- [原型 README](prototypes/goal-tool-ui/README.md) 提供启动方式、Landing Map、场景与限制。进入 worktree 后运行 `node adventure/39/prototypes/goal-tool-ui/demo.mjs`；`/variant summary` 和 `/variant minimal` 切换已有行，Ctrl+O 展开，`/quit` 退出。
- [原型验证](evidence/prototype-validation.md)：4 个组件测试、普通/全屏真实 PTY 检查通过。`pnpm run check` 通过，2599 个测试通过、13 个既有测试跳过。运行中退出和临时目录清理已验证，未留后台进程或监听端口。
- 切换密度曾暴露回调注册无限增长，已修复并加入每行只有一个 invalidator 的回归测试，真实 PTY 重跑通过。
- [渲染基线](evidence/rendering-baseline.md) 保存源码、API 依据和两个信息密度候选。codex-ui 使用 self shell、主题色圆点、缩进结果和已有展开操作；独立 extension 内附加 renderer 有 subagent 的实现先例。
- [Map #39](https://github.com/wangxuyang1221/pi-ext/issues/39)：查看进度与入口。
- [Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40)：读取已确认范围和操作约定。
- [已通关 Planning #41](https://github.com/wangxuyang1221/pi-ext/issues/41)：范围确认依据。
- [当前 Planning #42](https://github.com/wangxuyang1221/pi-ext/issues/42)：展示规则与集成方案，未通关，原型已交付，等待用户审阅。
- 使用 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md` 及对应 Issue 模板推进；写材料前读取 `docs/agents/repository-language-policy.md`。
- 项目依赖 Pi `0.87.0`；当前 harness 文档路径是 `0.87.1`。设计时核验目标版本文档或源码，不将两者混同。

## Current Assumptions

候选技术路线是在 Goal 内附加 renderer，保持独立构建，与 codex-ui 使用相同视觉约定，不改变 execute。原型已证明在真实宿主中可挂载与切换，但不证明正式 Goal 的所有集成路径。用户未确认默认摘要、展开字段和异常规则，不把技术通过当作产品决定。

summary 默认保留用量与耗时；minimal 隐藏统计行。两者保留调用操作、目标状态、目标预览，不完整 usage 警告均不隐藏。展开字段与状态颜色目前仅是原型候选。

## Continuation Point

当前停在 #42 的原型审阅，不继续正式实施。Map 和 Spec 均保持 open。

1. 向用户提供已就绪的原型入口，等待选择 summary/minimal 或提出修改，不再次询问是否制作原型。
2. 用户提出修改时调整原型，只补验受影响范围；确认体验结论后继续解决仍未确认的详情与异常规则。先读取 adventure 的 Prototyping 流程，不把原型代码直接当作生产交付。
3. 用户确认且必要技术证据足够后，关闭 #42，更新 Spec 并保存。
4. 使用 slicing 形成切片，用户审核后创建 Implementation 并派发 worker；不得把范围确认当作实现方案或切片确认。
5. 实施后核对证据，完成整体验收和资源清理，提交用户确认。Map 和 Spec 保持 open，直到用户确认交付。
