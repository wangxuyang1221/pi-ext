# Subagent cleanup starting point

## Scope

本报告支持 Planning #19 的优先场景确认，以及 Planning #20 的初始可行性调查。仓库起点为 `38a623c`，未修改产品代码，未操作用户现有 tmux 会话。

## Repository findings

- `extensions/subagent/src/index.ts:189`：`session_shutdown` 调用 `host.shutdown()`，随后释放 namespace；没有调用 manager 的子代理关闭入口。
- `extensions/subagent/src/runtime-host.ts:142`：shutdown 标记当前 runtime 为 closed，清空内存中的 active session ID，不遍历子代理。
- `extensions/subagent/src/tmux-runtime.ts`：子代理在独立 tmux window 中启动；定向关闭使用已核验定位信息的 `kill-window`。
- `extensions/subagent/src/manager.ts:486`：已有 `close(parentSessionId, "all")`；会设置 closingAll，等待正在启动的代理，协调所有权和预约项，再关闭已登记进程。能否在新的退出流程中完整复用，还需要运行验证和失败场景核验。

这些证据解释了主进程退出后子代理仍可能存活的代码起点，不代表已经复现用户所有退出方式。

## Version and upstream verification

项目及主工作区安装包均为 `@earendil-works/pi-coding-agent` 0.86.0。实际 Node 为 22.22.2，pnpm 为 11.9.0。

联网通过 GitHub API 核验 tag `v0.86.0` 指向 `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`。Context7 已解析到 `/earendil-works/pi`，但文档查询返回 fetch failed；因此使用本地安装包及该版本官方源码，不将滚动版本文档当作版本保证。

- [Interactive mode](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts)：普通 Ctrl+D、双 Ctrl+C、`/quit` 和 extension shutdown 最终进入 shutdown。普通路径先 stop TUI，再 dispose runtime，不能在后置清理事件里直接承诺可交互选择。信号退出有另一条路径，终端损坏还有 emergency exit。
- [Extension types](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/extensions/types.ts)：`session_shutdown` 原因包括 quit、reload、new、resume 和 fork，不能把该事件一律解释成用户结束会话。存在 `onTerminalInput`、UI select 和 context shutdown，但未发现专用的 before-quit 可取消事件。
- [Extension runner](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/extensions/runner.ts)：`app.exit` 和 `app.clear` 是保留快捷键，不能简单通过 registerShortcut 覆盖退出。

## Decision boundary

已确认需求的唯一完整来源为 [Spec #18](https://github.com/wangxuyang1221/pi-ext/issues/18#behavior)。本报告不新增退出默认行为、时间限制或自动回收权限。

Planning #19 已有足够证据确认问题起点，并将退出交互、无选择退出和遗忘后的处置分别移交 #20、#21、#22。

## Pending verification

当前均为静态核验，未完成交互原型。#20 需核验用户实际采用的退出入口、公开输入接入点与现有编辑器/对话框的兼容性、定向关闭失败和取消行为。不能将 `onTerminalInput` 的存在等同于所有退出路径已经可被安全拦截。
