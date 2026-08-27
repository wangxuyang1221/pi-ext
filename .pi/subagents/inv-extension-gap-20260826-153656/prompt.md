# Investigation Task

你是 leaf investigator。不得创建、调用或委派任何 subagent，必须亲自完成本研究线索。

## Goal

调查 Pi 0.84.3 extension API 与 SessionManager 能否直接提供 session JSONL 的结构化读取视图，以及为了满足跨 Pi 观测，session JSONL 之外最少还缺哪些运行时信息。重点识别重复持久化可以删除到什么程度，不实现方案。

## Scope

必须查明：

1. extension 在正常 TUI 模式下可通过 `ctx.sessionManager` 读取哪些 entry、branch、session file 和 session ID；这些对象与 JSONL 的对应关系。
2. `getEntries()`、`getBranch()`、`buildContextEntries()` 等 API 的语义差异，以及哪个视图适合完整历史、活动 branch 和模型上下文。
3. extension lifecycle events 中哪些事件已经对应持久化 entry，哪些事件没有持久化等价物，重点检查：
   - input、before_agent_start
   - agent_start、agent_end、agent_settled
   - turn_start、turn_end
   - message_start、message_update、message_end
   - tool_execution_start、tool_execution_update、tool_execution_end
   - session_start、session_shutdown、session switch/fork/compact
4. session JSONL 是否已经包含恢复工作所需的 authoritative data；extension 是否只需要暴露定位信息、增量 cursor、派生索引或少量 runtime supplement。
5. 主 Pi 若不解析 tmux pane，可通过哪些一方 API 或文件读取方式获得：最终 assistant 结果、工具调用历史、当前运行状态、settled 判定和 session 切换信息。
6. 比较以下三种边界，但不要实现：
   - extension 重复写完整 timeline
   - extension 直接提供 SessionManager/JSONL 的结构化读取
   - JSONL 作为权威数据，extension 只补充无法持久化的 runtime 状态

## Sources

只使用 primary sources：本机安装的 `@earendil-works/pi-coding-agent@0.84.3` 官方 extension、session、JSON/RPC 文档，对应源码和一方 examples/tests；必要时使用官方 GitHub 仓库。先定位安装包：

```bash
find ~/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3 \
  -path '*/node_modules/@earendil-works/pi-coding-agent/package.json' \
  -print -quit
```

完整阅读直接相关 `.md`，跟进相关交叉引用。每项关键主张注明来源与适用边界。

## Boundaries

- 不修改正式源码、skill、extension 或仓库配置。
- 不读取用户已有 session 的具体内容。
- 如需实验，只能在隔离临时目录进行并完整清理。
- 不创建或调用任何 subagent。
- 遵守 `/Users/wangxuyang/Code/t3code/pi-ext/docs/agents/repository-language-policy.md`。

## Deliverable

将调查结果写入：

`/Users/wangxuyang/Code/t3code/pi-ext/.scratch/docs/research/pi-session-extension-gap.md`

文档标题使用 English，正文使用中文。根据证据风险包含 `Evidence Pack`、`Synthesis`、`Design Implications` 和 `Open Questions`。完成后只回复文档路径、关键结论和未决问题。
