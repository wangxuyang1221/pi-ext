# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

将 `get_goal`、`create_goal`、`update_goal` 的对话展示与 codex-ui 中 Bash、Write、Edit 等工具统一。用户已审阅真实原型并选择 summary，规划已收敛，Spec 已确定可用于实施。用户已审核唯一实施切片，并指定 `agent_type: expert`。已创建 Implementation #43，准备派发执行；主代理转为协调者。

## Evolution

用户认为 Goal 功能工作良好，问题仅在 UI。不扩大到 footer 和 `/goal`。用户先同意创建独立冒险及提交推送，再确认只改三个工具。无法凭文字选密度后，同意在 #42 制作 summary/minimal 对照原型。

原型完成后，用户明确认可 summary 并要求收敛。已关闭 Planning #42，并把有效要求移交 Spec #40。不再反复询问是否制作原型或选择哪种密度，正式产品不增加变体切换。原型制作批准、原型选择、实施切片审核是不同决定；最后一项也已获用户确认，执行者类型明确指定为 expert。

## Agreed Decisions and Constraints

- 完整展示规则、边界与验收只维护在 [Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40)，当前状态为已确定，可用于实施。
- 采用 summary，默认显示操作与目标状态、目标预览、tokens/可选预算及耗时；展开查看完整目标和详细字段。异常与状态呈现沿用已审阅原型基线，正式安全回退按 Spec 落实。
- 不修改 Goal 执行、schema、description、content/details、存储、调度、预算或计量；不改 footer、`/goal` 和其他工具展示。
- 仓库 `wangxuyang1221/pi-ext`，分支 `adventure/goal-tool-ui`。
- worktree `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/goal-tool-ui`，资料目录 `adventure/39/`。
- 只提交和推送本场代码与资料，不创建 PR、不合并、不部署。原工作区已有文档删除，不能纳入本场。
- 产品基准为 main 的 `31f1ed84526cd9df5fc035e881245cbefb627e00`。当前分支增加的是本场资料和原型，未修改产品源码。
- 实施切片已获用户审核。主代理担任协调者，使用 `agent_type: expert` 派发独立执行者，承担 worker 职责。执行者不再委派，主代理不代替其编码。
- 正式实现修改 src 与对应测试，不手动编辑 dist；完成前运行 `pnpm run check`。

## Established Facts and Required Context

- 原 Goal tools 返回 JSON 文本与结构化 details，尚无自定义 renderer；codex-ui 工具使用 self shell、主题色圆点、紧凑标题和缩进结果。
- Pi 0.87.0 的工具注册支持附加 renderCall/renderResult。可在 Goal 自身实现，保持独立构建，不跨 rootDir 导入 codex-ui 源码，不修改 execute。具体证据见 [渲染基线](evidence/rendering-baseline.md)，其中候选状态反映早期调查时间，以现 Spec 为准。
- [原型 README](prototypes/goal-tool-ui/README.md)：Landing Map、运行命令、替换范围和限制。Goal 只替换了持久化访问边界，Bash/Write/Edit 为真实固定临时操作。
- [原型验证](evidence/prototype-validation.md)：4 个真实 ToolExecutionComponent 测试与普通/全屏 PTY 检查通过；制作时 `pnpm run check` 通过，2599 tests passed、13 既有 tests skipped。未留后台进程或监听端口。
- 原型切换密度曾因重绘回调重复注册无限增长导致内存耗尽，已修复并增加每行一个 invalidator 的回归测试。正式实现不需要全局密度切换注册机制。
- 原型证明布局与真实宿主挂载，不证明正式 Goal 组合、历史恢复、非 TUI、所有异常数据与性能。这些已分配给唯一实施切片的整体验收。
- [Map #39](https://github.com/wangxuyang1221/pi-ext/issues/39)：当前阶段和入口；[Planning #41](https://github.com/wangxuyang1221/pi-ext/issues/41) 与 [Planning #42](https://github.com/wangxuyang1221/pi-ext/issues/42) 均已通关。
- [slices.md](slices.md)：已审核的唯一切片。完整内容已写入 [Implementation #43](https://github.com/wangxuyang1221/pi-ext/issues/43)，该 Issue 的 Execution 是唯一执行计划入口。
- 使用 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md` 和其 Issue 模板推进；写材料前读取 `docs/agents/repository-language-policy.md`。
- 项目和已验证原型的 Pi 版本为 0.87.0，当前 harness 文档是 0.87.1，接口行为须核对目标版本。Node v22.22.2、pnpm 11.9.0，worktree 已完成 frozen-lockfile 安装。

## Current Assumptions

无阻碍切片的未决方案。一个切片足以同时交付三个工具的共同展示规则、接入和整体验收，避免按工具或测试工序人为拆关。该粒度已获用户确认。

## Continuation Point

进入 [Implementation #43](https://github.com/wangxuyang1221/pi-ext/issues/43)。Map 和 Spec 保持 open。#43 已关联 Map 和已通关 Planning 的原生依赖。

1. 本次保存后立即使用 `agent_type: expert` 派发执行者，提供 Spec、#43、原型与证据入口、worktree 和操作限制。行动前完整读取 `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md` 与 `/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md`；执行计划只维护在 #43 正文。
2. 跨 session 接手先检查 subagent runtime 与工作区，勿重复派发。执行者活跃时协调者不改产品代码；需要结果时等待。
3. 完成后协调者核对正式代码证据，特别是 Spec Deferred verification。原型结果不能代替正式 Goal + codex-ui 组合验收；不足则更新 Acceptance 并交回原执行者。
4. 唯一切片包含整体验收和资源清理。通过后关闭 #43、保存进度，提交用户确认交付；得到最终确认才关闭 Map/Spec。远端分支清理由用户决定。
