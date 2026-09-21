# Quit choice prototype

## Question

在真实 Pi 0.86.0 中，通过公开编辑器 factory 和 onSubmit 组合，能否在内置 `/quit` 执行前显示退出意图选择，并保留现有编辑器？

## Landing map

- Target：用户从主输入框提交 `/quit` 的路径。
- Context：真实 Pi TUI、原生命令补全、现有 Codex UI 与 skill 标签扩展。
- Contract：`getEditorComponent`、`setEditorComponent`、编辑器 `onSubmit`、`ui.select` 和 `ctx.shutdown`。不改宿主方法，不覆盖保留快捷键，不在 session_shutdown 弹窗。

## Run

在本冒险 worktree 根目录执行：

```sh
node adventure/prototypes/quit-choice/run.mjs native regular
node adventure/prototypes/quit-choice/run.mjs combined fullscreen
conda run -n codex-py312 python adventure/prototypes/quit-choice/smoke.py
```

输入 `/quit` 后，选择 Leave temporarily 或 End session，按 Escape 取消。

## Boundary

宿主、选择界面、编辑器和退出均为真实实现。模型使用现有 faux fixture，无网络调用。两种选择均记录用户意图并退出；原型不加载生产 subagent 扩展、不创建或回收真实 subagent，因此不验证后台代理回收。状态写入隔离的本 worktree `.tmp`，退出后由 launcher 清理，不修改日常 Pi 配置。

只验证入口，不将 prototype adapter 直接视为生产代码。重载/恢复生命周期、正在生成时退出、实际代理回收、清理失败及其他退出路径仍需后续验证。

## Results

真实 Pi PTY smoke 共 12 组通过：原生 regular/fullscreen、Codex regular、Codex + skill regular/fullscreen、反向扩展加载顺序 regular，各验证两种退出选择。每组先取消退出，再提交正常 prompt，之后再次 /quit 并选择退出。已核对意图记录、唯一 quit 清理事件、正常 prompt 处理、组合模式的实际 skill 内容激活、CLI 与 launcher 退出、临时目录移除。

原型单文件 TypeScript 检查通过。详细数据见 [PTY results](../../evidence/subagent-quit-prototype-results.json)。没有验证实际 subagent 回收、正在工作的主 agent、全部重载/恢复路径、其他退出方式或用户亲自操作的体验。

当前 prototype 每次 /quit 都弹出选择，初始高亮 Leave temporarily，Escape 取消退出。这些是候选交互，尚未确认是否仅在存在存活 subagent 时询问。

生产实现应重新设计生命周期与 editor factory 的释放/恢复，不直接照搬这份仅覆盖一次挂载的 adapter。
