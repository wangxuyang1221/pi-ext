# Investigation Task

你是 leaf investigator。不得创建、调用或委派任何 subagent，必须亲自完成本研究线索。

## Goal

基于 Pi 0.84.3 的官方文档、源码和一方测试，调查 session JSONL 究竟持久化了哪些数据，以及它是否足以作为跨 Pi 读取的权威 timeline 和 `pi resume` 基础。

当前设计曾计划让 extension 重复写入 prompt、每个 turn 的最终 assistant message、tool call、tool result、run/session 状态和最终结果。现在需要判断这些信息中哪些已经存在于 Pi session JSONL，哪些无法仅从 JSONL 获得。

## Scope

必须查明并区分：

1. session JSONL 的记录类型、关键字段和顺序语义，包括 header、user/assistant/toolResult message、tool call 参数和结果、usage、model、compaction、branch、custom entry、session metadata 等实际存在的内容。
2. `/resume`、`/new`、`/fork`、`/clone`、tree navigation 和 compaction 如何使用这些记录。
3. 以下目标数据能否仅从 JSONL 可靠恢复：初始 prompt、steer、follow-up、每个 turn 的最终 assistant message、每次工具调用和最终结果、run/turn 边界、agent settled、当前运行状态、工具 partial update。
4. 哪些信息属于持久会话事实，哪些只是运行时 lifecycle event。
5. 对“extension 只做结构化提取，而不重复保存 timeline”的可行性给出明确边界。

## Sources

只使用 primary sources：本机安装的 `@earendil-works/pi-coding-agent@0.84.3` 官方文档、对应源码和一方测试；必要时使用官方 GitHub 仓库。先用以下命令定位安装包，不要硬编码 pnpm store hash：

```bash
find ~/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3 \
  -path '*/node_modules/@earendil-works/pi-coding-agent/package.json' \
  -print -quit
```

完整阅读所有直接相关的 `.md` 文档，并跟进相关交叉引用。每项关键主张注明官方文件或源码位置及适用边界。

## Boundaries

- 不修改正式源码、skill、extension 或仓库配置。
- 不读取用户已有 session 的具体内容。
- 如需实验，只能在隔离临时目录进行，结束前清理全部临时文件和进程。
- 不讨论尚无证据支持的实现方案。
- 遵守 `/Users/wangxuyang/Code/t3code/pi-ext/docs/agents/repository-language-policy.md`。

## Deliverable

将调查结果写入：

`/Users/wangxuyang/Code/t3code/pi-ext/.scratch/docs/research/pi-session-jsonl-content.md`

文档标题使用 English，正文使用中文。根据证据风险包含 `Evidence Pack`、`Synthesis`、`Design Implications` 和 `Open Questions`。完成后只回复文档路径、关键结论和未决问题。
