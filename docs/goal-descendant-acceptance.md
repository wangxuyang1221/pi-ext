# Goal direct child acceptance

## Current accounting boundary

本文件下方保存 #8 历史验收。当前行为以 [Goal provider support](goal-provider-support.md) 为准，跨 provider 新验证见 [#19 整体审计](https://github.com/wangxuyang1221/pi-ext/blob/adventure/goal-all-providers/adventure/evidence/slice-3-spec-audit.md)。计量仅包含已观察且归属明确的根、Pi 压缩/摘要和受管直接子代理，不包括孙代理或任意工具内部调用。

## Status

[Implementation level #8](https://github.com/wangxuyang1221/adventure/issues/8) 已完成工作区实现及当前稳定基准验证，协调者独立验收通过并关闭。[验收检查点](https://github.com/wangxuyang1221/adventure/issues/8#issuecomment-5605128058) 包含40文件指纹。协调者另跑完整检查905通过、2默认跳过，日志 `.scratch/goal-8-coordinator-check.log`。正文写权已交回协调者。没有提交、推送或部署。[完整证据评论](https://github.com/wangxuyang1221/adventure/issues/8#issuecomment-5605066251) 已追加，正文已更新并 GET 核对，之后由协调者验收关闭。

基准为 `3972c9e1b6693021fd79d99a0acb19fb62f0260d` 加保留未提交 goal #4 至 #8。用户已确认另一会话完成 subagent 修复并本地提交，旧未知写者阻塞解除。C13 保留单层 root → direct child，取消孙代理及中间父退出验收；没有扩展嵌套、容量、权限或 direct-only 关闭语义。C1 至 C12 及既有预算设定不变。

## Integration review

完整读取 HEAD 的 subagent 源码 diff、原 handoff 与 `own-code.patch`。当前 goal 的 index/storage/scheduler/children 哈希与停点一致，未被他方改丢。未用旧快照覆盖最新源码。

- 已提交修复负责 delivery receipt、generation wait、leafPosition/leafPinned 活动读取、reservation 竞态和终态 runtime 关闭。本关没有重复实现或回退这些修复。
- `manager.beforePrompt` 仍位于直接归属与投递基线检查之后、真实 sendPrompt 之前。它只等待根 goal 登记报告归属，不改变投递游标和容量规则。
- managed child 的 usage hooks 先于 host 的 settled hook 注册。报告持久化后 host 才发布 settled；已提交的 user message_start receipt hook 与 assistant usage hook 分别处理对应消息。
- 新真实 tmux 夹具验证初始任务在 provider gate 未释放时 `subagent_wait` 为 timeout，释放后同一 settledCursor 为 settled，原生会话确有 subagent_delivery entry。重复活动读取不增加根用量；显式 close 删除受管状态和 pane，报告仍可用于根检查点与 reload。

## Implementation

- `extensions/subagent/src/usage.ts`：在受管 child 中捕获请求归属，上报 Pi 归一化 `input + output + cacheWrite` 累计值，排除 cacheRead，reasoning 不重复相加；response receipt 去重，报告临时文件 sync 后 rename。assignment 只有 opaque sourceId，报告只有 sourceId/tokens/missing/lastReceipt，不含根 objective、goal 凭据或 provider 密钥。settled/shutdown 重试已观察但暂未写盘的报告。
- `extensions/subagent/src/index.ts` 与 `manager.ts`：投递前经共享 event bus 向同一父 session 的根 goal 申请归属，明确 await 其持久化 Promise；没有 owner 时清除旧 assignment。在途响应使用已捕获归属，不转嫁给替换后的目标。
- `extensions/goal/src/children.ts`：只读取明确登记的报告文件，使用有界读取和 O_NOFOLLOW；fs.watch 唤醒归集，不扫描无归属会话，不新增轮询 goal 回合。get、命令、context、完成观察、settled 和 shutdown 做检查点，关闭 watcher 与 bus listener。
- `extensions/goal/src/storage.ts`：独立 childUsage 检查点与根累计原子提交；root 与多个直接 child 的累计写可跨纯 revision 交错，但不放松 owner/record/goal/generation 隔离。继承复制累计值但删除活动子代理订阅；旧 goal 迟到报告不能污染新 goal。同目标 paused、blocked、usage_limited、complete 或预算收尾结束后，晚到 child 报告只推进来源检查点，不再追加目标用量。恢复前刷新基线，恢复后只计后续报告增量，不追补冻结期间已观察到的用量；无法按实际发生时间拆分尚未报告的消耗。
- `extensions/goal/src/scheduler.ts`：根已结束并排队续跑后，晚到 child 达预算不再新发收尾回合。仍在运行的根回合仅收尾一次，不因预算强杀模型或子代理。
- managed child 默认 goal 入口不注册独立工具或循环。

## TDD and fixture correction

上一轮行为实现的 Red/Green 日志保留在 `.scratch/goal-8-red-*.log`、对应 green 日志。本关覆盖独立 source 累计、并发检查点、继承隔离、旧目标拒绝、投递前归属、报告重放和写盘重试、fresh context 完成观察、根收尾队列取消。没有削弱既有统计断言。

恢复轮发现受管夹具的验证缺陷，已修正并重跑：

1. 原 IPC 及首版 tmux observer 调用 `subagent_close` 时错传 `agentId`，实际 schema 要求 `target`。Pi 把 observer 内异常转成 isError toolResult，旧外层未检查，因而旧日志不能证明显式 close 成功。
2. 先加外层断言，拒绝任何 isError toolResult。`.scratch/goal-8-red-{ipc,tmux}-observer.log` 均退出1，错误明确为 direct child undefined。
3. 修正参数，不改生产 subagent 或降低断言。green 两种夹具通过，随后双版本全部受管场景使用修正后的外层断言重新运行。close 后状态/pane 消失与报告保留均实际执行。
4. 旧 checkpoint IPC、stable-ipc 及第一批 tmux 结果保留调查用途，不再列为最终验收证据。尤其不能沿用旧879绿结果。

## Runtime matrix

实际版本为 Node.js 22.22.2、pnpm 11.9.0、tmux 3.6b、Pi 0.84.3 与 0.85.1。两端实际安装的原生 Codex adapter 解析离线构造的 SSE，不调用付费模型。每次启动只使用仓库本地 HOME、agent dir、native session 和独立 tmux socket，不写全局或真实用户 session。

### Real tmux transport

入口 `extensions/goal/__tests__/child-tmux-runtime.mjs`，child CLI 扩展 `child-tmux-fixture.mjs`。根为实际 Pi SDK 绑定 TUI mode，子为实际 CLI InteractiveMode 运行于真实 tmux pane。transport 使用仓库 TmuxRuntime 的 new-session/window、buffer、paste、send-keys、capture、liveness、kill-window 路径，不注入 IPC 或伪造 locator。根端不是 tmux 中的完整 CLI，根 TUI 输入行为另由下面原生 PTY 矩阵覆盖。

最终目录 `.scratch/goal-8-final-tmux-v2-{0843,0851}-{budget,late,duplicate,pending}/`，共8个场景，每目录有 results.json、child-started/settled、pane.txt、diagnostics.json、pids.json、cleanup.json。cleanup 同时保存实际 tmux commandLog。

| Scenario | Verified result |
| --- | --- |
| budget | 根30 + child100 =130，预算100；一次收尾、四次根请求。达到预算后 child 仍存活，只在测试显式关闭时结束。根 reload 不重复收费。 |
| duplicate | child 两次原生 adapter 响应使用相同 responseId，只记100不记200；根仍130，其他断言同 budget。 |
| late | child 请求已开始后替换根 goal；确认旧报告文件实际存在且累计100，不进入新目标，新目标最终10，保持独立身份和检查点。 |
| pending | 根已结束并由 scheduler 排队自有续跑，然后释放 child 报告。根最终120、budget_limited、只有两次模型请求；失效续跑被取消，没有新预算收尾或下一自动循环。 |

所有场景检查子端没有 get_goal/subagent_spawn 工具，root/child networkAttempts=0；实际 receipt wait 从 timeout 到 settled，活动两次读取相同，close 后受管状态和 pane 消失。非 late 场景检查报告与根 source checkpoint 均为100，关闭后的报告仍存在。

复现示例：

```sh
GOAL_CHILD_SCENARIO=pending GOAL_CHILD_EVIDENCE=.scratch/goal-8-recheck-pending \
  pnpm exec node extensions/goal/__tests__/child-tmux-runtime.mjs node_modules/@earendil-works/pi-coding-agent
```

0.85.1 的 package 参数使用宿主安装路径，不换 repo 开发依赖。证据根目录必须全新，不能重用旧 gate 文件。

### IPC and regressions

- `.scratch/goal-8-final-ipc-{0843,0851}-{budget,late,duplicate}/`：修正外层断言后的真实 SDK OS 子进程6场景，IPC transport 只作为补充，不冒充 tmux。
- `.scratch/goal-8-stable-{runtime,lifecycle-runtime,processes,execution-runtime}-{0843,0851}.log`：#4/#5/#6 的双版本 SDK/进程回归通过。
- `.scratch/goal-8-stable-budget-{0843,0851}/`：#7 原生 adapter 映射与 SDK 每版11场景通过，保留非缓存输入/输出、基线、去重、缺失 usage、超额收尾及错误状态断言。
- `.scratch/goal-8-stable-tui-{0843,0851}-*/`：#6 每版14个实际 InteractiveMode PTY 场景通过，含 C11 失效自有请求取消及用户文字找回、C12 retry等待Esc、真实运行中断/pause、弹窗取消、user steer/follow-up、其他扩展输入、压缩成功/失败/取消/手动恢复。
- `.scratch/goal-8-stable-budget-tui-{0843,0851}-{soft,baseline,quota,interrupt}/`：#7 每版4个真实 TUI 场景通过，全部新运行，本恢复轮无外层超时。
- `PI_SUBAGENT_ISOLATED_INTEGRATION=1 pnpm exec vitest run extensions/subagent/__tests__/isolated-integration.test.ts` 通过，日志 `.scratch/goal-8-stable-subagent-integration.log`。这是已提交修复的原生 Pi/tmux 回归，未修改其断言。
- `pnpm run check` 通过，`.scratch/goal-8-stable-final-check.log`：76文件通过、2跳过，905测试通过、2跳过，类型/构建/7扩展发布包校验通过。默认跳过在线集成与独立开关的 isolated integration；后者已按上条显式运行通过。905包含用户已提交修复的新测试，不把它们计成本关新增产出。
- `git diff --check` 通过，`.scratch/goal-8-stable-diff-check.log`。dist 只由构建产生，没有手改。

## Source verification

固定0.84.3的 extensions.md、sdk.md、session-format.md及 event-bus/SDK示例已在本任务完整读取，并与0.85.1核对。本恢复轮另完整读取固定 custom-provider.md，与宿主全文差异仅为 API 源码链接改名。Context7 `/earendil-works/pi` 返回 main，不提供所需 pinned 文档，故不据此声称版本覆盖；实际两版本 loader.js 的 registerProvider(native Provider) 分支、已安装 event-bus.js/runner 及双版本运行作依据。

来源入口：[Pi repository](https://github.com/earendil-works/pi)、[C13确认](https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5603155660)、[#3规格](https://github.com/wangxuyang1221/adventure/issues/3)。离线 provider 仅在测试夹具注册，不向生产 goal 添加 provider wrapper。

## Checkpoint and cleanup

`.scratch/goal-8-final-checkpoint/manifest.json` 保存基准和40个源码/测试文件 SHA-256，同目录有当前文件副本、tracked.patch 和 status.txt。该快照用于核验，不授权覆盖共享工作区。旧 own-code.patch 保留为归属历史；恢复轮只新增真实 tmux 夹具并修正 IPC 测试，不改变已保留的生产 goal 实现。

```text
572442b31b3e79b2d38a6026d4fcb5f1648a9a7c3021ec5fd6eb6688763d9601  extensions/goal/src/index.ts
2484fd350f4f541bf9bf8a03fb3e8ae62ec61fec4542325be9f5b726c3f2445b  extensions/goal/src/storage.ts
5318cd7d02e8a94266a1a26c9b0fe6df59ce8815a36cd4abce52f2a8796f28c3  extensions/goal/src/scheduler.ts
31d135e34c2bb916fd50c3d4f5d9d4a5d94245238ebfc4cf117b2a3ceb083f73  extensions/goal/src/children.ts
57f12b0a11359535d54fd7d3255e2d84b5045f739a5807a0b00781eb7fd35063  extensions/subagent/src/index.ts
ec2ca6ebf6c2f02d5fe1fc6b404e71526e2845ebe79a8a40d6fe3c996b4dd5f2  extensions/subagent/src/manager.ts
f4ef6e6e57e2db1f771eec721f0c1a672357e6dbaa7f7c38c5801e56eb3e32ca  extensions/subagent/src/usage.ts
1c32b7baf8848ac33df5b683110ecfab7d830c37e25a851fe5121725b46c9230  extensions/goal/__tests__/child-tmux-runtime.mjs
```

`.scratch/goal-8-stable-cleanup.json` 核验恢复轮102个有记录的测试/受管/tmux PID 全部退出，无对应 TCP listener，26个记录的隔离 tmux socket 均不可用。进程表无本轮遗留 runtime/TUI/vitest/tsc 测试。未停止其他会话或用户进程。

## Limits and next step

C13 明确不覆盖孙代理、嵌套或第三方代理。没有因预算强杀进程，不测试付费在线模型、系统断电零丢失。报告数随投递任务增长，去重集合随响应数增长；根检查点成本随明确登记 source 数增长。重复读取不增加 token，未设置虚构的吞吐或无限历史常数内存保证。

持续磁盘故障、provider usage 到达前强杀等情况不能保证零丢失，缺失可见 usage 只报告不完整，不填造精确值。附件和全仓最终集成属于 #9/#10。

#8 已验收并同步 #1/#3。按用户要求保存后关闭全部 subagent 并停止，重启 Pi 后从 #9 继续，再执行 #10 整体验收。不要引用已作废的夹具成功日志代替上述 final 证据。
