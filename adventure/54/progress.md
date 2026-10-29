# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为仓库内 Pi 提供可复用的 TUI 局部刷新机制，降低动画与 footer 更新额外引起的 CPU 渲染开销。用户已确认本次不优化正文持续输出本身。可行性规划已形成结论，当前提交两关实施切片供用户审核，尚未派发 worker。

## Evolution

用户最初希望给 Pi 打仓库内补丁，并保证全局命令和升级不受影响。源码检查发现宿主已有终端差异输出，但 Loader 每 80ms 请求全局组件刷新。用户随后明确，需要的是供自定义动态内容使用的机制，不只是修改原生 Working。

用户补充图示动画行及 footer `102 t/s`，并明确最终目的是降 CPU。新增基准发现通用组件缓存会增加正常流式帧成本，因此转向显式预留区域、复用其余画面的方向。用户在范围选择中确认只消除动画与 footer 引起的额外开销，不扩展为正文渲染优化。

## Agreed Decisions and Constraints

- [Map #54](https://github.com/wangxuyang1221/pi-ext/issues/54)、[Spec #55](https://github.com/wangxuyang1221/pi-ext/issues/55)；完整规格只维护在 Spec 正文。
- [方向 Planning #56](https://github.com/wangxuyang1221/pi-ext/issues/56) 已通关。token 速率和 Working 是用途示例，不代表已要求实现 token 采集、具体样式或默认 UI 改动。
- [可行性 Planning #57](https://github.com/wangxuyang1221/pi-ext/issues/57) 的有效规则已移交 Spec。采用显式文本区域与保留帧方向；无效几何、正常更新或其他复杂情况允许正确回退，不用全树通用缓存作为生产路线。CPU 预算和完整边界以 Spec 为准。
- 独立分支为 `adventure/pi-animation`，worktree 为 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation`；资料位于本目录。
- 沿用 adventure 流程，规划取舍和实施切片均需用户确认，之后由主代理协调 worker 逐关实施。当前没有 worker，没有产品代码修改。
- 提交推送仅包含本场工作；不创建 PR、不合并、不部署，不修改全局 Pi。工作目录外未授权写入需先征得同意。

## Established Facts and Required Context

- 基线为 `31a7061ce853233bdeb8686487a35d03fb4c1e5a`，Node v22.22.2，pnpm 11.9.0；宿主依赖固定为 Pi 1.4.0。
- 仓库已有 `pnpm-workspace.yaml` 登记的 coding-agent 会话摘要补丁，仓库 `pnpm exec pi` 与全局命令分离。见 [已有说明](../../docs/pi-session-summary-patch.md)。新增 pi-tui 补丁仍需验证实际加载路径。
- 实际安装包 `pi-tui/dist/components/loader.js` 每 80ms 调用 requestRender；`tui.js` 的 Container.render 遍历子组件；`tui-main-screen.js` 先组装所有行再做差异输出；`tui-alt-screen.js` 调用 renderLayoutFrame 后比较屏幕行。全局组件计算不等于每帧整屏终端输出。
- 全屏 `layout.js` 的 renderCache 仅在单帧内复用，下一帧重新创建；组件和布局存在明确接入点。
- 自定义 widget 和 footer factory 收到 TUI 实例；widget 直接挂入原生 Container。codex-ui 当前隐藏原生 Working 行。
- 创建/更新 Issue 使用 GitHub connector；原生父子关系 connector 未提供，使用 gh api。#55、#56、#57 均为 Map 的原生子 Issue。
- 首次自动保存提交为 `c35d3c6aa156fc85824a13c07e97974c649d6cb8`，已推送。随后独立完成 [技术实验](experiments/scoped-refresh.mjs)，结论与边界见 [实验报告](evidence/scoped-refresh.md) 和 [原始结果](evidence/scoped-refresh.json)。没有修改产品源码或安装包。
- 实验在真实普通和全屏渲染器上通过。60 帧中，无关历史组件 render 从普通 12000 次、全屏 24000 次降为 0；画面和终端字节与基线一致。正常更新、尺寸变化、多个局部目标、真实调度请求合并及普通请求优先均有证据。当前是内存终端和已知夹具组件，未覆盖真实 PTY、任意容器或正式扩展接入。
- pnpm 安装会自动写入未批准构建脚本的占位配置，该改动已移除。本次使用 `--frozen-lockfile --ignore-scripts --config.strict-dep-builds=false` 安装，仍未执行依赖构建脚本，配置和锁文件保持原样。
- 移除占位项后，pnpm 11 的脚本前自动安装检查会再次触发安装并写回占位项。后续运行或提交时使用命令级 `pnpm_config_verify_deps_before_run=false`，避免重复自动安装；这不跳过仓库检查或提交 hook。`npm_config_` 前缀对此设置无效。最终提交 hook 已正常通过。
- 2026-10-29 `pnpm run check` 退出码 0，196 个测试文件、2913 个测试全部通过；构建、类型、仓库门禁、发布包和宿主 source/dist 加载通过。检查进程已退出，未留下本任务后台进程。这不替代正式补丁集成验收。
- 新增 [CPU 调查](evidence/render-cpu.md)、[可重复基准](experiments/render-cpu.mjs)、[区域实验](experiments/region-renderers.mjs) 和两次原始结果。1000 对历史的纯动态帧，区域方案普通模式 CPU 降低约 64%/70%，全屏约 82%/90%；通用缓存正常流式帧开销增大，不采用。短帧存在波动，不承诺所有场景同比降低。
- 区域实验仍使用夹具坐标，未实现自动几何、布局元数据同步或正式 API；仅证明收益空间。不能直接把实验包装当成正式宿主补丁。临时生成的 renderer 文件已清理。
- CPU 调查后的 `pnpm_config_verify_deps_before_run=false pnpm run check` 再次通过，2913 tests passed。没有产品代码变更或全局 Pi 变更。

## Current Assumptions

正式区域追踪、稳定 TUI Proxy 下的句柄、全屏 layout 更新及复杂交互回退仍需实施验证，归属切片的 Acceptance。已检查 InteractiveMode 原生 widget/status/footer 挂载、createChatViewport 和 createInteractiveTuiReference，存在明确接入位置；不再把这些内部问题作为新增产品范围问题反复询问。

CPU 预算为待审核切片的一部分：200/1000 对历史纯动态帧至少降低 30%；普通/未接入路径额外开销不超过 max(10%, 0.1ms/帧)。不能由 worker 自行放宽，失败须修复或重开规划。

## Continuation Point

等待用户审核 [两关实施切片](slices.md)：Slice 1 交付普通模式完整可用能力与原版回退；Slice 2 交付全屏、模式切换及整体验收。当前没有 Implementation Issue、没有 worker，不能在审核前正式施工。

用户接受后将 slices.md 标记 Accepted，按 adventure 创建两个 Implementation Issues，建立 Map 子 Issue 和 Slice 2 依赖 Slice 1；保存并派发首关独立 worker。worker 必须完整读取 `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md` 及必要引用，按 Spec、关卡和 CPU 证据在 Issue 正文维护执行计划。提供本 worktree 和当时 HEAD、操作限制，不继承整段对话，不允许再委派。使用原生 Codex worker 时显式 fork_turns:none；其他模型或特殊设置依当前 orchestration 规则。

最终须验证两种模式、原版降级、实际打包安装入口、CPU 预算及交互正确性，运行 pnpm run check，清理本任务临时资源。所有 Implementation 通过后等待用户确认，不能自行合并、关闭 Map 或清理冒险分支。
