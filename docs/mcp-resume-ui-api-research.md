# MCP resume history rendering design

## Decision

推荐纯插件方案：**预注册历史渲染占位工具，通过生命周期交接少量显示元数据；实时工具继续在连接后注册。** 当前没有必要修改 Pi 源码。

这不是完整 schema 缓存方案，也不是 UI monkey patch。历史是否能显示，不应取决于 MCP 服务器是否在线。实现只使用公开 extension hooks、`registerTool`、active-tool API、session 读取 API，以及插件自己的文件读写。

本结论针对本机 Pi `0.85.1` 的内置 interactive TUI。仓库依赖当前为 `0.84.3`，不能把两个版本的源码或测试结果混用。以下核心机制已做真实宿主/组件的受控验证，尚未实现生产补丁，也未完成真实 CLI/PTY 验收。

## Evidence

### Rendering order

Pi 在进程内替换 session 时调用 `rebindCurrentSession({ renderBeforeBind: true })`。它先创建历史行，再绑定扩展、触发 `session_start`。[S1]

当前 MCP extension 在 `session_start` 中读取受信任配置、建立连接，收到工具列表后才注册定义及 `renderCall`、`renderResult`。[R1]

历史行构造时把工具定义存入 `ToolExecutionComponent.toolDefinition`。若当时定义不存在，组件使用默认 shell、JSON 参数和文本结果；之后不会重新查询 registry。动态注册和 `invalidate()` 均不会补绑。[S1][S2]

冷启动不同：Pi 先绑定 extension、执行 `session_start`，然后调用 `renderInitialMessages()`。因此冷启动恢复可以直接在 `session_start` 从历史注册 renderer，不需要跨进程缓存。[S1]

### Available extension APIs

- Factory 只有 `ExtensionAPI`，没有目标 session context。Factory 可以 `registerTool`，但不能调用尚未绑定的 `getActiveTools`、`setActiveTools` 等 action API。[S3]
- `session_shutdown` 的公开字段包含 `reason`、`targetSessionFile`。Pi 等待 shutdown handler 完成后，才销毁旧 runtime 并创建新 runtime。[S4]
- `setActiveTools` 只修改模型的 active tools，不删除已注册 definition。因此 inactive 历史占位仍能提供 renderer。[S5]
- 同名重新注册可以替换 definition，但已经 inactive 的名字不会仅因替换而自动激活。发现 live tool 后需要显式协调 active set。[S3][S5]
- 工具 allowlist/exclusion 与 inactive 不同。Host 可以把 definition 本身过滤掉，此时插件也无法用该名字恢复 renderer。[S5]
- `getAllTools` 仅返回工具元数据，不返回完整 execute/renderer。公开 extension API 没有 renderer-only 注册或给既有历史行补绑定义的接口。[S3][S6]

Context7 的官方文档条目也确认了 factory/runtime 注册，以及在 `session_start` 把预注册工具设为 inactive 的用法；具体时序以安装版 `0.85.1` 源码为准。[W1]

## Proposed architecture

### Separate rendering from execution

保留现有 `mcp__server__tool` 名字与独立工具 schema，不改成统一 `mcp_call` dispatcher。当前权限扩展按 MCP 名字识别 server/tool，改 dispatcher 会带来不必要的工具选择和权限语义变化。[R3]

建立两种定义：

| 定义 | 数据来源 | 渲染 | 执行 |
| --- | --- | --- | --- |
| History placeholder | 会话中的工具名字及 MCP details | 使用现有 MCP renderer | 一律拒绝，无网络、无进程启动 |
| Live tool | 当前受信任配置和服务器 discovery | 使用相同 renderer | 使用当前 schema 和 manager |

历史占位不携带服务器旧 schema、description、prompt snippet 或 prompt guidelines。占位参数 schema 只是满足注册接口，不参与真实执行。不要把占位记成已经完成 live 注册，否则现有 signature 去重可能跳过替换。

