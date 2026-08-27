# Subagent Tool UI Prototype

## Purpose

这个原型只验证八个 subagent 工具在真实 Pi transcript 中的视觉形态，不实现 tmux、session 解析或生命周期逻辑。工具参数、`renderCall`、`renderResult` 与 `renderShell` 都由真实 Pi Extension API 注册；执行结果使用固定 fixture。

## Visual Baseline

视觉语法同时遵循两条已有基线：

- 仓库内 `codex-ui`：复用相同的 `codex-pi` theme token、宽度裁剪逻辑、`renderShell: "self"` 和低噪声 transcript 排版。
- Codex CLI `0.149.0`：参考 commit `758ef40f50c1a458425c7cfbf1eb12cbc07af0b0` 的 `codex-rs/tui/src/multi_agents.rs`。其 subagent 事件使用扁平 `PlainHistoryCell`，标题以 dim `•` 开始，agent 名称使用 cyan，详情以 `  └ ` 缩进；不使用卡片、边框或时间线。

原型据此采用以下形态：

```text
• Spawned Robie (gpt-5.6-sol · high)
  └ Audit the runtime ownership boundary and report only actionable race conditions.

• Sent input to Robie (steer)
  └ Also verify how an externally killed tmux pane is detected.

• Finished waiting for Robie (30s timeout)
  └ Settled · generation 2 · 8.4s
```

`subagent_close` 与 `subagent_forget` 会在结果行明确显示数据保留边界，避免只靠颜色区分破坏性语义。

## Run in Pi

从仓库根目录执行：

```bash
npm run prototype:subagent-ui
```

该命令会：

1. 使用 Pi `SessionManager` 在原型目录的临时分区生成合法 session JSONL。
2. 启动真实 Pi TUI，并显式加载 `extensions/codex-ui/src/index.ts`、本原型 Extension 与 `themes/codex-pi.json`。
3. 让 Pi 自己通过 `ToolExecutionComponent` 渲染八个工具调用。
4. Pi 退出后删除临时 session。

在 TUI 中按 `Ctrl+O` 可切换 collapsed/expanded 结果，验证 `subagent_list`、`subagent_read`、`subagent_wait`、`subagent_close` 与 `subagent_forget` 的详细形态。

## Implementation Boundary

以下部分是可直接迁移到正式 Extension 的真实实现：

- `pi.registerTool(...)`
- TypeBox 参数 schema
- `renderShell: "self"`
- `renderCall(...)`
- `renderResult(...)`
- Pi `Component` 的响应式宽度处理
- `expanded` 与 partial/error 状态处理

以下部分仅为原型 fixture，不能迁移为正式运行逻辑：

- 固定 agent、activity、cursor 与 generation
- `execute(...)` 中的模拟结果
- `demo.mjs` 生成的展示 session
