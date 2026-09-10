# Goal execution report

## Status

Implementation level #6，实施完成，待协调者独立验收，不自行关闭。采用最新 #3/#6、C5 英文文案、C11 队列副作用与 [C12 重试取消归类](https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5601611967)。基准 `f4a7e44b43070748f082523b7377b165c9471e9e` 加已验收 #4/#5 和 #6 未提交工作区。

完整证据已追加 [#6 评论](https://github.com/wangxuyang1221/adventure/issues/6#issuecomment-5602144267)，正文更新后读回一致，issue 保持 OPEN。本报告替代前次“等待重试取消方案”的有效结论，不抹除历史 Red。[前次报告](https://github.com/wangxuyang1221/adventure/issues/6#issuecomment-5601047159) 与 `.scratch/goal-level6-c12/report-before-c12.md` 保留原状。C12 是接受限定行为差异，不是修复重试取消的公开事件缺口。

## Implemented work

- `extensions/goal/src/storage.ts` 的权威 control 提交覆盖 edit/pause/resume 和工具终态。resume 状态与解除 continuationDeferral 同次提交。edit 保留身份、预算和累计统计；替换才重新计数。沿用 #5 assertCurrent、checkpoint 和会话 epoch。
- `tools.ts`、`upstream.ts` 对齐 Codex 0.153.4 commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a` 的三个工具 schema、描述、响应和两个提示。校验额外字段、Unicode 目标、正安全整数预算、取消信号及旧工具调用。edit 的 objective_updated 指令只发送一次。Apache LICENSE/UPSTREAM 随包保留。
- `scheduler.ts` 只用公开事件和消息 API，最多保留一个自有续跑。身份包括实例、会话、goal、generation 和运行代次；删除旧自有提醒，仅在末尾为失效自有请求时 ctx.abort。不清除普通用户请求。旧目标事件不能停止新目标。
- `index.ts` 的写入/权威检查失败会关闭内存自动推进门禁，保留权威记录，修复后显式 resume。旧失败仅在记录身份和 revision 仍匹配时影响门禁。最小 status 显示状态、保存统计和 provider/存储限制；移除旧 storage-only 文案。
- 错误先交给 Pi 原生重试，settled 后明确额度错误为 usage_limited，普通或不明错误为 blocked。压缩失败/取消停止目标，但显式输入或手动压缩可解除恢复抑制，不永久禁用压缩。
- 完整 turn 审计不等于 agent_end 数。同轮多次实际 bash 失败只记一轮，任一成功工具打断失败连续性，拒绝执行或取消不记失败。连续三轮后 blocked。

## Accepted limits

[C11](https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5600566440) 仅适用于取消尚未发出的失效自有续跑。此时公开 ctx.abort 会清除其他扩展尚未处理的排队消息，用户追加文字可能退回编辑器，需要重发。保存 goal、用户文字和已有历史必须保留。没有失效自有请求时不得借此清队列。

C12 仅允许原生重试等待中真实 Esc 取消后为 blocked，停止并保留统计，可 /goal resume。模型/工具运行中 Esc 和 /goal pause 仍为 paused。编辑或确认弹窗 Esc 不暂停。不包装 provider、不接入或重建 editor、不读取私有宿主、不改 Pi 核心。

预算触发、用量/时间结算、子孙计费、附件、完整 codex-ui 视觉集成未执行，仍归后续关。测试中的 37 tokens/11 seconds 是预先持久化的统计，用于核验保留，不代表已实现 #7 计费。真实 TUI 使用原装 InteractiveMode 和默认 editor，不宣称完整 codex-ui 集成已验收。

## Test evidence

最终证据根目录 `.scratch/goal-level6-c12/`。实际 TUI 夹具为 `extensions/goal/__tests__/acceptance-tui.mjs` 与 `acceptance-tui-driver.py`。每个 `final-{0843,0851}-{scenario}/` 保留真实 PTY ANSI、结构化事件、持久会话、权威记录和 pid.txt，同名 `.log` 包含版本、断言结果及退出状态。

### Actual TUI matrix

以下每项均在 Pi 0.84.3 和 0.85.1 通过，共 28 次实际 InteractiveMode PTY 运行。driver 发送真实 Enter、Alt+Enter、Esc，不用受控 UI SDK 代替 TUI。确认/编辑取消等待标题实际出现在终端后再按 Esc。

| Scenario | Verified outcome in both versions |
| --- | --- |
| retry-c12 | 原生等待 Esc 后 blocked，仅 1 次请求；resume 后 complete，共 3 次；goal 身份及 37 tokens/11s 保留 |
| stream-interrupt | 模型流式输出中 Esc 后 paused，resume 后 complete，共 3 次；统计保留 |
| stream-pause | 模型运行中 /goal pause 后 paused，resume 后 complete，共 3 次 |
| tool-interrupt | 真实 bash sleep 期间 Esc 后 paused，即使 provider 返回 error stop reason；resume 后 complete，共 3 次 |
| edit-cancel | 原生编辑弹窗 Esc，不改变目标文本/身份，不误暂停；complete，共 3 次 |
| replace-cancel | 原生替换确认 Esc，不改变目标身份，不误暂停；complete，共 3 次 |
| retry-dialog | 原生重试等待时另一扩展确认弹窗 Esc 返回 false，仍 active；原生重试后 complete，共 3 次 |
| c11 | 保存历史后失效自有续跑被取消，仅 1 次请求；真实用户追加文字退回编辑器、历史与 goal 保留；另一扩展队列消息被清除，属于已接受限制 |
| input-steer | 真实 bash 运行时 Enter steer，用户与另一扩展 follow-up 都进入历史/上下文，共 4 次请求，无失效请求时不清队列 |
| input-followup | 相同场景真实 Alt+Enter follow-up，共 5 次请求，用户与扩展消息保留 |
| compact-success | 原生自动压缩成功后继续并 complete，共 4 次请求 |
| compact-failure | 原生压缩失败后 blocked，显式输入可恢复压缩和回复，再 resume complete，共 6 次 |
| compact-cancel | 原生压缩中 Esc 后 paused，显式输入后可恢复，再 resume complete，共 6 次 |
| compact-manual | 自动压缩失败后 blocked，手动 /compact 成功，显式输入及 resume 可继续，共 6 次 |

### Runtime and unit matrix

`execution-runtime-{0843,0851}.log` 每版 9 项真实 SDK 验证。此夹具受控 UI 仅用于 runtime，不冒充真实 TUI。

| Runtime scenario | Calls / agent ends per version |
| --- | --- |
| model-get-create-get-complete | 5 / 1 |
| model-cannot-replace-unfinished-goal | 3 / 1 |
| create-auto-complete | 2 / 1 |
| three-full-failed-bash-runs | 6 / 3 |
| user-followups-count-as-complete-runs | 6 / 1 |
| native-retry-then-continuation | 4 / 3 |
| native-retry-exhausted | 2 / 2 |
| native-compaction-success | 4 / 2 |
| native-compaction-failure-explicit-input-and-resume | 6 / 4 |

`unit.log` goal 53 单测通过，覆盖 tools 3、scheduler 12、controls 9、storage 14、commands 15。工具参数、固定提示、同轮多失败、连续失败重置、停止状态、写盘失败、权威检查失败、旧工具/事件、会话切换和 UI 文案均有断言。

#4/#5 回归为双版本各 6 项基础 runtime、15 项 lifecycle-runtime、4 项 processes，日志 `{runtime,lifecycle-runtime,processes}-{0843,0851}.log`。包含真实会话切换、fork/clone/reload、六种继承状态、写入失败、旧 context 拒绝及 SIGKILL/双进程争用。

`check-final.log`：pnpm run check 退出 0，856 passed、1 既有 skipped，类型检查、构建、7 个发布入口和包边界校验通过。git diff --check 通过。所有模型均为免费本地 faux，实际 runtime/TUI networkAttempts=0，无联网模型调用。

### Red to green and diagnostic limits

- 完整轮次曾在一个 agent_end 内 Red 为 7 次请求；修复后双版本均为 6 次，历史位于 `.scratch/goal-level6-evidence/`。
- 本轮新增行为的 Red 日志保留为 `.scratch/goal-{edit,tools,ui,status-resume,checkpoint}-red.log`。
- `tool-interrupt-red-0843/` 是产品 Red：实际工具中断时 faux provider 将停止报为 error，目标误为 blocked。修复为保存当前 context 的公开 AbortSignal，在 agent_end 核验后 paused；`tool-interrupt-green-0843/` 和最终双版本矩阵 Green。没有将 C12 扩大到工具中断。
- `compact-cancel-0843/` 是夹具事件名错误及旧 driver 清理等待超时，不是产品语义失败。改用实际 compaction_start，并为清理加终止升级和 waitpid；fixed 与最终双版本通过。超时后另用 ps 核验无留存进程。
- `edit-cancel-0843/` 是 driver 未等待可见编辑标题的诊断失败，之后等待真实标题再 Esc；visible 与最终双版本通过。
- 原 `.scratch/goal-level6-evidence/retry-escape-red-*` 与原 `execution-tui*` 夹具保留“必须 paused”的旧 Red。新 C12 断言接受 blocked 并验证停止、统计保留、resume，不伪称原语义修复。

## Reproduction

```bash
pnpm run check
node extensions/goal/__tests__/execution-runtime.mjs
node extensions/goal/__tests__/runtime.mjs
node extensions/goal/__tests__/lifecycle-runtime.mjs
node extensions/goal/__tests__/processes.mjs
GOAL_TUI_SCENARIO=retry-c12 conda run -n codex-py312 python extensions/goal/__tests__/acceptance-tui-driver.py .scratch/fresh-retry-c12 node_modules/@earendil-works/pi-coding-agent
```

TUI scenario 可替换为上表名称，证据目录必须全新。0.85.1 使用已安装对应 Pi 包绝对路径作为各命令最后参数。测试只将 agentDir、goals、session 和临时资源写在仓库，免费 faux 替代模型，禁止网络 fetch。不加载用户全局配置或改动源码。

## Cleanup and handoff

`cleanup.json` 核验本轮留下 pid.txt 的 38 个 PTY 子进程均已停止，监听数为 0。driver waitpid 回收并有超时 SIGTERM/SIGKILL 保护。另用 ps 核验无 goal 测试、Python driver 或 sleep 20 留存；SDK 与进程回归前台退出，临时测试目录自行删除。保留原始证据、历史原型、研究和协调者改动。

没有委派、commit/push/deploy、付费模型、全局目标写入或手改 dist。下一步由协调者独立审核 V1/V4 与 C11/C12 限制，接受后再关闭 #6；本 worker 交回正文写权，不承接 #7。