新 runtime 的 `session_start` 在任何连接等待之前，先补充历史 identity，并把尚非 live 的占位从 active tools 移除。服务器 discovery 后再同名注册真实定义，按配置、连接状态和工具启用策略显式激活。服务器删除或离线时保留显示定义，不赋予执行能力。

历史行继续持有最早注册的占位 renderer 没有问题。现有 `renderers.ts` 依赖参数、结果、theme 和行状态，不需要活的 MCP connection。[R2]

### Bootstrap cold starts directly

冷启动 `--resume`、`--session`、`--continue`：

1. 在 `session_start` 通过 `ctx.sessionManager.getEntries()` 提取历史 identity。
2. 注册缺失的历史占位，并移除占位的 active 状态。
3. 再按现有逻辑连接 MCP，注册 live tools。
4. Pi 随后创建历史 UI，此时定义已经存在。

采集全部分支的 message entries，而不只看当前可见上下文。这样以后 `/tree` 切到旧分支，也不会因为工具从未登记而缺少 renderer。Pi `0.85.1` 的 compaction 使用 `firstKeptEntryId` 引用保留的原始 entries，并非把工具消息放进某个嵌套 retained-tail 字段。[S7]

### Bridge in-process replacements

进程内切换需要把 metadata 从旧 extension 实例交给新 factory：

```text
旧 session_shutdown
  -> 提取即将显示的历史 MCP identity
  -> 原子写入本进程的短寿命 handoff
新 extension factory
  -> 读取 handoff
  -> 注册历史占位及 renderer
Pi 创建历史行
新 session_start
  -> 禁用非 live 占位
  -> 连接服务器并注册 live tools
```

不同操作的采集源：

| 操作 | shutdown 阶段采集源 |
| --- | --- |
| `/resume` | `event.targetSessionFile` |
| `/import` | `event.targetSessionFile`，此时文件已经复制并打开 |
| `/fork`、`/clone` | 当前 `ctx.sessionManager.getEntries()`，取 identity 超集即可，覆盖内存 session 和尚未落盘的空 fork |
| `/reload` | 当前 `ctx.sessionManager.getEntries()` |
| `/new` | 清除交接或交接空集合，不保留旧项目的显示目录 |
| 正常退出 | 清理交接文件，不为下一进程保留状态 |

不要把 `session_before_switch` 当作唯一交接点。操作可能被取消；而 `/import` 在该事件之后才复制文件，事件中的 destination 可能尚不存在。`session_shutdown` 在复制/open 之后、下一 factory 之前，避开了这两个问题。[S4]

### Keep handoff small and process-local

Handoff 仅含格式版本、`fullName` 和能确认的 `serverName`、`toolName`。不写参数、结果、schema、工具说明、URL、命令、headers 或凭证。

建议存入 Pi agent directory 下插件专用的私有目录，以 PID 加进程启动标识隔离不同 Pi 进程和 PID 复用；使用临时文件加原子 rename，限制权限、字段长度、条目数和总字节数。消费后删除，退出时清理，崩溃残留通过启动标识和过期清理隔离。每次只交接下一 runtime 所需的集合，不积累永续全局工具目录。

这份文件是扩展实例之间的交接，不是会话数据源。进程崩溃或重新启动后，应直接从 session 历史重建，不能依赖旧 handoff。

若未来需要支持同一进程里的多个独立 SDK runtime，PID 加启动时间不够区分 host，须另行设计 host-scoped 标识。当前方案明确针对 Pi 内置 CLI 的单 runtime-host 生命周期。

## Data and safety rules

