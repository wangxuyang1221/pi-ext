# Goal lifecycle acceptance

## Understanding

实施 adventure #5，依据 #3 的 C7/C8 和 V3 生命周期要求。基准为 `f4a7e44b43070748f082523b7377b165c9471e9e` 加已验收 #4 未提交工作区。保留已有研究稿、prototypes 和全部 #4 交付。

## User Visible Changes

- `/tree` 保留同一会话最新目标、状态与累计消耗；new/resume/reload/shutdown 后旧命令或异步回调不能写目标。
- 普通 fork/clone 不继承目标。`/goal-fork` 选择历史 fork 或当前位置 clone，复制完整当前快照到独立记录，源目标不变。取消与失败不清除源目标。
- 显式继承的 active 仍为 active，持久化 `continuationDeferral` 阻止立即续跑，重开不解除。用户明确启动回合后解除门禁，不改变其他停止状态。自动调度及完整 `/goal resume` 状态控制仍由 #6 实施。

## Todo

- [x] 核验双版本公开 fork、withSession 与生命周期接口，建立既有测试基线。
- [x] 加固生命周期有效性与 checkpoint，拒绝 shutdown 后旧写入。
- [x] 实现 `/goal-fork`、新记录完整继承与门禁持久化，覆盖取消及各阶段失败。
- [x] 补齐双版本真实 runtime 生命周期验收并运行 `pnpm run check`，写回 #5 证据、读回核对并交回正文写权。

## How To Test

- 每轮先写一个失败测试并确认行为原因，再实现并回归 goal 测试。首先验证 shutdown 后旧命令不能创建或替换记录。
- 检查 checkpoint 读取权威状态并串行等待既有写入，不改变源 revision；继承复制 goal ID、generation、objective、六种状态、预算、累计 tokens/time 和时间戳。新记录 revision 独立，失败不留下成功通知。
- 在两版本真实 SessionManager/AgentSessionRuntime 验证 tree、新建、恢复、普通 fork/clone、显式 fork/clone、reload/reopen、旧 context、取消和故障注入。UI 使用受控回答，不冒称真实终端 TUI。模型调用只用于明确用户回合 fixture，不自动调用。
- 性能约束为事件驱动，无轮询、定时器或逐历史节点磁盘读取。继承只复制一份当前快照；沿用 #4 catalog 扫描，不在本关引入存储索引。检查 tree 不额外写权威记录，重复摘要不新增镜像。
- 最终运行 `pnpm run check`、双版本 runtime 与 #4 存储进程回归，所有测试文件仅在仓库临时目录。清理本任务临时资源，不改用户全局配置、不 commit/push/deploy。

## Evidence

执行环境为 macOS、Node v22.22.2、pnpm 11.9.0。Context7 `/earendil-works/pi` 返回 main 文档，没有目标版本索引；固定版本依据已安装 0.84.3/0.85.1 官方声明与 runtime 源码，验收不以 main 推定兼容。相关完整文档为 extensions.md、sdk.md、sessions.md、session-format.md，另核验 confirm-destructive.ts 和 SDK sessions 示例。

基线 goal 测试 9 项通过。新增 Red→Green 行为包含 shutdown 后旧 command closure 重新打开 writer、异步 bind 被 shutdown 超越、checkpoint/inherit 接口缺失、显式 fork 命令缺失、持久化门禁释放缺失，以及异步文件写入期间 context 失效仍提交。其余已满足行为补为回归测试，未把环境错误记作 Red。

最终 goal 单元测试 25 项通过。`pnpm run check` 通过，828 项通过、1 项既有 subagent integration 跳过，类型检查、构建和发布包检查通过。两版本各运行生命周期 15 项、#4 基础 runtime 6 项和进程崩溃/竞争接管 4 项，全部通过。另用 0.85.1 官方类型执行 goal `tsc --noEmit` 通过。

### Runtime matrix

