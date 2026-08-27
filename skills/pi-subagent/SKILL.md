---
name: pi-subagent
description: Delegate self-contained work to a tmux-backed child Pi when the user requests a subagent or a task benefits from independent context. Also use to inspect recent activity, steer, or reuse an existing child session.
---

# Pi Subagent

## Model

使用 `bash tool` 在 tmux 中启动另一个 Pi 进程。同一项目的子 Pi 共享一个 tmux session，每个子 Pi 独占一个 window，并保有独立上下文和 Pi session 目录；主 Pi 负责分派、查询进度和整合结果。

适合委派的任务应当边界清楚，能从一份自包含 prompt 开始。小型步骤或需要频繁共同决策的工作由主 Pi 直接处理。

## Workflow

1. 确认 `pi` 和 `tmux` 可用。
2. 创建唯一 `child-id`，使用 `.pi/subagents/<child-id>/` 作为独立 session 目录，并为子 Pi 编写包含目标、范围、产物、上下文入口和写入边界的 prompt。
3. 为当前项目选择稳定的 `<tmux-session>` 并持续复用。首次启动用 `tmux new-session` 创建它，后续用 `tmux new-window` 添加名为 `<child-window>` 的 window；默认每个子 Pi 一个 window，不拆分 pane。window 中运行 `pi --session-dir <dir> --name <child-id> <prompt>`。
4. 启动后立即向用户报告 `child-id`、Pi session 目录、`<tmux-session>:<child-window>` 和以下实际命令：

```bash
tmux attach-session -t <tmux-session>
tmux capture-pane -p -S -100 -t <tmux-session>:<child-window>
```

说明 `Ctrl-b w` 可选择 child window；按 `Ctrl-b`，再按 `d`，可以退出查看而不停止子 Pi。

5. 查询最近活动时，先检查 tmux session 是否存在，再读取 pane 状态：

```bash
tmux display-message -p -t <tmux-session>:<child-window> '#{pane_dead} #{pane_current_command} #{pane_last_output_time}'
```

保存 `pane_last_output_time`。它变化时再运行 `tmux capture-pane -p -J -S -60 -t <tmux-session>:<child-window>`，只概括新增活动；没有变化时报告暂无新输出。

6. 发送 prompt 前确认子 Pi 位于编辑界面。单行 prompt：
```bash
tmux send-keys -t <tmux-session>:<child-window> -l "$prompt"
tmux send-keys -t <tmux-session>:<child-window> Enter
```
7. 多行 prompt 使用 bracketed paste：
```bash
buffer_name="pi-prompt-$$"
printf '%s' "$prompt" | tmux load-buffer -b "$buffer_name" -
tmux paste-buffer -p -r -d -b "$buffer_name" -t <tmux-session>:<child-window>
tmux send-keys -t <tmux-session>:<child-window> Enter
```
8. 子 Pi 空闲时，`Enter` 正常提交。工作中发送 `Enter` 会进入 Pi steering queue，在当前 assistant turn 完成其工具调用后送达。
需要等当前工作全部结束时，改用 `tmux send-keys -t <tmux-session>:<child-window> M-Enter`，消息会进入 follow-up queue。
9. 发送后按相同方式观察活动。完成委派后保留 tmux session、child window 和 JSONL，并告诉用户它们仍可查看或复用。只有用户明确要求时才停止对应 window 或 tmux session。

## Boundaries

- 进度查询只使用 tmux，不加载 session JSONL。
- pane 内容是可观察活动，不是结构化消息或任务完成证明。它可能包含 TUI 重绘、状态栏和工具输出，主 Pi 只提炼与进度有关的部分。
- 每个 session 文件只由一个 Pi 进程追加。
- 只有环境或生命周期需要完全隔离时，才为子 Pi 创建独立 tmux session。
- 多个子 Pi 写代码前，先使用独立 Git worktree 或其他写入隔离。
