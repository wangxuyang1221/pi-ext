# Pi 0.99.1 review fixes validation

## Status

用户已授权执行 [review fixes todo](pi-0.99.1-review-fixes-todo.md)。本轮完成凭据允许名单、macOS 普通测试进程组清理、真实 Write 执行验收及 Goal/tmux 故障调查。整份清单尚未通过，生产 `src/` 没有修改。

当前 `pnpm run check` 为 `2640 passed / 2 failed / 13 skipped`。新增 Write 用例证明原计划对宿主校验的假设不成立：Pi 0.99.1 会把 `null` 和数字转为字符串后执行写入。两个拒绝断言保留为失败，未改期望或跳过。另有 Goal follow-up、tmux 空锁及本轮新观察到的 Fast transcript 顺序断言失败。

本机为 macOS，Node `v22.22.2`、pnpm `11.9.0`。仓库 Pi AI、Coding Agent、Agent Core、TUI 均为 `0.99.1`。Linux 和 Windows 未实际运行；CI 配置不能替代执行证据。以下相对日志路径位于 `.scratch/pi-0.99.1-fixes/`，不纳入发布包。本文件保留关键结果，不要求读者依赖本机日志。

## Test fixes follow-up

用户随后授权修复 Fast/Goal 测试，结果见 [test fixes validation](pi-0.99.1-test-fixes-validation.md)。Fast 正式完整用例连续三次通过；Goal 按 TUI C11 和默认 SDK 队列语义拆分后，provider runner 的 26 个场景通过，`host:accounting:check` 整组通过。SDK 取消后不自动执行排队输入的兼容性差异仍保留，不宣称生产行为已恢复。

当前主检查为 `2639 passed / 3 failed / 13 skipped`，两次结果相同：两个 Write 拒绝预期，以及 wrapper 清理 HOME 的断言。wrapper 单独八个用例通过，完整套件失败尚未定位。没有修改生产逻辑，tmux 按用户要求暂不处理。下面内容保留此前各轮的历史证据。

## Test investigation follow-up

用户要求暂不处理 tmux，重新核验 Goal 和 Fast 是否为测试问题。本轮只新增调研报告和仓库内临时探针，没有修改正式测试或生产实现。

- [Fast 调研](pi-0.99.1-fast-test-research.md) 已证实原顺序断言读得太早。未改 HTTP 响应的探针连续三次发现 Fast entry 已落盘、assistant 尚不存在；真正落盘后顺序正确。只在临时副本增加等待，完整用例连续三次通过。正式测试修正仍待实施。
- [Goal 调研](pi-0.99.1-goal-followup-test-research.md) 发现原夹具缺少真实 TUI abort binding，并混用了两种约定。历史 C11 明确允许 TUI 把排队输入退回编辑器、需要重发，本轮实跑符合该副作用；不能直接判成 TUI 插件 bug。SDK 改用已等待入队的公开 followUp API 后仍只有 1 次请求，不满足历史 SDK 的 2 次请求验收，应另记兼容行为变化。下方将整个问题直接归为生产缺陷的早期判断不再作为当前结论；应先拆开 TUI 与 SDK 验收，不直接修改生产调度。
- 本轮主检查仍为 `2640 passed / 2 failed / 13 skipped`，失败仍是未改变预期的两个 Write 用例。证据 `.scratch/pi-0.99.1-test-research/check.log`；下面的 Final validation 表保留上一轮记录。

## Credential isolation

`scripts/test.mjs` 只继承明确列出的系统变量、pnpm 入口及离线验收开关，再设置仓库内 HOME、USERPROFILE、APPDATA、LOCALAPPDATA、TMP、XDG 和 agentDir。不使用 `PI_*` 或 provider 名称前缀放行。Windows 环境变量名称按不区分大小写匹配。

新增 `extensions/codex-compact/__tests__/test-wrapper.test.ts` 通过真实 wrapper → pnpm → Vitest 验证外部虚构的 OpenAI、Bedrock bearer token、AWS web identity/container/profile/config/credentials 入口及 Google credentials 均未传入。外部 MCP 配置、父代理和 session 路径也不透传。隔离 ModelRuntime 不因此获得 Bedrock 认证。必要测试开关仍传入；测试内部注入的虚构凭据不受影响。

`logs/env-red.log` 记录旧实现泄漏八个变量，`logs/env-green.log` 记录修复通过。没有使用真实凭据、身份文件或远端请求。此处验证环境继承隔离，不宣称仅靠允许名单就能禁止所有网络访问。

## Process ownership

`scripts/test-process.mjs` 统一处理 runner 成功、失败、启动失败、退出后遗留 worker 和重复 SIGINT/SIGTERM。Unix 创建独占进程组，只向该组发信号，不按进程名称清扫全机。进程组消失后立即继续；仍存活时等待最多 2 秒，再 SIGKILL 并最多等待 3 秒。等待按整个任务计时，不按 worker 数量累加。无法确认停止时返回失败并保留目录。