| Scenario | Result |
| --- | --- |
| tree 切到旧历史 | 保留最新 objective、complete 状态、450 tokens 和 32.5 秒，不改源 revision |
| clear 后 tree/reload | tombstone 保留，不从镜像复活 |
| new/resume | 新会话无目标，恢复原会话仅绑定其权威记录，旧 context 的 session API 拒绝调用 |
| 普通 fork/clone | 确实复制了镜像，但新会话不继承目标；自行创建目标不改变源 |
| 显式历史 fork | 从较早用户位置 fork，但复制当前完整目标，不采用历史镜像；编辑器恢复所选用户文本 |
| 显式 clone | 新 record、独立 revision，完整复制 goal ID/generation、预算、消耗、时间和状态，源记录不变 |
| 初始续跑门禁 | active 仍为 active，reload 和真正 reopen 保留 deferral，未发模型请求 |
| 门禁解除 | interactive input 解除；extension input 不解除；六种状态均不因门禁解除改变状态或累计值 |
| 选择/宿主取消 | 留在源会话，无新记录、无源变更 |
| 继承写入失败 | 新会话没有已确认目标，源不变；writer 已释放，之后可以新建目标 |
| 替换 runtime 构造失败 | 旧 context 保持失效；重新打开源会话后恢复完整记录 |
| 继承 I/O 被另一次 new 超越 | 在实际 authoritative replacement 前重验 fresh context，拒绝 stale commit，无新目标记录 |
| 未落盘会话 clone | Pi 原生报错，保持首回复前已独立保存的目标，不伪造 assistant |

生命周期每版本仅有 8 次显式 fixture 模型请求，用于区分 extension/interactive input 及六种状态；没有自动续跑。两条 extension error 是预期注入的 replacement construction failure 和 stale inheritance commit，均有精确断言。测试中的 assistant JSONL 和统计由 fixture 建立，不是产品实现伪造。

### Reproduction

先运行 `pnpm run check` 生成 dist。以下脚本可传入另一个 Pi package root，默认使用仓库 0.84.3：

```bash
node extensions/goal/__tests__/lifecycle-runtime.mjs <pi-package-root>
node extensions/goal/__tests__/runtime.mjs <pi-package-root>
node extensions/goal/__tests__/processes.mjs <pi-package-root>
```

运行日志保留在本地 `.scratch/goal-level5-evidence/`。脚本注入仓库临时 agent/session/goal 目录，finally 清理。崩溃测试 child 均已停止并等待退出；没有启动监听服务，没有遗留测试进程。临时 0.85.1 tsconfig 已删除。已有用户文件与 #4 交付均保留，没有 commit/push/deploy。

### Integration notes

`GoalLease.checkpoint(expected)` 串行等待既有操作并重读权威记录，不增加 revision。`inherit(snapshot)` 只允许从未提交的新记录，首次提交同时写入完整 goal 和 `continuationDeferral: true`。`releaseDeferral(expected)` 只解除门禁，不改变状态。

`openSession(owner, assertCurrent)` 的可选生命周期校验在排队操作开始和 rename 发起前执行，后续调度和计费应沿用绑定 lease，不绕过它直接 commit。rename 已发起的提交不宣称可以撤销；这里保证失效 context 不再发起新的 authoritative replacement。

完整 `/goal resume` 状态迁移与调度属于 #6，届时应在同一次权威状态提交中处理 active 与解除 deferral，并独立检查预算和停止状态。当前明确用户输入可解除门禁，但本关没有自动调度器，不能把该门禁测试当作自动请求已验收。

### Limits

没有真实人工 TUI、真实 Codex 计费、子代理归集、Windows 或断电验收。V3 生命周期证据不替代 V1/V2/V4/V5。Pi 0.84.3/0.85.1 的公开 fork 对尚未落盘的会话有限制，失败保留目标，不更改 C10 的首回复前保存与恢复能力。
