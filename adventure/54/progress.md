# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为仓库内 Pi 提供可复用的 TUI 局部刷新机制，供扩展显示实时 token 速率、Working 动画等动态内容。用户不确定能否实现，当前先查证可行性，不把某个候选接口视为已确认规格。

## Evolution

用户最初希望给 Pi 打仓库内补丁，并保证全局命令和升级不受影响。源码检查发现宿主已有终端差异输出，但 Loader 每 80ms 请求全局组件刷新。用户随后明确，需要的是供自定义动态内容使用的机制，不只是修改原生 Working。

## Agreed Decisions and Constraints

- [Map #54](https://github.com/wangxuyang1221/pi-ext/issues/54)、[Spec #55](https://github.com/wangxuyang1221/pi-ext/issues/55)；完整规格只维护在 Spec 正文。
- [方向 Planning #56](https://github.com/wangxuyang1221/pi-ext/issues/56) 已通关。token 速率和 Working 是用途示例，不代表已要求实现 token 采集、具体样式或默认 UI 改动。
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
- 2026-10-29 `pnpm run check` 退出码 0，196 个测试文件、2913 个测试全部通过；构建、类型、仓库门禁、发布包和宿主 source/dist 加载通过。检查进程已退出，未留下本任务后台进程。这不替代正式补丁集成验收。

## Current Assumptions

候选是显式请求某个组件刷新，复用无关组件的上一帧结果，正常请求仍按原逻辑渲染。上述局部算法已通过夹具实验，正式接入和完整正确性尚未证明，不承诺完全跳过全局布局及最终行处理，也不据短耗时样本承诺 CPU 降幅。

已向用户提交范围问题：第一版是否聚焦 token 速率、计时、Working 等文字状态组件；尺寸稳定时局部刷新，窗口、布局或其他内容变化允许正常渲染，暂不承诺任意复杂组件。当前等待答复，不将推荐方案视为已确认。

## Continuation Point

继续 [Planning #57](https://github.com/wangxuyang1221/pi-ext/issues/57)。最小技术实验已完成，不重复已有证明。先接收用户对第一版范围的回答，再明确正式宿主接入、普通与局部更新的失效规则、原版降级，以及覆盖层、滚动、主题和销毁等未验边界。实验是技术探测，不是用户已审核产品原型。

形成可验证的机制和边界后，把需要用户选择的具体取舍交给用户；确认前不关闭 #57、不进入正式实施。实施准备按 adventure 读取 slicing skill，切片审核后才能派 worker。最终须在独立补丁宿主和原版降级路径验收，运行 pnpm run check，并清理本任务临时资源。