期限用于清理而非放宽测试或生产操作 deadline。受控的一个及六个忽略信号 worker 都走同一个 2 秒优雅退出窗口与 3 秒强制确认窗口，测试上限为 8 秒。正常结束不固定等待窗口。macOS 已验证真实 pnpm/Vitest listener 取消、SIGINT、SIGTERM、重复信号、提前退出、非零退出、spawn 失败和无法核验所有权的错误路径；不属于任务的对照进程不受影响。真实 listener 的 PID 和端口退出后才删除目录。

`logs/process-red.log` 复现旧实现取消后 worker 存活，`logs/process-green.log` 和 `logs/wrapper-boundaries.log` 记录修复及边界回归。新增 wrapper 文件共八个用例，完整主检查中均通过。

Windows 实现使用 `scripts/test-process-windows.ps1` 的 Job Object，禁止 breakaway，设置 `KILL_ON_JOB_CLOSE`。`scripts/test-process-child.mjs` 等待启动门禁，先分配进程到 Job，再允许 pnpm 创建后代；helper 持有 wrapper 的进程句柄，pnpm 先退出不会丢失后代归属。Job 为空后才删除目录。实现依据 Microsoft [Job Objects](https://learn.microsoft.com/windows/win32/procthread/job-objects) 及相关 API 文档，尚无 Windows 实跑证据，不能视为验收完成。

### Detached resource limits

- 普通 worker 归属 `test.mjs` 的进程组；外层 `check-host-integration.mjs` 使用自己的组与既有 `stopProcessGroup()`。两个组不能等同，正常取消由内层 wrapper 转发并等待清理。
- Python PTY 驱动可能创建新 session，私有 tmux server 也不属于普通 worker 组。它们仍由各自夹具记录的 PID、私有 socket 及 `finally` 负责回收。
- 本轮正常和失败退出均报告资源清理；没有证明强杀夹具、wrapper 自身遭 SIGKILL 或脱离进程组的资源在取消时都能回收。生命周期全平台及 detached-resource 验收项保持未完成，不把本修复说成任意进程树清理保证。

## Write execution contract

`extensions/codex-ui/__tests__/write-host-validation.test.ts` 通过真实 DefaultResourceLoader、仓库工具注册、宿主参数校验及执行器调用计数验收。faux provider 只输出固定 tool call，不伪造校验后的 tool result。每种输入同时针对既有文件及新路径；真实结果还进入 ToolExecutionComponent 渲染。旧折叠、展开和正常渲染测试保留。

| Input | Actual Pi 0.99.1 behavior | Test status |
| --- | --- | --- |
| Missing content | 参数拒绝，执行器不进入，既有字节不变，新文件不存在 | Passed |
| Object | 同上 | Passed |
| Array | 同上 | Passed |
| Null | 转为 `"null"`，执行器进入两次，覆盖既有文件并创建新文件 | Failed rejection expectation |
| Number 123 | 转为 `"123"`，执行器进入两次，覆盖既有文件并创建新文件 | Failed rejection expectation |
| String | 正常写入，生成真实 Write 结果及渲染 | Passed |

实际依据为安装包 `@earendil-works/pi-ai/dist/utils/validation.js` 的转换后校验流程及 `logs/check.log` 中的文件字节和 tool result。需要用户选择保持宿主转换语义并调整原验收计划，或另行授权严格类型拒绝。后者必须在宿主转换前识别原始参数，不能只在已收到字符串的 Write executor 内加检查。本轮不擅自改变执行契约。

## Goal follow-up investigation

`extensions/goal/__tests__/provider-runtime.mjs` 增加可选 `GOAL_PROVIDER_TRACE`，记录请求、context、follow-up 快照、abort 和 settle 顺序；原断言和时序不变。复跑证据为 `logs/goal-trace-2.log` 和 `goal-trace-2/stale-queued-continuation-followUp.json`。

1. 第一请求完成后，自有 continuation 已排队。
2. 第二次 context 处理时请求计数仍为 1，待处理 follow-up 包含 `PRESERVED_INPUT`。
3. Goal 将自有 continuation 判为过期，调用 `ctx.abort()`。
4. session 随后 settled，请求计数仍为 1，`PRESERVED_INPUT` 仍在 follow-up 队列，没有继续执行。

`extensions/goal/src/scheduler.ts` 用 `externalWorkDelivered` 保护已送达的外部消息，不能保护仍排队的 follow-up。Pi 的 `AgentSession.abort()` 设置整个运行的 abort 标志，阻止此次运行继续处理队列。故障不是输入字节丢失，而是 Goal 的局部撤销通过全 session abort 终止了外部排队工作的调度。

待授权方案是调整自动 continuation 的调度和失效撤销边界。优先验证在宿主处理外部工作后的 `agent_before_settle` 再决定是否投递；若仍需取消已投递请求，必须保证只撤销自有工作且保留外部队列的继续执行。不能仅将期望请求数改成 1，也不能为了排空队列额外发送过期请求。实施前应补充队列竞争回归，以原“两次请求”和 `PRESERVED_INPUT` 断言验收。

## Tmux close investigation

新增 opt-in `PI_SUBAGENT_TRACE_DIR` 和 `extensions/subagent/__tests__/fixtures/trace-runtime.ts`，对真实 manager/runtime/store 方法记录单调时钟、观察结果和最终锁目录快照。生产方法原样调用，关闭 deadline 保持 5 秒。诊断保存失败也不阻止 fixture 的资源清理。

源码和 dist 的 production 全组各连续串行运行三次。源码前两次通过，第三次 auth-inherited 超时；dist 第一次及第三次通过，第二次 auth-both 超时。增加锁快照后，auth 子组两种实现又各连续运行三次，dist 第一次的 auth-env 超时。证据为 `logs/tmux-full-*.log`、`logs/tmux-auth-*.log`、`tmux-traces/` 和 `tmux-lock-traces/`。

决定性样本 `tmux-lock-traces/dist-auth-env-.sa-prod-FaViV4.json` 中，runtime close 和 confirmClosed 在约 50 ms 内完成，进程已退出、pane 已消失；`store.delete()` 从约 2338 ms 等到 7288 ms 后随 deadline 取消。状态锁目录仍存在，内部文件数为零。其他记录中的源码和 dist 超时也停在 close 确认后的 store.delete。

`extensions/subagent/src/file-lock.ts` 先 mkdir 再写 owner 文件，释放时先 unlink owner 再 rmdir。现有恢复路径仅处理恰有一个 owner 文件且本机 PID 已退出的锁；空目录无法恢复。终止写状态的 child 可能在这两个非原子窗口留下空目录。已证明空锁阻塞删除，尚未捕获到底发生在哪一个窗口，不能把某个具体交错说成已观测事实。

待授权方案应先构造确定性的空锁复现，再修正锁所有权发布/释放协议，或让 close 等待 child 停止写状态后再终止。恢复时必须能证明锁不再被活进程持有或初始化，不能按目录为空或存续时长直接删除。最终仍用 5 秒关闭限制、真实源码/dist 重复执行验证。此处涉及生产实现，本轮未修改。

### Additional Fast failure

最终 `host:tmux:check` 的源码阶段为 `11 passed / 1 failed`。这次失败不是已跟踪的关闭超时，而是 `fast-production.test.ts:185` 的 Fast 状态 entry 先于 assistant entry 的顺序断言。该断言读取两次 transcript，缺少 entry 也会得到 `-1`；当前证据不足以区分落盘等待与实际顺序问题，不把它归入空锁根因，也未放宽断言。dist 因 fail-fast 未执行，另行补跑同组三个文件为 `12 passed`。一次补跑通过不抵消此前 dist 超时或这个新失败，需继续调查。

## Final validation

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm run check` | 两次复跑均为类型检查通过；2640 passed、2 failed、13 skipped，后续步骤被 fail-fast 阻断 | `logs/check.log`、`logs/check-final.log` |
| `pnpm run build` | 独立补验通过 | `logs/build.log` |
| `pnpm run package:check` | 通过，八个发布入口 | `logs/package.log` |
| `pnpm pack --dry-run` | 通过 | `logs/pack.log` |
| `pnpm run host:check` | 源码/dist 各八个扩展加载成功，确认仓库 MCP 替换 builtin | `logs/host-check.log` |
| `pnpm run host:accounting:check` | 根 74 场景、288 请求及子进程 16 场景通过；Goal follow-up 原断言失败 | `logs/host-accounting-check.log` |
| Independent terminal run | 通过，补验 accounting fail-fast 未执行路径 | `terminal/command/run.log` |
| `pnpm run host:tmux:check` | 源码 11 passed、1 failed，见 Fast 失败说明；dist 被阻断 | `logs/host-tmux-check.log` |
| Independent dist tmux run | 12 passed，不代表间歇超时已修复 | `logs/tmux-dist-final.log` |
| `pnpm run host:pty:check` | 通过，含 footer、Goal UI、MCP 恢复、tool-status、search、root/child accounting | `logs/host-pty-check.log` |
| `pnpm run host:benchmark:check` | 通过，未放宽原阈值 | `logs/host-benchmark-check.log` |
| `pnpm run codex-compact:quality:check` | 24 passed，历史版本保护保持 | `logs/codex-compact-quality-check.log` |

`git diff --check` 及三个新增/修改 Node runner 的语法检查通过。结束时核对日志中的 323 个任务 PID，均已退出；两个已记录的 socket 路径均不存在，进程列表未发现本任务隔离目录的存活命令，结果见 `cleanup.json`。wrapper 回归确认受控 listener 端口关闭，PTY/MCP 驱动也报告各自资源退出。这不是未运行平台或强杀场景的证明。

未调用付费模型，未提交、推送、发布或部署。所有新证据写入仓库，原升级和审阅日志保留。Linux/Windows 实跑、detached 资源强制取消、Write 契约选择、Goal 调度、tmux 锁和新增 Fast 顺序失败仍未完成。
