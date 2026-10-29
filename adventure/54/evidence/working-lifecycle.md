# Working lifecycle evidence

## Decision

用户已确认整项任务期间持续显示 Working，包括工具执行、重试、自动压缩，以及权限确认或其他对话框等待用户操作。等待期间继续转圈和反光；约两秒没有可计数片段时，速率按既定规则显示 `-- t/s`。任务真正结束后隐藏 Working 和速率，不保留最后数值。

取消沿用宿主现有语义。按下取消键不等于后台工作已结束，不额外拦截或提前隐藏；宿主确认任务结束后再清理显示。未运行任务时打开普通对话框不会单独启动 Working。

原型样式、窄窗口表现及用户审阅见 [原型证据](old-codex-working-prototype.md)。沿用已确认布局，32/40/100 列保留 Working 与 footer 右侧速率，窄于 40 列省略中断提示；更极端宽度按显示列安全截断，不另加一行挤占输入。原版宿主回退到正常刷新是原 Spec 已确认的兼容约定，不是新增模式选择。

## Source findings

检查对象为本 worktree 安装的 Pi 1.4.0 和当前 codex-ui，2026-10-29。

- `extensions/codex-ui/src/terminal-title.ts` 已采用 `agent_start` 与 `agent_settled` 管理标题动画；`agent_end` 可能先于自动重试或压缩，因此不能作为新增行内 UI 的结束边界。现有标题行为保留。
- `pi-coding-agent/dist/core/extensions/types.d.ts` 的 `AgentSettledEvent` 明确在无自动重试、压缩或排队续行后发出，并携带 `aborted`。新增 UI 可以复用这一真实任务边界。
- 同一类型文件已提供 `ui_prompt_start` / `ui_prompt_end`。此前“未找到通用等待事件”的记录只是检索未完成，不能据此声称宿主不支持。`dist/core/extensions/runner.js` 的 `wrapUIPromptContext` 包装 select、confirm、input、editor 和 custom，`withUIPrompt` 在最外层进入/退出时发事件，并处理异常收尾。当前用户决定不在这些事件上暂停 Working，因此不需要为等待状态增加宿主接口。
- 现有 `terminal-title.test.ts` 覆盖任务、压缩、重装、非 TUI、shutdown 和定时器释放，可供新增生产生命周期测试参照；它不等于尚未实现的行内 UI 已通过。

## Verification boundary

本次为事件契约和现有代码查证，没有声称新增正式 UI 已实现。实施需从实际 provider 事件验证 Working 与速率组合，覆盖重试、自动压缩、等待输入、取消完成、会话切换、reload、shutdown 及迟到回调。速率按每次响应重置，Working 按整项任务存续，两者不能共用错误的结束边界。

权限对话框可能遮挡状态区域，不能为维持动画画面覆盖对话框或抢焦点；局部刷新不安全时回退正常渲染。原有 `/quit`、输入草稿和取消操作必须正常工作。
