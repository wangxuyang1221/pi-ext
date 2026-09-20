# Handoff

> 继承下述工作状态，从 Continuation Point 继续。完整规格以 Spec Issue 正文为准，报告与实验只提供证据，不替代用户确认。

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
- `extensions/codex-ui/src/components.ts` 中 `CodexEditor` 继承 `CustomEditor`；`src/index.ts` 通过 `ctx.ui.setEditorComponent` 安装它。已有定制编辑器，不宜另一个插件无协调地替换。
- 截图是发送后的 skill 折叠块，不是输入时的候选菜单。
- GitHub Map 已原生关联 Spec 与 Planning 子 Issues；#3 已关闭，#4、#5、#6 未通关。
- 当前未改产品代码，未启动测试服务或真实模型会话。
- Pi 官方文档入口为已安装 `@earendil-works/pi-coding-agent` 的 `docs/extensions.md`、`docs/tui.md`、`docs/skills.md`，还需锁定版本源码和实验核验。
- 本场使用 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md` 的关卡、存档与交付流程。恢复时完整读取该 skill 及按阶段需要的引用。

## Current Assumptions

尚未确认仅用公开扩展 API 能同时完成两个目标。输入事件、编辑器替换、Markdown transformer 和自定义消息 renderer 都是候选接入点，但它们各自适用的消息类型与原生 skill 展示边界仍需查证。

## Continuation Point

方向关已通关并保存，现在继续 #4。核验 Pi 0.86.0 的 skill 枚举、autocomplete provider、输入转换、skill 内容展开、原生折叠块渲染及历史恢复。先读取后续形成的 `evidence/` 报告，避免重复查证。

本 session 已按 research skill 派发 `skill-rendering-audit` 调研原生 skill 渲染，输出目标为 `evidence/skill-rendering-api-audit.md`；主代理查编辑器与激活链路。跨 session 恢复时先检查文件与原代理是否仍运行，不重复施工。该后台任务不是 Implementation，不修改产品代码。

形成带证据的可行路线后，将维护成本或用户可见行为的必要取舍交给用户确认。然后继续 #5 与 #6，形成 Spec，按 slicing 审核实施切片。所有实施完成后运行项目完整检查及 Spec 整体验收，提交用户确认，用户确认前 Map 与 Spec 保持 open。