1. 目标 session JSONL 只读。使用普通文件读取和公开导出的 `parseSessionEntries()`，再校验需要的字段。不要为了采集调用 `SessionManager.open()`：它可能补换行、迁移或初始化文件。[S7]
2. 历史消息是不可信数据。只接受合法 MCP 名字，不能让历史内容注册 `bash`、`read` 或其他非 MCP 工具；renderer 必须继续清理终端控制字符。[R2]
3. 优先从 tool result 的 `details.mcp/server/tool` 确认显示 identity，并与名字匹配。名字格式没有 escaping；server/tool 自身含 `__` 时不能靠拆字符串准确反解。缺少 details 的异常或旧记录，可以按完整名字显示通用 MCP 行，不猜执行路由。[R1][R4]
4. 不在旧项目的 shutdown 阶段读取目标项目 MCP 配置或启动其进程。配置、trust 判断和连接仍留给新 runtime 的 `session_start`。[R1]
5. 占位 execute 永远拒绝。即使其他扩展或显式 active-tool 操作重新启用占位，也不能发生远程调用。
6. 交接读取、写入、容量校验失败时报告显示降级。不能因 UI 交接失败跳过 MCP 的 shutdown cleanup，也不能启用旧 schema 兜底执行。
7. 生产实现只使用 Pi 公开 API，不导入 `InteractiveMode` 等内部类。以下 probe 使用内部类，是为了验证宿主行为，不是补丁的实现依赖。

## Alternatives

| 方案 | 判断 |
| --- | --- |
| 仅提前连接 MCP | 网络与进程启动进入 factory，离线和已删除工具仍无 renderer，不推荐 |
| 永久缓存完整工具定义 | 过期 schema 和说明会污染执行/模型能力，不必要 |
| 永续 identity registry | 可以提供预注册名字，但带来积累、并发和清理；冷启动已经能读历史，不作为默认方案 |
| 强制 rerender、访问私有 chat container | 现有行缺的是 definition，不是重绘；私有 patch 增加升级风险 |
| 自动在 session_start 连续 reload | 容易形成重载循环，还会重复连接；不作为常规路径 |
| 固定 `mcp_call` dispatcher | 改变工具 schema 和权限粒度，不是 UI 修复的必要条件 |
| 修改上游提供 renderer-only/late binding | 更直接，但当前正常 CLI 生命周期已有纯插件路径，暂不需要维护 fork |

## Verification performed

在本机 `0.85.1` 上进行了两个受控 probe，无模型请求、无 MCP 连接，临时文件全部在仓库内创建并已删除。

第一个 probe 使用真实 `AgentSessionRuntime`、`InteractiveMode.prototype.rebindCurrentSession`、`loadExtensionFromFactory`、`ToolExecutionComponent` 和当前 MCP renderer，外围 session/模型/服务器使用受控替身：

```text
resume:
  before_switch(target exists)
  -> shutdown(target exists)
  -> factory -> history render -> session_start(server offline)

import:
  before_switch(target absent)
  -> shutdown(target exists)
  -> factory -> history render -> session_start(server offline)

cold start:
  session_start registers history -> initial history render
```

断言通过：离线历史使用自定义 `Called offline / old-tool` 行，不显示默认 JSON 参数块；占位 execute 抛错，未调用服务器。

第二个 probe 对真实 `AgentSession` registry 方法提供最小 state：

- inactive 后 `getToolDefinition(name)` 仍返回 renderer definition；
- 同名换成 live 定义后仍 inactive，需要显式 activation；
- explicit exclusion 会移除 definition，不能再提供历史 renderer。

这些结果证明方案的关键机制，不等于生产实现已完成或全部 CLI 路径已通过端到端测试。Fork、reload、tree 等路径目前还有发布前验收工作。

## Support boundary

正常安装于用户级、旧实例也具有交接 hook，且无 host definition filter、文件读写失败或安全上限拒绝时，该方案可自动处理冷恢复、进程内 resume/import，以及计划覆盖的 fork/reload。

不承诺以下情况无条件自动恢复：

