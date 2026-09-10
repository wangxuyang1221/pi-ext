# Goal direct child accounting handoff

## Historical record

本文件保存停写时的历史交接，不代表当前仍阻塞。用户后来确认另一会话完成修复并提交 `3972c9e`，已授权恢复。当前待验收结果见 [acceptance](goal-descendant-acceptance.md)。其中同时更正本文件旧 IPC 成功记录的证据缺陷：observer 工具异常曾被 Pi 转为 isError 而未被外层断言检查；最终关闭验收只采用修正后重新运行的 final 目录。

## Handoff Position

类型：`return`

定位：本文档正在把另一个会话的结论带回源会话。

## Current Goal or Problem

[Implementation level #8](https://github.com/wangxuyang1221/adventure/issues/8) 已按 C13 实施直接子代理归集，但目前不是待验收完成状态。协调者要求因共享源码出现未知写者而停止，当前为集成阻塞，等待协调者和用户确认共享协作状态。已停止源码写入和测试，不回退外部改动。#8 正文写权交回协调者，保持 OPEN。

## Evolution

1. 初轮发现 subagent 明确禁止嵌套，保存拓扑冲突报告。用户随后选择 C13，保留单层，只归集主代理和直接子代理，取消孙代理及中间父退出验收。旧阻塞已解除，不应再询问该决定。
2. 本轮按 TDD 增加子代理累计报告、根订阅和检查点、预算收尾及旧目标隔离。双版本 SDK 受管 OS 子进程夹具与 #4 至 #7 回归已运行，结果见下文，不能替代当前共享基准的独立验收。
3. 本轮后段发现非本 worker 改动。协调者明确表示自己未修改 subagent 源码，#6/#7 已 settled，并要求停止、保存归属证据。已遵从，不继续盲目重跑。

## Agreed Decisions and Constraints

- [规格 #3](https://github.com/wangxuyang1221/adventure/issues/3) 与 [C13 确认](https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5603155660) 为当前范围。保留 root → direct child、managed child 无编排工具、既有容量/权限/direct-only 关闭语义；本 worker 不实现嵌套，不做第三方代理适配。
- C11 仅允许取消未发失效自有 goal 续跑时使用原生 abort 清队列，用户文字须可找回；C12 仅将原生 retry 等待 Esc 归 blocked。运行中真中断和 pause 仍 paused，取消弹窗不误 pause。
- 不改 Pi 核心、不包装生产 provider、不重建 editor、不调用付费模型、不写全局配置或真实用户 session。不提交、推送、部署或关闭 Issue。
- 基准 `f4a7e44b43070748f082523b7377b165c9471e9e` 加已验收未提交 #4 至 #7。全部已有研究、原型和外部变化保留。

## Established Facts and Required Context

### Ownership evidence

这不是把任务开始前的已知改动误判为外部写入。首次读取的 manager/index SHA-256 已保存在旧报告和 #8 首轮评论。它们与 HEAD 对应文件完全一致。本轮只在 manager 增加 beforePrompt 可选回调、在 index 接入报告协作；当前文件另有不属于这些 edits 的变更。

导出脚本 `.scratch/goal-8-handoff/export.py` 用首次基线加本 worker 的精确 edits 重建 own-only 文件，再与当前文件比较。它还从当前 goal 源码反解本 worker edits，验证所得 index/storage/scheduler 的哈希逐个等于 #7 验收检查点，验证成功。

| File | First SHA-256 | Own-only SHA-256 | Captured current SHA-256 |
| --- | --- | --- | --- |
| subagent/src/manager.ts | `37ebd8fca4016154820a395e06a6d6ec3af36a10d2b712f828bc2757ec0572ef` | `e825d7a59725f3fdc6a5272e6851f82f821c1363e8bb09fe0a8541e280c48e38` | `a2c4263d5788879c5566893f4819e951aa40e3febe1deddb22c6b5805dc7600e` |
| subagent/src/index.ts | `916d425b896401aab15603ad0a16b21ece12448c437634192e83eb5cd08eb448` | `64992b5e490ac150bd187c6d0bca8d56dbcc0e3f66c5c371f415ada48d0e547d` | `7c07f5527b82a43267bac67fb8c469ff906a203d717457430bd61b111743858e` |

表中路径均位于 `extensions/`。具体重叠包括 manager 的 reservation 回收/匹配、attachReservationLocator 参数、关闭非 active runtime、旧 leaf 读取与 deliveryId settled cursor；index 新增 delivery receipt hook；index.test 新增 appendEntry 和 receipt 断言。非重叠但同轮新增修改还包括 cursor.ts、wait.ts、runtime-host.ts、session-reader.ts、delivery-receipt.ts，以及 manager-races/session-reader-performance 测试。这些都不是本 worker 的实现动作。

停写后再次只读复核仍有变化：第一次快照文件时间为 `2026-09-09 22:49:47`，第二次快照为 `2026-09-09 22:56:18`（本地文件时间）。manager 最新 SHA-256 为 `a82b898d2571b4bb6e3b9bdbde45a4a078451f375ef8af9a35e8bd01b84f7437`，index 为 `57f12b0a11359535d54fd7d3255e2d84b5045f739a5807a0b00781eb7fd35063`。新增差异是 manager 引入 readLeafOptions 与 leafPosition/leafPinned，index 将 session entries.length 传入 start/leafChanged。这些不属于本 worker，进一步排除仅误读初始已有变动的解释。第二份快照在 `.scratch/goal-8-handoff/latest/`，增量为 `post-stop-manager.patch`、`post-stop-index.patch`，原归档没有覆盖。不能保证此后文件停止变化。

恢复入口：

- `.scratch/goal-8-handoff/own-code.patch`：只包含 #8 自有代码与测试。不是当前整个仓库 diff。
- `.scratch/goal-8-handoff/external-code.patch`：相对 own-only 的外部代码差异，包含以上重叠位置。
- `.scratch/goal-8-handoff/manifest.json`：每文件初始、重建基线、own-only、当前哈希及外部变化标记。
- `.scratch/goal-8-handoff/{before,own-only,current}/`：上述三个可恢复源码快照。不要直接覆盖工作区，先协调归属。
- `.scratch/goal-8-handoff/worktree-tracked.patch` 和 `status.txt`：停点时整个 tracked diff 和工作区列表，仅作归档，不宣称全部属于 #8。
- 本 worker 文档改动为 `docs/goal-descendant-todo.md`、本报告、旧报告当前状态，以及 README 的 Goal extension 段落。README 其他段落中的外部改动没有归入本关。

### Implemented design

- `extensions/subagent/src/usage.ts`：仅受管 child 安装上报 hooks。投递前 assignment 只保存 opaque sourceId；每次请求捕获归属，final message 按已归一化 input+output 累计，response receipt 去重。同目录临时文件 sync 后 rename 发布固定大小报告。settled/shutdown 重试内存中未提交报告。报告不含目标正文、根 goal 凭据或 provider 密钥。
- subagent 的 `beforePrompt` 位于已验证直接归属和 native session baseline 之后、实际投递之前。共享 event bus 同步收集 owner 返回的 Promise，manager 明确 await。没有 goal 时清除旧 assignment；已有在途请求仍保留原捕获 source。
- `extensions/goal/src/children.ts`：投递前持久登记 source/reportPath；只读已登记报告，fs.watch 唤醒归集，不扫描无归属 session，不添加轮询 goal 循环。get、context、命令和完成观察有显式检查点。关闭 watcher 和 bus listener，恢复时重建。替换目标删除当前订阅，晚到旧报告不计入新目标。
- storage 增加独立 childUsage 列表，不覆盖主代理 usageCheckpoint。累计值与每 source checkpoint 一次原子提交，允许同身份累计写与纯检查点跨 revision 合并，仍拒绝 owner/goal/generation 不匹配。显式继承复制总数但移除活动子代理订阅。
- scheduler 防止根已经结束且续跑尚在队列时，晚到子代理预算再制造新收尾请求。当前仍在运行的回合保留一次软收尾，不杀子进程。managed child 的默认 goal 扩展入口不注册独立 goal 工具或循环。

### Sources and runtime evidence

固定开发版本 0.84.3 的 extensions.md、sdk.md、session-format.md 已完整读取，event-bus 和 SDK extension 示例已读取。0.85.1 同名文档用完整差异核对；session-format/event-bus 示例及 event-bus.js 与 0.84.3 相同。Context7 `/earendil-works/pi` 只覆盖 main，不能作为固定版证据。实际 event-bus.js 同步调用 safeHandler，handler 在首次 await 前同步运行，因此显式 Promise 收集可用；runner 的 ctx.model/isIdle 是动态读取，长期事件订阅使用启动 context 不冻结模型状态。

已运行的记录，均早于本次停止指令，不意味着当前未知写者基准已验收：

- `.scratch/goal-8-red-*.log` / `green-*.log`：独立 source 累计、继承不复制订阅、并发 checkpoint、投递前归属、受管 hooks、根归集、fresh context、监听清理、预算排队交错、无独立 child goal、创建前基线、报告写盘重试。每项先出现对应 Red 后实现 Green；额外已满足的边界直接记录通过，没有削弱现有统计断言。
- `.scratch/goal-8-checkpoint-{0843,0851}-{budget,late,duplicate}/`：每版三个真实 Pi SDK 受管 OS 子进程场景。budget/duplicate 根 130，其中 child 100；重复 provider responseId 不变200；只一次收尾，四次根请求；子进程关闭后报告保留，root reload 后不重复计费。late 在子进程请求已启动后替换根目标，旧 child 100 不进入新目标，新目标10。均附 results、diagnostics、child记录与 cleanup。
- 该受管夹具使用本仓库实际 subagent extension、manager、host 和存储，两端均真实 Pi SDK，transport 注入 IPC，locator 为夹具元数据。它不是完整 tmux CLI 端到端验收，不能冒充已验证真实 tmux 窗口操作。未调用真实付费模型，原生 Codex adapter 解析离线 SSE；networkAttempts=0。
- `.scratch/goal-8-checkpoint-budget-{0843,0851}/`：#7 SDK 每版11场景；同前缀 runtime/lifecycle-runtime/processes/execution-runtime 的 `.log`：#4/#5/#6 双版本回归通过。
- `.scratch/goal-8-tui-{0843,0851}-*/`：#6 每版14个原生 InteractiveMode PTY 场景通过，含 C11/C12、运行中输入、取消弹窗和压缩。
- #7 TUI 每版4场景最终通过。0843 soft/baseline 在 `.scratch/goal-8-budget-tui-0843-*`，0843 quota/interrupt 与0851 soft/baseline 在 `goal-8-budget-tui-retry-*`，0851 quota/interrupt 在 `goal-8-budget-tui-final-*`。两次外层串行命令超时，遗留 quota 尝试缺 result，不计为通过；单独重跑通过。尚未确认外层超时原因，保留原日志，不修改断言规避。
- `.scratch/goal-8-final-check.log` 当时完整 check 通过：879通过、1既有在线集成跳过，类型/构建/发布包通过。此前 #7 基线866，本关新增7测试；另外6测试来自外部改动，不计为本关产出。停点 `git diff --check` 通过。
- `.scratch/goal-8-cleanup.json`：本轮60个有记录的 PTY/受管 PID 全部退出，无这些进程的监听端口。SDK/processes 命令已退出，无本轮测试后台进程。没有停止协调者或未知写者的进程。

### Remaining verification limits

发布包构建修改了 dist 生成文件，没有手改 dist。当前混合源码尚不能接受为 #8 稳定检查点，不能依据旧绿日志关闭本关。性能成本为根按登记 source 数读取，子端每次 final 写固定大小累计文件，去重集合随响应数增长，报告文件随任务数增长。未做报告自动回收或无限历史常数内存承诺。持续子进程磁盘故障或收到 usage 前强杀无法保证零丢失，也未验证断电零丢失。

## Current Assumptions

已证实有本轮期间非本 worker 的源码变化，但不知道写者身份，也未证明其已经停止。不能从一次 check 通过推断基准稳定。归属恢复脚本对 goal 三个主要文件成功复原 #7 精确哈希；对未有独立首次哈希的测试文件，基线按本 worker edit 反解，需协调者检查 patch 后采用。

## Continuation Point

先由协调者和用户确认共享写者及代码归属，批准恢复后再读当时最新文件。不要回退外部变化，也不要直接套用归档 patch 覆盖现工作区。C13 已确认，无须重问拓扑。

基准稳定后，审查 own-code.patch 与 external-code.patch 的交点，核验 beforePrompt、delivery receipt、agent_settled 和关闭行为能否共同成立，再重跑相关双版本受管场景及必要 #6/#7 回归，最后 pnpm run check、diff check 和进程清理。确认受管 IPC 夹具是否足够本关验收，完整 tmux 集成若要求最晚在 #8 完成，应补真实 transport 验证，不能默认为已覆盖。完成后追加 #8 证据评论、读最新正文更新并 GET 核对，再由协调者独立验收。
