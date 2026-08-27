# Investigation Task

你是 leaf investigator。不得创建、调用或委派任何 subagent，必须亲自完成本研究线索。

## Goal

基于 Pi 0.84.3 的官方源码、文档和可逆实验，调查另一个进程或 extension 在 Pi 正常 TUI 运行期间增量读取 session JSONL 是否可靠，以及 session 生命周期变化会如何影响读取与清理。

## Scope

必须查明：

1. session JSONL 的创建、追加、flush 与关闭路径，是否逐行完整追加，读取者是否可能看到半行、乱序或尚未持久化的数据。
2. `--session-dir`、`ctx.sessionManager.getSessionFile()`、session ID 和 session 文件路径之间的关系。
3. `/new`、`/resume`、`/fork`、`/clone`、`/reload` 和退出时，当前文件是否切换、extension 实例是否重建、读取者如何识别新文件。
4. 正常 TUI 工作时并发只读、tail、文件 watcher 或定期扫描的可靠性边界。区分源码保证与操作系统观察结果。
5. JSONL 对实时状态的时效性：工具开始、partial update、工具结束、assistant 完成、queued steer/follow-up、retry、compaction retry、`agent_settled` 分别何时或是否落盘。
6. 删除 session JSONL、session 目录或 sidecar 数据对 `pi --resume`、session selector 和后续恢复的具体影响。
7. 如果只保存 session JSONL，异常退出、强制 kill 和最后一条未完成 turn 的可观察状态是什么。

## Sources and Experiments

只使用 primary sources：本机安装的 `@earendil-works/pi-coding-agent@0.84.3` 官方文档、对应源码和一方测试；必要时使用官方 GitHub 仓库。先用以下命令定位安装包：

```bash
find ~/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3 \
  -path '*/node_modules/@earendil-works/pi-coding-agent/package.json' \
  -print -quit
```

可以在系统临时目录进行最小实验，但不得读取或修改用户已有 session。所有实验进程和临时文件必须在结束前清理。记录实验命令、观察结果与源码保证之间的差异。

## Boundaries

- 不修改正式源码、skill、extension 或仓库配置。
- 不执行 Pi 安装或修改全局配置。
- 不把实验观察误写成 API 保证。
- 遵守 `/Users/wangxuyang/Code/t3code/pi-ext/docs/agents/repository-language-policy.md`。

## Deliverable

将调查结果写入：

`/Users/wangxuyang/Code/t3code/pi-ext/.scratch/docs/research/pi-session-jsonl-live-reading.md`

文档标题使用 English，正文使用中文。根据证据风险包含 `Evidence Pack`、`Synthesis`、`Design Implications` 和 `Open Questions`。完成后只回复文档路径、关键结论和未决问题。