- 正在运行的旧实例尚未安装交接 hook，首次通过 `/reload` 加载新实现。部署时重启 Pi，再冷恢复即可直接从历史建立 renderer；也可提供手动修复命令，扫描当前历史并执行一次受控 `ctx.reload()`。
- 用户显式排除该工具，导致 host 连 definition 都不保留。插件不应绕过这个限制。
- 插件只安装在项目内，跨 cwd 后不再加载。当前用户级安装不需要因此信任目标项目。
- 异常会话文件、交接 I/O 失败、过大的 identity 集合。必须清楚报告降级，不能静默宣称修复成功。
- 自定义 SDK host、多 runtime 或 RPC 客户端自己的 UI。它们需要单独验证生命周期。

普通首次导入旧会话不需要先有缓存：只要旧实例已安装 hook，shutdown 就能从已复制的目标文件提取 identity。

## Implementation and acceptance

实现建议分为 history identity 采集、短寿命 handoff、历史占位定义及 active-set 协调三部分，再接入现有 `index.ts` 生命周期。现有 renderer 保持共用，不复制一份历史专用 UI。

发布前必须补：

- 真实 CLI/PTY：冷恢复、`/resume`、首次 `/import`、fork/clone、reload、tree 分支切换。
- 服务器在线、离线、工具被删除、名字改变、后台恢复及 `PI_SUBAGENT=1`。
- 同名 live 替换、显式 activation、离线占位拒绝执行。
- 切换取消、跨 cwd trust、未落盘/内存 session、损坏或无 details 的记录。
- 多进程交接隔离、崩溃残留、写入失败、恶意名字、超限数据和资源 cleanup。
- 明确测试 Pi 版本。当前仓库依赖为 `0.84.3` 而使用者运行 `0.85.1`，需要对齐测试版本或同时建立兼容矩阵。

届时运行仓库的 `pnpm run check`，并确认 CLI 测试进程和监听端口全部清理。本轮仅新增调研文档，不修改生产代码或 dist，未运行会重建 dist 的全仓检查。

## Sources

以下 `Pi` 路径均指本机安装的 `@earendil-works/pi-coding-agent@0.85.1`，不是仓库的 `0.84.3`：

- [S1] Pi `dist/modes/interactive/interactive-mode.js:313–319, 711–714, 1505–1553, 3012–3024`。Replacement 与冷启动顺序、工具定义查找、历史组件构造。
- [S2] Pi `dist/modes/interactive/components/tool-execution.js:25–69`。构造时保存 definition，renderer getter 读取该字段。
- [S3] Pi `dist/core/extensions/loader.js:135–157, 238–245, 458–469`。Factory 能力、同名注册和 factory await。
- [S4] Pi `dist/core/agent-session-runtime.js:78–144, 173–249, 258–294`；`dist/core/agent-session.js:2217–2238`。Before-switch、shutdown、resume/import/fork/reload 的顺序。
- [S5] Pi `dist/core/agent-session.js:635–679, 2105–2180`。Active tool、definition registry、同名替换、允许/排除过滤。
- [S6] Pi `dist/core/extensions/types.d.ts` 的 `ExtensionFactory`、`ExtensionAPI`、`SessionShutdownEvent` 和 `ToolInfo`。
- [S7] Pi `dist/index.js:23`；`dist/core/session-manager.js:90–105, 166–230, 277–320, 619–677`。公开 parser、compaction entry 引用关系及文件打开副作用。
- [R1] [MCP extension](../extensions/mcp/src/index.ts)，重点为 `139–182, 203–317, 450–549`。
- [R2] [MCP renderer](../extensions/mcp/src/renderers.ts)，重点为 `94–135` 及参数/结果清理逻辑。
- [R3] [Permission policy](../extensions/permissions/src/permission-policy.ts)，重点为 `34, 138–141, 396`。
- [R4] [MCP client](../extensions/mcp/src/client.ts)，`573–575` 的工具命名逻辑。
- [W1] [Official extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，经 Context7 `/earendil-works/pi` 核验动态注册、inactive 工具和自定义 renderer 用法。Main 文档不是版本时序的替代证据。
