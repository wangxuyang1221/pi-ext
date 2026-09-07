# Subagent tmux server recovery

## Scope and evidence

本文包含源码审查、tmux 3.6b 官方源码核验，以及主代理提供的隔离探针结果。审查基线为工作树 HEAD `8341270bcb063911b2f4e7d7689d1a01eec248a6`，重点覆盖 `extensions/subagent/src/` 与对应 `__tests__/`。审查开始时 `src/tools.ts`、对应测试和部分 `dist/` 已有未提交修改，本文按当时工作树引用，不把这些修改归入本次研究。仓库开发依赖的 Pi 版本是 0.84.3，见 [package.json:90-92](../../package.json#L90-L92)。当前研究进程使用的 Pi 文档版本是 0.85.1，不能把后者的行为当作前者的保证。

本研究者没有执行 tmux 命令、终止进程、安装依赖或修改生产代码，也没有重复运行测试。主代理已运行 `pnpm run check`，结果为 666 tests 通过、1 skipped，构建与发布包校验通过。主代理还在 macOS tmux 3.6b 上完成了专用 socket 的真实 tmux 故障注入，本研究者已完整读取 `probe.mjs`、`worker.mjs`、`results.json` 和 `probe.log`，将结果合并到本文。pane 中运行的是 Node 替身，不是真实 Pi。探针能证明 locator 检查和 manager 状态处理存在下述问题，不能证明真实 Pi 一定退出或一定残留。本机 Pi 0.85.1 的信号与终端紧急退出路径也已按主代理提供的安装位置做本地源码核验，结论见下文；没有把源码核验称为真实 Pi 故障实验。

## Summary

本 extension 能修正部分失效状态、释放部分名额，并在后续 `subagent_spawn` 中重新创建运行环境。它没有自动重启旧 child、恢复旧 tmux pane 或恢复旧 Pi 会话的公开工具。六个公开工具只有 `spawn`、`prompt`、`list`、`read`、`wait`、`close`。`spawn` 总是生成新的 process instance、新目录和空 session 文件，随后等待新 child 注册。见 [tools.ts:187-422](../../extensions/subagent/src/tools.ts#L187-L422)、[manager.ts:217-307](../../extensions/subagent/src/manager.ts#L217-L307)。

对本机 Pi 0.85.1，SIGHUP/SIGTERM 的通常路径是先进行 extension cleanup，再退出；本 extension 的 shutdown hook 因而有机会持久化 `closed`。不能把所有真实 tmux 故障都说成 `interrupted`，也不能套用忽略 SIGHUP 的 Node 替身去断言真实 Pi 必定残留。硬杀 Pi、终端紧急退出或 cleanup 未完成，才可能留下旧状态等待后续工具检查。

隔离实验已复现中断后隐藏已落盘消息、closing 持续占槽、settled 优先，以及忽略 SIGHUP 的替身仍活着但管理 slot 已释放。四组结果见 [probe.log:1-118](../../.scratch/tmux-recovery/probe.log#L1-L118)。最需要避免的误判有四个。

- `interrupted` 只说明 tmux locator 未通过检查，不能证明操作系统中的 Pi 进程及它启动的任务全部退出。`isAlive` 没有核验 `runtime.pid`，`close` 也没有 PID 清理后备路径。见 [tmux-runtime.ts:159-185](../../extensions/subagent/src/tmux-runtime.ts#L159-L185)、[manager.ts:975-983](../../extensions/subagent/src/manager.ts#L975-L983)。
- `closing` 会继续占名额，`list` 和 `spawn` 都跳过它的存活检查。server 已经消失也不会仅靠这两个工具释放该名额。见 [manager.ts:657-678](../../extensions/subagent/src/manager.ts#L657-L678)、[manager.ts:953-971](../../extensions/subagent/src/manager.ts#L953-L971)。
- `list`、`wait` 或 `prompt` 将忙碌 child 标成 `interrupted` 时会清除 `busy`，却保留可能过时的 `leafId`。后续 `read` 会据此锁定旧分支终点，漏掉已写入 JSONL 的末尾活动。见 [manager.ts:621-638](../../extensions/subagent/src/manager.ts#L621-L638)、[manager.ts:1038-1059](../../extensions/subagent/src/manager.ts#L1038-L1059)。
- `subagent_close` 成功表示已移除管理关系与 extension 状态，不表示能恢复原会话，也不是独立的 OS 进程死亡证明。原生 session 文件仍保留，但之后六个工具不能继续访问已移除的 child。见 [manager.ts:517-526](../../extensions/subagent/src/manager.ts#L517-L526)、[ownership.ts:46-52](../../extensions/subagent/src/ownership.ts#L46-L52)。

## Failure classification

### Graceful shutdown and forced termination

源码并不根据用户输入的是 `tmux kill-server`、服务管理器 stop，还是向 server 发信号来分类。它只观察两件事。

1. child 是否执行完 Pi 的 `session_shutdown` hook。该 hook 只调用 `host.shutdown()`，将当前 session 写成 `closed`，清除 `busy`，不增加 `settledGeneration`，也不删除父子关系。见 [index.ts:137-139](../../extensions/subagent/src/index.ts#L137-L139)、[runtime-host.ts:102-109](../../extensions/subagent/src/runtime-host.ts#L102-L109)、[lifecycle.ts:19-28](../../extensions/subagent/src/lifecycle.ts#L19-L28)。
2. 后续 tmux `display-message` 是否成功，返回的 session name、window ID、pane ID、存活标志和 pane PID 是否与 locator 匹配。见 [tmux-runtime.ts:159-176](../../extensions/subagent/src/tmux-runtime.ts#L159-L176)。

tmux 3.6b 的正常 server 关闭路径已经从官方源码核验。`cmd_kill_server_exec` 对 server 自身执行 `kill(getpid(), SIGTERM)`；`server_signal` 收到 SIGTERM 后设置退出标记并调用 `server_send_exit`，后者通知 clients 退出并销毁 sessions。SIGKILL 强杀不经过这条正常 server 清理路径。见 [cmd-kill-server.c 的 cmd_kill_server_exec](https://raw.githubusercontent.com/tmux/tmux/3.6b/cmd-kill-server.c)、[server.c 的 server_signal 与 server_send_exit](https://raw.githubusercontent.com/tmux/tmux/3.6b/server.c)。

这一区别不能直接换算成“正常关闭时 Pi 一定写 closed，强杀时 Pi 一定残留”。隔离实验中，无自定义 SIGHUP handler 的 Node 替身在两种关闭方式下都退出；安装 handler 记录信号而不退出的替身，在两种方式下都继续存活。两个存活 fixture 都留下了 SIGHUP 记录。见 [worker.mjs:1-8](../../.scratch/tmux-recovery/worker.mjs#L1-L8)、[probe.log:1-118](../../.scratch/tmux-recovery/probe.log#L1-L118)、[term-ignore/ready.hup](../../.scratch/tmux-recovery/term-ignore/ready.hup)、[kill-ignore/ready.hup](../../.scratch/tmux-recovery/kill-ignore/ready.hup)。真实 Pi 的 handler、lifecycle 持久化及其工具子进程不在这个替身实验范围内；extension 自身也没有独立的 server 退出监听器来补足判断。见 [index.ts:102-139](../../extensions/subagent/src/index.ts#L102-L139)。

源码能确定的结果如下。

| 实际发生的情况 | extension 状态 | 后续表现 |
| --- | --- | --- |
| child 成功执行 shutdown hook | `closed`，generation 保留 | `list` 不占 active，`prompt` 拒绝，`read` 仍可读管理范围内的已存文件 |
| hook 没有写完，旧状态仍是 `starting`、`running` 或 `settled`，locator 检查返回 false | 下一次相关检查写成 `interrupted` | 通常释放 active，不创建新 child |
| hook 没有写完，旧状态是 `closing` | 继续 `closing` | `list` 仍计 active，`wait` 可能一直到 timeout，需要重试 `close` |
| locator 不可达，但原 Pi 或其工具进程仍活着 | 与“进程已死”相同的 locator 结果 | 可以释放名额或删除状态，但不会凭 PID 清掉残留进程 |
| 父 Pi 也退出 | 没有存活的工具调用者继续检查 | 需先恢复父会话运行环境，再处理其 namespace |

状态与容量分支见 [manager.ts:641-698](../../extensions/subagent/src/manager.ts#L641-L698)、[wait.ts:69-97](../../extensions/subagent/src/wait.ts#L69-L97)。父会话 shutdown 也只关闭自己的 runtime 状态，没有调用 `manager.close("all")`。见 [index.ts:137-139](../../extensions/subagent/src/index.ts#L137-L139)。

### Pi 0.85.1 interactive shutdown

本节已读取本机安装包 `@earendil-works/pi-coding-agent@0.85.1` 的实际代码，版本由该包 `package.json:1-3` 核对。以下行号均指该安装版本的 `dist/modes/interactive/interactive-mode.js`。官方对应文件为 [interactive-mode.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts)，该链接只定位上游文件，版本结论以本地 0.85.1 为准。本节不使用 Context7 的 main/RPC 文档冒充 0.85.1 交互模式的行为依据。

- `registerSignalHandlers` 在非 Windows 平台注册 SIGHUP 与 SIGTERM。handler 先调用 `killTrackedDetachedChildren()`，再调用 `shutdown({ fromSignal: true })`。本地代码行号为 `3304-3321`。
- 信号触发的 `shutdown` 先 `await this.runtimeHost.dispose()`，源码明确要求先执行 extension 的 `session_shutdown`，再尝试终端恢复。之后才 `drainInput(1000)`、`stop()` 和 `process.exit(0)`。本地代码行号为 `3220-3240`。本仓库收到该 hook 时执行 `host.shutdown()`，能够将 child state 写成 closed，见 [index.ts:137-139](../../extensions/subagent/src/index.ts#L137-L139)、[runtime-host.ts:102-109](../../extensions/subagent/src/runtime-host.ts#L102-L109)。
- stdout 或 stderr 的 `EIO`、`EPIPE`、`ENOTCONN` 被当成终端已断开错误，进入 `emergencyTerminalExit()`。该函数清理信号监听、调用 `killTrackedDetachedChildren()`，然后直接 `process.exit(129)`，不运行正常 shutdown。错误分类、监听及紧急退出分别见本地 `109-116`、`3322-3332`、`3256-3263`。

因此，Pi 0.85.1 在收到 SIGHUP/SIGTERM 且正常 cleanup 完成时，通常会退出，extension 也可以留下 closed 状态。若在 cleanup 前或期间触发紧急终端退出、Pi 自身被 SIGKILL，或状态写入没有完成，就可能留下 stale 状态，待 list/wait/prompt 等检查后标成 interrupted。正常 cleanup 已完成后再出现终端 EIO，并不会抹去已经写入的 closed。这个时序解释了同一次 tmux server 故障为什么可能产生不同的最终状态。

Pi 自身调用已追踪 detached children 的清理函数，不等于 subagent manager 增加了按 `runtime.pid` 验证或找回 orphan 的能力。实际工具子进程是否全部结束仍需针对真实 Pi 验收，不能由 fixture 或函数调用存在本身作保证。

如果主 Pi 也在同一个 tmux server 内，它可能与 child 同时失去终端并退出。此时必须先重新启动 Pi、恢复原主 session，才能继续使用该 session 的 subagent 工具和原 namespace。新开另一个主 session 不等于恢复原管理关系。父状态在相同 sessionId 再激活时保留 epoch 与 children，见 [runtime-state.ts:39-76](../../extensions/subagent/src/runtime-state.ts#L39-L76)；工具始终以当前 sessionId 定位 namespace，见 [tools.ts:447-451](../../extensions/subagent/src/tools.ts#L447-L451)。

### Unreachable is not necessarily dead

`isAlive` 将 tmux 命令的所有非零退出码统一转成 `false`，不区分无 server、无 pane、连接错误、权限错误或其他命令失败。若底层 `execute` 直接 reject，则异常向上抛出，不走 `false` 降级。见 [tmux-runtime.ts:159-176](../../extensions/subagent/src/tmux-runtime.ts#L159-L176)。

因此，短暂连接问题也可能触发 `markInterrupted`。标记后 `list` 不再检查该终态 child 是否恢复可达，`prompt` 先因状态不是 `running/settled` 拒绝。重新启动 tmux server 本身不会把它改回 `running`。见 [manager.ts:657-663](../../extensions/subagent/src/manager.ts#L657-L663)、[manager.ts:718-726](../../extensions/subagent/src/manager.ts#L718-L726)。

终态并非永久写保护。若原 child 仍活着，后续 `agent_start` 或 `agent_settled` 会无条件把状态写回 `running` 或 `settled`，但这些 hook 不重新定位 tmux，也不会重建失去的 pane。状态回到 `running` 仍不能证明恢复了工具控制能力。见 [lifecycle.ts:3-44](../../extensions/subagent/src/lifecycle.ts#L3-L44)、[index.ts:124-135](../../extensions/subagent/src/index.ts#L124-L135)。

locator 保存了 pane PID，但未保存 server PID、server 启动标识或 socket 路径。PID 相异可以阻止把复用的 pane ID 当成原 child，却没有跨 server 的强身份标识。`capturePane` 只按 pane ID 读取，`close` 是先检查再发 `kill-window`，两条命令之间没有原子身份保护。隔离实验已经观察到 server 重建后 `@0/%0` 重用，旧 locator 因 pane PID 不同返回 false，旧 locator 的 close 没有杀掉新 pane。见 [results.json:75-78](../../.scratch/tmux-recovery/results.json#L75-L78)、[results.json:239-242](../../.scratch/tmux-recovery/results.json#L239-L242)。该结果验证了 PID 不同这一分支，不能证明 server 重建且 PID 也复用，或两条命令之间发生替换时仍然安全。见 [state-store.ts:16-22](../../extensions/subagent/src/state-store.ts#L16-L22)、[tmux-runtime.ts:148-185](../../extensions/subagent/src/tmux-runtime.ts#L148-L185)。

## Tool behavior

### Shared prerequisites

六个工具都要求当前父 Pi 有持久 session 文件。读取、投递、等待和关闭还依赖 direct-child link、child state 和 epoch/ownership 一致。工具没有统一捕获 manager 异常的包装，异常会离开 `execute`，而不是自动转成恢复操作。见 [tools.ts:187-422](../../extensions/subagent/src/tools.ts#L187-L422)、[tools.ts:424-451](../../extensions/subagent/src/tools.ts#L424-L451)、[manager.ts:985-997](../../extensions/subagent/src/manager.ts#L985-L997)。

即使 `subagent_read` 不访问 tmux，它也不是完全不写管理状态的诊断工具。`requireDirectSession` 先执行 reconciliation，可能补登记 child link、移除对应 reservation。见 [manager.ts:985-1035](../../extensions/subagent/src/manager.ts#L985-L1035)。

| 工具 | server 消失后的主要路径 | 错误或降级 | 是否恢复旧 child |
| --- | --- | --- | --- |
| `subagent_list` | reconciliation、清过期 reservation、检查非终态 child locator | locator false 时返回并持久化 `interrupted`；原 `closed/interrupted/errored` 原样返回；`closing` 不检查仍占 active | 否 |
| `subagent_read` | 从 child state 取得原生 JSONL，投影完整记录 | 无 tmux 依赖；文件、格式、树、cursor 或 ownership 错误直接抛出；可能受旧 `leafId` 限制 | 否，只读取持久历史 |
| `subagent_wait` | 先比较 `settledGeneration`，再判断终态与 locator | 新 settled 优先；否则返回 `closed`、`interrupted` 或 `timeout`；`closing` 跳过 locator；只有 settled 附活动 | 否 |
| `subagent_prompt` | 先检查状态，再检查 locator，之后投递并确认 | 已终态报 `Managed child is not running`；locator false 报 `Managed child runtime was interrupted`；投递中断可能报具体 tmux 错误或 `delivery_unconfirmed` | 否，不能以 prompt 重启 |
| `subagent_spawn` | 回收容量后创建新 session 文件，调用 tmux launch | 可以走 `new-session`；注册失败等候至超时；启动/投递失败尝试清理；清理失败可能保留状态与 reservation | 否，成功也是新 child |
| `subagent_close` | 标记 `closing`，停止匹配的 window，确认 locator 不存活，再删关系与状态 | server 不存在且命令返回非零时通常可成功清理；真正 close 错误保留 `closing`；缺 state 或 ownership 错误会阻断 | 否，而且移除后工具访问也结束 |

各行依据依次为 [manager.ts:641-698](../../extensions/subagent/src/manager.ts#L641-L698)、[manager.ts:621-638](../../extensions/subagent/src/manager.ts#L621-L638)、[manager.ts:529-618](../../extensions/subagent/src/manager.ts#L529-L618)、[manager.ts:711-839](../../extensions/subagent/src/manager.ts#L711-L839)、[manager.ts:217-344](../../extensions/subagent/src/manager.ts#L217-L344)、[manager.ts:347-527](../../extensions/subagent/src/manager.ts#L347-L527)。

### Prompt delivery races

投递前发现 locator 不存活，会尝试写 `interrupted` 并拒绝。但 locator 缺失时只报中断错误，不在该分支写状态。见 [manager.ts:718-726](../../extensions/subagent/src/manager.ts#L718-L726)。

通过存活检查后，server 仍可能在 readiness 检查、`load-buffer`、清输入、`paste-buffer` 或提交 Enter 之间退出。这些必需命令的非零退出码变成 `tmux <command> failed: <stderr>`，manager 没有在该异常分支自动标记中断。传输文件会在 `finally` 中删除；已加载的 tmux buffer 只做 best-effort 删除。见 [tmux-runtime.ts:187-234](../../extensions/subagent/src/tmux-runtime.ts#L187-L234)、[tmux-runtime.ts:247-288](../../extensions/subagent/src/tmux-runtime.ts#L247-L288)、[manager.ts:728-742](../../extensions/subagent/src/manager.ts#L728-L742)。

提交后确认同时读 JSONL 和 capture pane，使用 `Promise.allSettled` 忽略单路读取错误。只要 JSONL 有本次 marker 就返回 `confirmation: "session"`；pane 中出现带 marker 的 `Steering:` 或 `Follow-up:` 也算投递成功。这不证明任务已执行。两路始终没有确认时，默认约 1 秒后抛出 `delivery_unconfirmed: Child Pi may already have accepted the prompt`。见 [manager.ts:184-187](../../extensions/subagent/src/manager.ts#L184-L187)、[manager.ts:798-839](../../extensions/subagent/src/manager.ts#L798-L839)。

因此，收到投递错误后不要直接重发带副作用的任务。先核对原生记录和实际产物。初始 spawn 的投递未确认还会进入 spawn cleanup，child 可能已经接受工作，却随后被关闭并删去管理状态。见 [manager.ts:302-344](../../extensions/subagent/src/manager.ts#L302-L344)、[manager.test.ts:82-164](../../extensions/subagent/__tests__/manager.test.ts#L82-L164)。

### Spawn errors and cleanup

注册轮询默认约 10 秒，条件是找到相同 parent session/epoch、registration token、process instance 且带 tmux locator 的 child state。它没有在轮询中检查 pane 是否仍存活，server 退出时可能一直等到 `Timed out waiting for child runtime registration`。见 [manager.ts:1096-1120](../../extensions/subagent/src/manager.ts#L1096-L1120)。

spawn 的 catch 若已拿到 locator，先 close 并 confirmClosed。成功才清掉对应 reservation、direct links 和 child state，原生 session 文件不删；若运行清理失败，提前抛出 `AggregateError`，消息为 `Failed to clean up a failed subagent spawn`，后续状态清理不会执行。此时需要保留现场并重试管理清理，不能假设失败的 spawn 没占名额。见 [manager.ts:308-344](../../extensions/subagent/src/manager.ts#L308-L344)。

### Wait does not prove current liveness

`waitForSettled` 先判断 `settledGeneration > afterSettled.generation`，再判断 `closed`、`interrupted` 和 locator。已持久化一个较新的 settled 后，即使 server 已退出，仍可返回 `outcome: "settled"`。它报告的是已发生事件，不是当前进程健康度。见 [wait.ts:53-91](../../extensions/subagent/src/wait.ts#L53-L91)。

这里还有一个结果与持久状态的差别。即使 state 已是 `closed`、`interrupted` 或 `closing`，只要其 settledGeneration 比传入 cursor 新，wait 仍先返回 settled。manager 随后强制把返回值的 `agent.status` 写成 `settled`，但不将磁盘 state 改成 settled。调用者可能同时观察到 wait 显示 settled，而 list 显示 interrupted 或仍在 closing 占槽。复用同一个过旧 cursor 会再次返回同一个 settled，并非又完成一轮；改用返回的新 cursor 后才进入中断、关闭或超时判断。见 [wait.ts:53-97](../../extensions/subagent/src/wait.ts#L53-L97)、[manager.ts:552-574](../../extensions/subagent/src/manager.ts#L552-L574)。

`closed/interrupted/timeout` 返回空 activity；要抢救中断前的输出，还需单独读取。`closing` 不做存活检查，若无人完成 close，wait 可以每次都 timeout。调用前 child 已被 terminal close 移除时，通常先报 direct-child 错误；已经开始等待后，管理关系和状态被 close 删除，才有转换成 `outcome: "closed"` 的路径。见 [manager.ts:536-584](../../extensions/subagent/src/manager.ts#L536-L584)、[wait.ts:40-49](../../extensions/subagent/src/wait.ts#L40-L49)、[wait.ts:85-101](../../extensions/subagent/src/wait.ts#L85-L101)。

### Read can hide the last persisted activity

`read` 对 `busy: true` 不传 `leafId`，读取器采用文件最后一条完整记录作为分支终点。对 `busy: false` 则优先使用状态中的 `leafId`。host 只在 session start、`agent_settled` 和 `session_tree` 更新 leaf，不逐条跟进生成中的消息。见 [manager.ts:630-637](../../extensions/subagent/src/manager.ts#L630-L637)、[session-reader.ts:397-415](../../extensions/subagent/src/session-reader.ts#L397-L415)、[index.ts:102-135](../../extensions/subagent/src/index.ts#L102-L135)。

该问题已在四组真实 tmux 故障、seeded manager 探针中复现。fixture 的 `leafId` 为 `user-a`，JSONL 已完整写入后续 `assistant-a`；故障前 read 返回 1 条 assistant，wait 标记 interrupted 后 read 返回 0 条，原文件仍含结果。见 [probe.mjs:72-87](../../.scratch/tmux-recovery/probe.mjs#L72-L87)、[probe.mjs:100-114](../../.scratch/tmux-recovery/probe.mjs#L100-L114)、[results.json:3-54](../../.scratch/tmux-recovery/results.json#L3-L54)、[probe.log:1-118](../../.scratch/tmux-recovery/probe.log#L1-L118)。

1. child 的状态保存着较早的 leaf，本轮 `busy: true`，JSONL 已写入一些新的完整 assistant/tool 记录。
2. server 失联，`list`、`wait`、`prompt` 或 spawn 的容量检查调用 `markInterrupted`，把 `busy` 设为 false，保留旧 leaf。
3. 之后 `subagent_read` 只返回旧 leaf 的祖先路径，新写入的记录不出现在活动投影中。提高 limit 或切到 `turns` 不会取消 leaf 约束。
4. cursor 的 position 仍按整个文件的 entries 数量计算，可能已经越过未显示的记录。后续抢救时不能盲目复用这个 cursor。

依据为 [manager.ts:1038-1059](../../extensions/subagent/src/manager.ts#L1038-L1059)、[session-reader.ts:181-214](../../extensions/subagent/src/session-reader.ts#L181-L214)。已有测试只覆盖 `busy: true` 时跨过旧 leaf，以及显式 leaf 仅返回所选分支，没有覆盖清除 busy 后的故障组合。见 [manager-operations.test.ts:170-264](../../extensions/subagent/__tests__/manager-operations.test.ts#L170-L264)、[session-reader.test.ts:571-616](../../extensions/subagent/__tests__/session-reader.test.ts#L571-L616)。

保全原始 JSONL 比先做 `list` 更稳妥。`read` 看不到的记录不一定丢失，可能仍在文件里。真正没完整落盘的尾行会被读取器丢弃；任何完整行 JSON 错误、无完整 header、非 v3 header、错误 agent ID 或树结构异常都可能导致读取失败，读取器没有自动修复文件的路径。见 [session-reader.ts:170-180](../../extensions/subagent/src/session-reader.ts#L170-L180)、[session-reader.ts:357-415](../../extensions/subagent/src/session-reader.ts#L357-L415)。

此外，`subagent_read` 的 UI details 将 agent status 固定写成 `running`，不是健康检查结果。见 [tools.ts:320-324](../../extensions/subagent/src/tools.ts#L320-L324)。

## Capacity and cleanup

### Slots normally become reusable

默认上限为 3，active 按 `processInstanceId` 去重，活着的 `settled` 也占名额。普通 `starting/running/settled` child 的 locator 不再存活时，`list` 会标记中断并不计 active；`spawn` 自己也会做相同的存活计数和中断标记，不强制要求先 close 才能重新创建。见 [manager.ts:187-195](../../extensions/subagent/src/manager.ts#L187-L195)、[manager.ts:641-698](../../extensions/subagent/src/manager.ts#L641-L698)、[manager.ts:841-867](../../extensions/subagent/src/manager.ts#L841-L867)、[manager.ts:920-972](../../extensions/subagent/src/manager.ts#L920-L972)。

这只是管理名额释放。原 child 记录及历史 link 仍保留，操作系统中的真实进程数量可能与 capacity 不一致。`closed/interrupted/errored` 都直接排除，即使某个旧终态 locator 实际还可达。见 [manager.ts:657-663](../../extensions/subagent/src/manager.ts#L657-L663)、[manager.ts:959-971](../../extensions/subagent/src/manager.ts#L959-L971)。

### Closing and pending reservations can retain slots

- `closing` 无条件计 active，`markInterrupted` 也只接受 `starting/running/settled`，不改变 `closing`。需要重试 close，而非反复 list/wait。见 [manager.ts:664-667](../../extensions/subagent/src/manager.ts#L664-L667)、[manager.ts:955-957](../../extensions/subagent/src/manager.ts#L955-L957)、[manager.ts:1038-1050](../../extensions/subagent/src/manager.ts#L1038-L1050)。
- 尚未过期的 reservation，即使 server 消失也继续 pending。默认 TTL 是 `max(30000, registrationTimeoutMs * 2)`；默认注册超时为 10 秒，所以默认 TTL 为 30 秒。TTL 到期不会自行触发清理，需下一次 list/spawn。见 [manager.ts:184-195](../../extensions/subagent/src/manager.ts#L184-L195)、[manager.ts:870-897](../../extensions/subagent/src/manager.ts#L870-L897)。
- 过期 reservation 没有 tmux locator 时直接回收；有 locator 时调用 close 并确认。清理抛错就保留 pending，下次再试。发现已经注册的同 process child 时转为 child link 并移除 reservation，不重复占位。见 [manager.ts:870-897](../../extensions/subagent/src/manager.ts#L870-L897)、[manager.ts:999-1035](../../extensions/subagent/src/manager.ts#L999-L1035)。
- `close("all")` 等待同一 manager 已跟踪的在途 spawn，再处理持久 reservations，最后关闭 direct children。它能不等 TTL 清理 reservation，但也会关闭其他健康 direct children。见 [manager.ts:347-419](../../extensions/subagent/src/manager.ts#L347-L419)。

### Terminal close has limits

对 server 不存在且 tmux 命令返回非零的情况，runtime close 先得到 `isAlive: false`，直接返回；manager 的 confirmClosed 也得到 false，接着移除 link 和 child state。对 `closed/interrupted/errored` 的单个 target，manager 甚至不检查 locator，直接进入管理状态移除；`target: "all"` 才会额外检查这类历史 alias 是否仍指向活 window。见 [tmux-runtime.ts:179-185](../../extensions/subagent/src/tmux-runtime.ts#L179-L185)、[manager.ts:447-459](../../extensions/subagent/src/manager.ts#L447-L459)、[manager.ts:517-526](../../extensions/subagent/src/manager.ts#L517-L526)。

close 失败时保留关系、状态和 slot，将所选 active states 留在 `closing`。confirmClosed 默认最多检查约 5 秒，但这个期限只约束检查循环，不能打断尚未返回的 tmux 命令。所有 tmux 操作都没有向 execute 传入 timeout；`close("all")` 等待的在途 spawn 也没有外层 deadline。见 [manager.ts:184-188](../../extensions/subagent/src/manager.ts#L184-L188)、[manager.ts:361-366](../../extensions/subagent/src/manager.ts#L361-L366)、[manager.ts:491-514](../../extensions/subagent/src/manager.ts#L491-L514)、[manager.ts:975-982](../../extensions/subagent/src/manager.ts#L975-L982)、[tmux-runtime.ts:61-115](../../extensions/subagent/src/tmux-runtime.ts#L61-L115)。

这里的“确认关闭”只确认 locator 不匹配或不可达。代码没有 `process.kill`、进程树遍历、PGID 清理或 `runtime.pid` 存活检查。不能用 close 的成功返回替代残留进程排查。

## Recovery boundaries

| 能力 | 实际实现 | 不包含的能力 |
| --- | --- | --- |
| 自动状态修正 | 工具调用时检查 locator，将普通活跃状态标成 `interrupted` | 没有后台健康巡检、通知或重启 supervisor |
| 管理关系恢复 | 扫描已有 state，把相同父 session/epoch 且有 launch/tmux 的 child 补回 direct links | 不从原生 JSONL 重建缺失的 child state；不从 tmux 枚举猜测归属 |
| 清理 | 移除 reservation/link/extension state，尝试关闭匹配 window | 不删除原生会话，不处理失联 locator 之外的 OS 残留进程 |
| 重新创建 | 新 spawn 新建空原生 session，tmux session 不存在则尝试 `new-session` | 不使用旧 agentId/sessionFile，不重放旧任务或旧消息队列 |
| 原状态再激活 | 已有同 sessionId state 通过 `session_start` 保留 epoch、历史计数和 children，覆盖运行信息 | 需要外部先启动或恢复 Pi；不是公开恢复工具 |
| 原生会话恢复 | 原文件在管理 cleanup 后仍保留，可作为外部恢复或取证输入 | 不保证 tmux pane、未落盘 token、内存队列、在途工具继续运行 |

依据为 [manager.ts:999-1035](../../extensions/subagent/src/manager.ts#L999-L1035)、[manager.ts:217-307](../../extensions/subagent/src/manager.ts#L217-L307)、[state-store.ts:163-167](../../extensions/subagent/src/state-store.ts#L163-L167)、[runtime-state.ts:22-76](../../extensions/subagent/src/runtime-state.ts#L22-L76)。

### New tmux resources are not old sessions

`launch` 先执行 `has-session`。成功就 `new-window`；任何非零退出码都走 `new-session`。`new-session` 失败后只再检查一次是否另一个并发 spawn 已创建 session，若存在再试 `new-window`，否则报 `tmux new-session failed`。如果第一次 `has-session` 成功后 server 才退出，当前调用的 `new-window` 直接失败，没有转入 new-session 的补救分支。见 [tmux-runtime.ts:61-115](../../extensions/subagent/src/tmux-runtime.ts#L61-L115)。

隔离实验中，四组关闭之后直接调用真实 `runtime.launch` 都成功创建了新 server/session/pane，没有在重新 launch 前人工删除专用 socket。见 [probe.mjs:125-143](../../.scratch/tmux-recovery/probe.mjs#L125-L143)、[results.json:75-78](../../.scratch/tmux-recovery/results.json#L75-L78)、[results.json:157-160](../../.scratch/tmux-recovery/results.json#L157-L160)、[results.json:239-242](../../.scratch/tmux-recovery/results.json#L239-L242)、[results.json:321-324](../../.scratch/tmux-recovery/results.json#L321-L324)。tmux 官方 `server_create_socket` 本身会 unlink 目标 socket 路径再创建、bind，见 [server.c](https://raw.githubusercontent.com/tmux/tmux/3.6b/server.c)。

这证明本次 macOS tmux 3.6b 的专用 socket 环境可重新创建，不证明任意权限错误、服务管理器策略或自定义配置都能自动修复。实验调用的是 `runtime.launch`，没有通过 `manager.spawn` 启动真实 Pi 并完成注册和初始投递。extension 没有自己的 socket 修复、`respawn-pane` 或 `respawn-window` 逻辑。

默认 tmux session name 由 stateRoot 的 hash 决定，不是每个父 Pi 独占。传给 tmux 的命令没有明确的 `-L` 或 `-S`；`PI_SUBAGENT_TMUX_PATH` 控制的是可执行文件路径，不是 server identity。见 [index.ts:55-71](../../extensions/subagent/src/index.ts#L55-L71)、[index.ts:217-220](../../extensions/subagent/src/index.ts#L217-L220)、[tmux-runtime.ts:61-115](../../extensions/subagent/src/tmux-runtime.ts#L61-L115)。因此不能把重新创建同名 session 当成恢复旧 window。实际 socket 范围仍需结合进程环境与 tmux 官方规则核验。

### Reactivation is conditional

`activateSession` 能保留旧 state 的 epoch、children、generation 和 settledGeneration，但会清掉旧 pid、processInstanceId、tmux，再用本次启动参数填入。对 managed child，`session_start` 还要求当前 `TMUX_PANE` 和可用的 `locatePane`。没有 pane 时会报 `Managed child could not locate its tmux pane`，tmux 查询失败也会让启动 hook 抛错。见 [runtime-state.ts:39-76](../../extensions/subagent/src/runtime-state.ts#L39-L76)、[index.ts:102-121](../../extensions/subagent/src/index.ts#L102-L121)。

因此，单独重开原生 session 不等于重新纳入父 agent 的管理。若旧 extension state 尚在、却没有原 managed launch 环境，新启动会保留旧 `parent`，但没有新的 tmux locator；父 manager 仍无法投递。若先 close 删了 state，再以普通 Pi 打开原文件，则新 state 没有旧 parent/launch，reconciliation 不会把它找回。需要主代理另外核验手工恢复原生 session 的命令、环境和实际 Pi 版本，本文不提供未经验证的“原位恢复”命令。见 [runtime-state.ts:58-75](../../extensions/subagent/src/runtime-state.ts#L58-L75)、[runtime-host.ts:55-65](../../extensions/subagent/src/runtime-host.ts#L55-L65)、[manager.ts:1009-1015](../../extensions/subagent/src/manager.ts#L1009-L1015)。

## Cases without automatic repair

1. child state 缺失但父 link 仍在。`list` 可以从 link 合成 `interrupted` 并释放名额，但 read/prompt/wait/close 需要真实 child state，会报 `Subagent namespace is not initialized`。`close("all")` 中一个缺失 state 就可阻断整批 close。见 [manager.ts:647-653](../../extensions/subagent/src/manager.ts#L647-L653)、[manager.ts:429-440](../../extensions/subagent/src/manager.ts#L429-L440)、[manager.ts:1090-1094](../../extensions/subagent/src/manager.ts#L1090-L1094)。
2. epoch 或 ownership 不一致、managed child 持有 children。manager 拒绝操作，而非尝试猜测归属或递归清理。见 [manager.ts:999-1017](../../extensions/subagent/src/manager.ts#L999-L1017)、[manager.ts:1062-1087](../../extensions/subagent/src/manager.ts#L1062-L1087)。
3. state JSON 损坏或 schema 不是 2。store 只将 ENOENT 作为缺失，其他错误直接传播；`store.list()` 并行读取全部 session partition，没有逐个隔离坏记录。因此同 stateRoot 中一个坏 partition 也可能阻断其他父会话的 reconciliation 和工具调用。见 [state-store.ts:134-160](../../extensions/subagent/src/state-store.ts#L134-L160)、[state-store.ts:212-228](../../extensions/subagent/src/state-store.ts#L212-L228)。
4. 原生 JSONL 缺失、完整行损坏或未落盘内容。管理 state 并非对话备份，不能重建缺少的消息。见 [state-store.ts:59-83](../../extensions/subagent/src/state-store.ts#L59-L83)、[session-reader.ts:357-395](../../extensions/subagent/src/session-reader.ts#L357-L395)。
5. 真实进程残留而 locator 不再可用。六个工具没有按 PID 找回或停止它的路径。容量可以先释放，新的任务与残留任务可能同时修改工作目录。见 [tmux-runtime.ts:159-185](../../extensions/subagent/src/tmux-runtime.ts#L159-L185)、[manager.ts:953-972](../../extensions/subagent/src/manager.ts#L953-L972)。

状态写入采用临时文件加 rename，不应直接推导普通进程退出必然损坏最终 JSON。另一方面，update queue 只属于单个 `SessionStateStore` 实例，不是父子跨进程锁。父 manager 的中断标记与 child 最后一条 lifecycle 写入可能竞争；源码没有跨进程 CAS 或锁解决覆盖。原子写测试和并发 update 测试不能证明跨进程更新无丢失。见 [state-store.ts:121-123](../../extensions/subagent/src/state-store.ts#L121-L123)、[state-store.ts:169-209](../../extensions/subagent/src/state-store.ts#L169-L209)、[state-store.test.ts:95-123](../../extensions/subagent/__tests__/state-store.test.ts#L95-L123)。

## Safe recovery order

以下是基于现有实现的操作顺序建议，不是本阶段已执行的恢复操作。

1. 暂停新的 spawn 和重复 prompt，先确定故障范围。核对父 Pi 是否还活着、涉及哪个 server/socket、原 child 的 OS 进程和工具子进程是否仍在。若主 Pi 也因同一 server 故障退出，先重新启动 Pi 并恢复原主 session，不以新建 session 代替原 namespace 的恢复。不要对共享 server 使用宽泛的终止命令，也不要凭旧 PID 直接杀进程。
2. 在 `list`、`wait`、`prompt` 改写 child 状态前，保全父/子 extension state、原生 JSONL 路径及必要文件副本。已有 agentId 时可以先 read，但原始 JSONL 更可靠，避免旧 leaf 限制。备份必须遵守工作目录外写入授权要求。
3. 核对原生记录、delivery marker 和任务产物，区分未开始、执行了一部分、已完成但没有确认。中断和 `delivery_unconfirmed` 都不是“没有产生副作用”的证据。
4. 确认没有需要保留的原运行进程，再调用 `subagent_list` 触发普通状态修正与容量回收。若返回 `closing`，不要靠轮询等待名额释放，使用对应 child 的 close 重试。若只有未过期 pending，可等待 TTL 后再次 list；只有在确实要清理整个当前 namespace 时才用 close all。
5. 需要移除旧管理关系时，在结果保全后调用 `subagent_close`。server 不可达情况下成功返回只说明管理清理完成，仍需独立确认残留进程已处理。单个终态 child 的 close 不检查活 locator，尤其不能当作进程清理工具。
6. 确认 tmux 可执行文件、socket 和服务可用后，再 spawn 新 child，明确告诉它哪些工作已完成、哪些操作不能重复。新 spawn 是新会话，不能沿用旧 child 的 cursor；需要等待时使用本次 spawn/prompt 返回的 `settledCursor`。
7. 若必须恢复原生会话上下文，先停止自动清理路径并保全原 state，交由经版本核验的 Pi 原生恢复流程处理。是否重新纳入原父 namespace 是另一个步骤，当前 extension 没有公开工具完成它。若 state 已损坏或缺失，先做离线诊断，不以删除整个 stateRoot 作为首选恢复手段。

这些顺序分别由旧 leaf 风险、非幂等投递、`closing` 容量策略、terminal close 删除边界和新会话创建行为决定。证据见前述相应章节。cursor 绑定 agentId/epoch 的检查见 [cursor.ts:61-85](../../extensions/subagent/src/cursor.ts#L61-L85)、[cursor.ts:133-157](../../extensions/subagent/src/cursor.ts#L133-L157)。

## Existing tests and gaps

| 已有测试 | 能支持的结论 | 不能证明的事项 |
| --- | --- | --- |
| [tmux-runtime.test.ts:162-261](../../extensions/subagent/__tests__/tmux-runtime.test.ts#L162-L261) | 缺 session 走 new-session，并发创建失败后回退 new-window | 真 server 正常退出、SIGKILL、socket 清理和 server 重启 |
| [tmux-runtime.test.ts:310-338](../../extensions/subagent/__tests__/tmux-runtime.test.ts#L310-L338) | locator 身份不匹配时不发 kill-window | OS 进程已死、重建 server 下 PID/ID 复用安全性 |
| [manager-capacity.test.ts:572-637](../../extensions/subagent/__tests__/manager-capacity.test.ts#L572-L637) | 模拟不存活 child 标 interrupted 并释放 active，settled 活进程占位 | 实际 tmux 故障会返回 false 还是抛错 |
| [manager-close.test.ts:438-500](../../extensions/subagent/__tests__/manager-close.test.ts#L438-L500) | close 失败保留关系、closing 与 slot | 随后 server 消失时 closing 重试是否在真实环境成功 |
| [manager-capacity.test.ts:184-226](../../extensions/subagent/__tests__/manager-capacity.test.ts#L184-L226)、[manager-capacity.test.ts:407-570](../../extensions/subagent/__tests__/manager-capacity.test.ts#L407-L570) | reservation 到期回收、close all 处理 pending、失败保留 | server 崩溃发生在 locator 持久化之前的残留窗口 |
| [manager-operations.test.ts:410-545](../../extensions/subagent/__tests__/manager-operations.test.ts#L410-L545) | wait 持久化 interrupted，等待期间被 terminal close 返回 closed | closing 卡住、较新 settled 优先于死进程的真实组合 |
| [runtime-state.test.ts:19-64](../../extensions/subagent/__tests__/runtime-state.test.ts#L19-L64)、[runtime-host.test.ts:16-68](../../extensions/subagent/__tests__/runtime-host.test.ts#L16-L68) | reactivation 保留 epoch，显式 host.shutdown 写 closed | server 退出是否确实触发并完成 hook |
| [session-reader.test.ts:8-84](../../extensions/subagent/__tests__/session-reader.test.ts#L8-L84) | 忽略未换行尾段，保留此前完整活动 | 未写入内存消息恢复、中断标记造成的旧 leaf 隐藏 |
| [integration.test.ts:15-19](../../extensions/subagent/__tests__/integration.test.ts#L15-L19) | 有由 `PI_SUBAGENT_INTEGRATION=1` 开启的真实 Pi/tmux 生命周期测试 | 当前测试没有 server kill 故障注入，不能当作恢复覆盖 |

## Isolated probe results

### Method and limits

主代理报告的环境为 macOS、tmux 3.6b。探针在仓库 `.scratch/tmux-recovery/` 内对四个独立 socket 执行 `-S <socket> -f /dev/null`，并从命令环境删除 `TMUX` 与 `TMUX_PANE`，没有操作默认 server。真实执行对象为 `dist/` 中的 `TmuxRuntime`、`SubagentManager` 和 `SessionStateStore`；manager 的父子状态与原生 JSONL 由探针预先写入。见 [probe.mjs:6-16](../../.scratch/tmux-recovery/probe.mjs#L6-L16)、[probe.mjs:44-94](../../.scratch/tmux-recovery/probe.mjs#L44-L94)。

pane 内是简单 Node fixture，不是真实 Pi。默认 fixture 只写 ready 文件并保持事件循环；另一种安装 SIGHUP handler，记录信号后继续运行。故障注入分别为该 socket 的 `kill-server` 和对探针已记录 server PID 的 SIGKILL。见 [worker.mjs:1-8](../../.scratch/tmux-recovery/worker.mjs#L1-L8)、[probe.mjs:98-105](../../.scratch/tmux-recovery/probe.mjs#L98-L105)。

因此，这里验证的是“真实 tmux 断开后，extension 对预设管理状态的处理”，不是完整 Pi 端到端恢复。没有触发真实 Pi 的 SIGHUP handler、session_shutdown、自注册、模型调用、消息队列或工具执行。`runtime.launch` 成功也不能表述为 `subagent_spawn` 已端到端恢复。

原始结果记录在 [results.json](../../.scratch/tmux-recovery/results.json)，摘要在 [probe.log](../../.scratch/tmux-recovery/probe.log)，运行时间见结果中的 `2026-09-06T03:10:29Z` 至 `03:10:31Z` fixture 时间戳。这些是本地 `.scratch/` 证据，关键观察同时保留在下表，避免只依赖临时文件。

### Shutdown matrix

| 用例 | 故障方式 | fixture 的 SIGHUP 策略 | server 退出后 fixture 仍活 | runtime.isAlive | close 后 fixture 仍活 | 原始记录 |
| --- | --- | --- | --- | --- | --- | --- |
| `term-default` | `kill-server` | 默认，无自定义 handler | 否 | false | 否 | [results.json:3-82](../../.scratch/tmux-recovery/results.json#L3-L82) |
| `kill-default` | SIGKILL server | 默认，无自定义 handler | 否 | false | 否 | [results.json:85-164](../../.scratch/tmux-recovery/results.json#L85-L164) |
| `term-ignore` | `kill-server` | 记录 SIGHUP 后继续运行 | 是 | false | 是 | [results.json:167-246](../../.scratch/tmux-recovery/results.json#L167-L246) |
| `kill-ignore` | SIGKILL server | 记录 SIGHUP 后继续运行 | 是 | false | 是 | [results.json:249-328](../../.scratch/tmux-recovery/results.json#L249-L328) |

四组共有的 manager 观察如下。

- 初始 active 为 1。故障后 wait 返回 `interrupted`，`agent.status` 也是 `interrupted`，activity 为空；随后 list 返回 active 0、pending 0、limit 3、available 3。
- 此时 prompt 抛出 `Managed child is not running: child-a`。这是中断标记之后的状态拒绝分支，本实验没有测未标记前直接 prompt 的错误，也没有测投递过程中断。
- close 返回 closed，并删除 child state、保留原生 session 文件；两组忽略 SIGHUP 的 fixture 在 close 后仍然活着。这直接证明本 extension 的管理清理不等于按 PID 停止一个失联的活进程。

以上结果分别见四行 `results.json` 的 `wait`、`after.capacity`、`promptError`、`stateDeleted`、`nativeFileRetained`、`paneProcessAliveAfterClose`。不能把 Node fixture 的残留率推给真实 Pi。本机 Pi 0.85.1 的信号正常退出和终端紧急退出路径已经另做源码核验，不能将它们与本表的 Node 策略混同；本表确认的是 extension 没有 PID 后备核验与清理。

### State and history observations

旧 leaf 隐藏完整消息已经复现。四组 fixture 均预设 `busy: true`、`generation: 1`、`leafId: "user-a"`，文件里另有完整的 `assistant-a`。故障前 read 返回该 assistant；wait 标中断后 read 返回空，但 `fileStillContainsResult: true`。这是读取投影隐藏，不是文件内容被删除。见 [probe.mjs:72-114](../../.scratch/tmux-recovery/probe.mjs#L72-L114)、[probe.log:17-18](../../.scratch/tmux-recovery/probe.log#L17-L18)、[probe.log:75-76](../../.scratch/tmux-recovery/probe.log#L75-L76)。

closing 占槽与 wait timeout 已复现。失联后把同一 child seed 成 `closing`，四组 list 都返回 active 1，wait 都 timeout。随后把它改成 `interrupted` 且 `settledGeneration: 1`，用 generation 0 的 baseline 等待，四组都返回 settled。见 [probe.mjs:116-124](../../.scratch/tmux-recovery/probe.mjs#L116-L124)、[results.json:52-54](../../.scratch/tmux-recovery/results.json#L52-L54)、[results.json:216-218](../../.scratch/tmux-recovery/results.json#L216-L218)。

需要保留一个覆盖边界。脚本是在上述 settled 探针之后才 close，此时磁盘状态已被 seed 成 interrupted，不是直接从 closing 重试 close。因此现有记录证明“closing 会占槽”和“终态清理可成功”，尚未单独实测“closing 直接 close 重试成功”。后者由 [manager.ts:447-526](../../extensions/subagent/src/manager.ts#L447-L526) 与 [tmux-runtime.ts:179-185](../../extensions/subagent/src/tmux-runtime.ts#L179-L185) 的源码路径支持。脚本也没有执行满容量下的 manager.spawn，不能把源码中的 capacity 拒绝分支写成已实测。

### Re-creation and stale locators

四组都在原 server 退出后成功 `runtime.launch` 新 fixture。新旧 window/pane ID 均重用 `@0/%0`，但旧 locator 返回 false，旧 locator 的 runtime.close 没有杀掉新 pane。新 pane 随后用自己的 locator 关闭。见 [probe.mjs:130-148](../../.scratch/tmux-recovery/probe.mjs#L130-L148)、[results.json:75-78](../../.scratch/tmux-recovery/results.json#L75-L78)、[results.json:157-160](../../.scratch/tmux-recovery/results.json#L157-L160)、[results.json:239-242](../../.scratch/tmux-recovery/results.json#L239-L242)、[results.json:321-324](../../.scratch/tmux-recovery/results.json#L321-L324)。

这验证了 pane PID 校验在本次 ID 重用场景下有效，不是 PID 也复用或检查与操作之间发生竞争时的安全证明，也不是原 pane 被恢复。新 fixture 是新进程。

### Cleanup evidence

探针记录自己的 server 和 pane PID，结束时对这些 PID 执行清理，并等待它们都不再是存活的非 zombie 进程。随后检查专用 socket 已不可用并删除 socket 路径。四组结果均为 `cleanup.livePids: []`、`socketUnavailable: true`。见 [probe.mjs:27-35](../../.scratch/tmux-recovery/probe.mjs#L27-L35)、[probe.mjs:149-160](../../.scratch/tmux-recovery/probe.mjs#L149-L160)、[results.json:79-82](../../.scratch/tmux-recovery/results.json#L79-L82)、[results.json:161-164](../../.scratch/tmux-recovery/results.json#L161-L164)、[results.json:243-246](../../.scratch/tmux-recovery/results.json#L243-L246)、[results.json:325-328](../../.scratch/tmux-recovery/results.json#L325-L328)。主代理另用 lsof 核验专用 socket 没有监听者。本研究者只读取这些清理证据，没有再次发送进程信号。

## Remaining validation

- 真实 Pi 在实际故障中的 SIGHUP、终端错误与 session_shutdown 时序，以及工具子进程是否残留。0.85.1 的处理代码已核验，真实 Pi 端到端故障实验尚未执行；0.84.3 或其他版本也不能直接套用 0.85.1 结论。
- 真实 `manager.spawn` 在 server 故障后的自注册与初始任务确认，当前只测了 runtime.launch。
- 直接从 closing 状态重试 close；满容量情况下 closing 是否阻止 spawn。源码路径已明确，当前隔离脚本没有单独运行这两项。
- prompt 投递各阶段发生故障时的明确失败、已入队、已落盘与未确认边界，及重复投递风险。
- 自定义 tmux 配置、服务管理器 stop/restart 策略、socket 权限异常、PID 重用和身份检查竞争。
- 父会话原生恢复、child 原生恢复与重新纳入原父 namespace，须分别验收；当前没有公开恢复工具。

后续补证应保留上述实验边界，不把替身结果扩写成真实 Pi 的行为保证。
