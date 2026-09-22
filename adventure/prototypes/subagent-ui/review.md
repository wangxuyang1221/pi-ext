# Prototype acceptance

## Decision

用户已确认 /after，并在收敛阶段明确将最终成功文字绿色改回 #46e87c。有效视觉规则已移交 [Spec #25](https://github.com/wangxuyang1221/pi-ext/issues/25)。未采用方案的记录见本文件 Git 历史，当前只保留已确认原型。

## Preview

[状态局部](previews/after-palette.png) · [完整界面](previews/after-success.png) · [展开](previews/after-expanded.png) · [进行中](previews/after-running.png) · [失败](previews/after-error.png) · [超时](previews/after-timeout.png) · [窄屏](previews/after-width-40.png)

这些图来自真实 Pi PTY 单元格重绘，内容、颜色与位置来自捕获，字体与行高是预览近似。

## Verification

原型已验证六类工具消息的信息保留、调用状态颜色、成功文字绿色、折叠/展开和长名称。收敛后保留 40 组渲染对照与 7 个宽度边界；普通与全屏 PTY 各覆盖 10 个捕获场景。技术验证不覆盖新增的英雄名功能。

原型全部使用固定数据，运行过程的 fetch 调用数为零。本任务的验证进程退出后清理临时运行目录；用户自己打开的原型不由本任务关闭。

## Repository baseline

pnpm run check 的类型检查通过；2376 项测试通过、11 项跳过。当前提交缺少 prototypes/mcp-status-ui-prototype 源码目录，导致 1 个测试文件无法加载；其余 159 个文件通过。此前因长 worktree 路径失败的 4 项 tmux 测试，在移到 .scratch/u 后通过。

独立 pnpm run build 已通过；pnpm run package:check 另因缺少 docs/goal-descendant-acceptance.md 失败。正式交付前须解决这些基准缺口，不能把原型验收当作完整发布验收。

## Next

视觉关卡已确认，新增随机英雄名继续在 [Planning #28](https://github.com/wangxuyang1221/pi-ext/issues/28) 收敛。完成后统一准备实施切片，交由用户审核。
