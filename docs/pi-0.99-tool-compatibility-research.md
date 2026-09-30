# Pi 0.99 tool compatibility research

## Scope and evidence

本次只检查 upstream MCP、codemode、nested tool orchestration 对 `extensions/mcp`、`permissions`、`goal`、`subagent`、`codex-ui` 的影响。没有修改代码或依赖，没有调用认证、MCP server 或模型网络接口，没有启动服务。只新增本文件。主代理负责整体验证和回归测试。

以下路径缩写用于精确定位本机一手资料。`R` 是仓库根目录。

```text
R=/Users/wangxuyang/Code/t3code/pi-ext
O=/Users/wangxuyang/Code/t3code/pi-ext/node_modules/.pnpm/@earendil-works+pi-coding-agent@0.87.0_@modelcontextprotocol+sdk@1.29.0_zod@4.4.3__ws@8.21.3_zod@4.4.3/node_modules/@earendil-works/pi-coding-agent
N=/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.99.1/5afa292de32253c6346f335c2638052409be2c82333982ac9cbbf32cd3c584a7/node_modules/@earendil-works/pi-coding-agent
```

完整阅读了 `N/docs/mcp.md`、`extensions.md`、`sdk.md`、`tui.md`、`cli.md`、`settings.md`、`security.md`、`message-types.md` 和 `session-format.md`，并检查对应 built JS 与类型定义。没有单独安装 0.99.0。0.99.0 的结论来自 0.99.1 本机实现及发布记录，不能算两个发行包逐字节比较。`N/CHANGELOG.md:3-19` 的 0.99.1 改动只有模型与登录；本次 tool orchestration 功能记录在 `N/CHANGELOG.md:21-34,52,84` 的 0.99.0 节。

## Summary

- 未发现当前 MCP extension 因 `/mcp` 冲突而加载失败或重复连接。上游明确让第三方 `/mcp` 注册替换整个 builtin MCP extension。
- 确认一个旧有缺陷被新功能直接触发：goal 与 managed child usage reporter 忽略 `toolResult.usage`。codemode classifier 和 nested model tools 的消耗因此不会进入 goal budget 或 child usage report。
- 确认新旧 MCP 接口不能混用。保留当前 extension 时，builtin MCP 的 `exposure`、`enabled`、OAuth、资源工具、动态 server registration 不会自动得到支持；codemode 调用当前 MCP 工具拿到 text string，而不是 builtin MCP 的完整 `CallToolResult`。
- permissions 仍检查实际 nested tool calls。codex-ui 的 read grouping 不会仅因出现 nested read execution event 而错误创建顶层 read row。subagent reader 能接受外层结果，但不展示 `nestedCalls` 内的活动。
- goal loop detector 与 nested goal completion 的交互需要回归验证。源码已确认调用形态变了，但本次没有把潜在误暂停写成已发生故障。

## Confirmed accounting gap

### Goal and child reports omit tool result usage

`R/extensions/goal/src/accounting.ts:93-100` 在 `message_end` 中只接收 `role === "assistant"`，`101-114` 另行处理 compaction 与 branch summary。`R/extensions/subagent/src/usage.ts:93-99` 同样跳过所有非 assistant 消息。父 goal 从 child report 文件读取 tokens，不会补读 child tool results，见 `R/extensions/goal/src/children.ts:37-55`。

0.99 的 codemode 自身把 `models.classify()` 消耗放入工具结果 `usage`，而不是额外的 assistant message，见 `N/dist/extensions/codemode/execute.js:190-193,273-278,371-379`。nested tool results 的 usage 汇总到 root tool result message，见 `N/dist/core/nested-tool-calls.js:154-157,170-176` 和 `N/dist/core/agent-session.js:688-697`。session totals 会计入它，见 `N/dist/core/agent-session.js:3325-3329`。

因此，只要 active goal 或 managed child 调用了有非零 model usage 的 codemode classifier 或 nested model tool，当前 reporter 就漏计这部分消耗。没有工具 usage 时不受影响。普通 MCP 调用本身不等于 model token usage，不能把每个 MCP call 都算成漏计。

这是 pre-existing deficiency，不是 0.99 删除了旧字段。0.87 已支持 `tool_result.usage`，见 `O/dist/core/extensions/types.d.ts:798`，且 session totals 已统计 `toolResult.usage`，见 `O/dist/core/agent-session.js:3064-3068`。0.99 新增了仓库用户更容易直接触发的 codemode usage 来源。

已用现有 `R/extensions/goal/dist/accounting.js` 做无写入 mock event probe。发送 assistant usage `input=1, output=1`，再发送 codemode `toolResult` usage `input=7, output=3`，得到：

```json
{"observedGoalTokens":2,"mainAssistantTokens":2,"ignoredToolTokens":10,"accountCalls":[2]}
```

复现时须在 subprocess 中清除 `PI_SUBAGENT_PARENT`，否则 capability 正确拒绝 child session 的 root goal accounting。probe 使用 `Map` 保存 `pi.on` handler，mock `account()` 只更新内存 checkpoint，不写实际 goal 文件。事件顺序为 `session_start`, `context`, assistant `message_start`, assistant `message_end`, toolResult `message_end`。`ctx.mode="tui"`，mock persistent session 与 selected model。根因直接位于 `accounting.ts:94` 的 role guard。

修复时应统计 finalized root `toolResult.usage`，不要再把 nested `tool_result` event 的 usage逐个重复相加，上游已经完成递归汇总。

## MCP replacement and configuration boundaries

### Command collision is intentional replacement

`R/extensions/mcp/src/index.ts:409-410` 注册 `/mcp`。上游 builtin MCP 标记为 replaceable，见 `N/dist/extensions/index.js:9-11`。`N/dist/core/resource-loader.js:67-100` 在非 replaceable extension 注册同名 tool、command 或 flag 时移除整个 replaceable extension，并生成警告。`N/docs/mcp.md:182-184` 明确说明第三方 `/mcp` 会替换 builtin MCP，session 不再由 builtin 读取 `mcp.json` 或连接 server。

因此，当前 extension 正常加载时，不应报告“两套 MCP 同时连接相同 server”或“/mcp 必然冲突导致加载失败”。builtin codemode 与 tool_search 是独立的 replaceable extension，不会因 `/mcp` 被替换而一起消失，见 `N/dist/extensions/index.js:9-11`。

主代理补充了真实 0.99.1 宿主的 loader probe，不再只有源码推断。`R/.scratch/pi-0.99-audit/mixed-host-load.mjs:4-5,11-24` 使用 0.99.1 的 `DefaultResourceLoader` 与 builtin factories，分别加载仓库原有 0.87.0 依赖下的全部 8 个 extension source 入口和 dist 入口，同时显式加载 builtin MCP、codemode、tool_search。两轮均保留 10 个 extensions、0 个加载错误；builtin MCP 因当前 extension 的 `/mcp` 注册被省略，各产生 1 条 replacement warning，codemode 与 tool_search 各保留 1 个。对应实测输出见 `R/.scratch/pi-0.99-audit/mixed-host-load.log:1-2`。

该 probe 可在仓库根目录用 `node .scratch/pi-0.99-audit/mixed-host-load.mjs` 复现。它验证的是 factory/resource loading 与替换规则，未绑定完整 session 或执行 MCP 调用，不能据此宣称所有 server 配置、网络连接与工具执行都兼容。补充记录没有改变本报告的 tool orchestration 范围；本轮仅读取脚本和既有日志，没有重新运行 probe 或整套测试。

### The same filename does not imply the same schema

当前配置选择 `PI_MCP_CONFIG`、项目文件、global 文件中的第一个存在文件，见 `R/extensions/mcp/src/config.ts:50-59,106-116`。builtin 合并 global 与 trusted project，同名 server 由 project 覆盖，见 `N/dist/extensions/mcp/config.js:58,65-75`。当前 extension 已传 `ctx.isProjectTrusted()` 来过滤默认项目路径，见 `R/extensions/mcp/src/index.ts:272-274`，不是新增 trust 绕过。显式 `PI_MCP_CONFIG` 路径独立于默认项目路径，见 `config.ts:109-113`，这是现有选择规则。

当前 extension 用 `disabled: true`，见 `R/extensions/mcp/src/config.ts:143-145,183-204`。builtin 用 `enabled: false`，见 `N/docs/mcp.md:29`。当前 `validateServerConfig()` 返回的 server config 不保留 `enabled`、`exposure`、`toolExposure`、`oauth`，见 `R/extensions/mcp/src/config.ts:197-241`。它还支持 SSE，见 `config.ts:183,228-239`，builtin 明确拒绝 SSE，见 `N/docs/mcp.md:45`。

这是确认的 configuration incompatibility，有具体触发条件：用户用 `pi mcp add` 或新版 builtin 文档写入 `enabled:false`、`exposure:"hidden"` 等设置，但仍加载当前 `/mcp` extension，会继续按当前 extension schema 执行，而不会实现这些 builtin 限制。不能宣称升级本身改变了已有 extension 配置行为。

`pi mcp` shell commands 总是走 builtin，而且不加载 extensions，见 `N/docs/mcp.md:180,184`。因此 shell 的 `list/login` 与当前 `/mcp status/reload` 不保证代表同一批连接、凭据或配置选择。当前 command 支持的是 `status|verbose|reload|reconnect|logs`，见 `R/extensions/mcp/src/index.ts:409-417`。

### Dynamic registrations are not consumed

`pi.registerMcpServer()` 的注册需要 MCP extension 消费 `pi.getMcpServers()` 与 `mcp_servers_change`，见 `N/docs/extensions.md:199`。对 `R/extensions/mcp/src` 全目录检索这两个 API 均无匹配；当前 startup 只读取文件 config，见 `R/extensions/mcp/src/index.ts:272-298`。因此保留当前 extension 时，其他 extension 的新版 dynamic server registration 不会由它建立连接。没有 dynamic registrations 的现有配置不受此项影响。

## Codemode result and activation semantics

### Current MCP tools remain direct and text-returning

当前 MCP 工具注册未设置 `exposure` 或 `outputSchema`，见 `R/extensions/mcp/src/index.ts:550-570`。`structuredContent` 存在 `details`，不是工具结果的顶层字段，见 `index.ts:587-594`。上游缺省 exposure 是 `direct`，active direct 工具仍可由 codemode 调用，见 `N/dist/core/agent-session.js:1079-1090`。

codemode 仅在工具声明 `outputSchema` 且返回顶层 `structuredContent` 时向脚本返回结构化对象，否则返回 text string，错误则 throw，见 `N/dist/extensions/codemode/execute.js:167-180`。因此 `await tools.mcp__server__tool(args)` 对当前 extension 返回 string，不支持 builtin MCP 文档中的 `result.content`、`result.structuredContent`、`result.isError` 对象接口。当前输出截断也已经发生在 `toPiToolContent()`，见 `R/extensions/mcp/src/index.ts:588,620-635`，codemode 不会绕过它恢复完整原始 MCP response。

这是确认的新功能互操作差异，不是现有 direct MCP 模型调用失效。脚本可按工具描述处理 string；只有把 builtin MCP 示例直接套用到当前 extension 时才会出错。subagent 与 goal 工具同样未声明 `outputSchema`，见 `R/extensions/subagent/src/tools.ts:201-214,501-514` 和 `R/extensions/goal/src/tools.ts:31,40-60`，脚本需解析 JSON text，不能直接读取对象字段。

### Active tools are not always model declarations

上游 registry 的 active direct tools 可由 nested calls 使用，codemode/deferred 工具不要求 active，model-only/hidden 工具不可 nested 调用，见 `N/dist/core/agent-session.js:1083-1090`。`codemode.mode="only"` 用 `hiddenDeclarations` 隐藏 active direct tool 的模型声明，但保留 active/callable 状态，见 `N/dist/extensions/codemode/tool.js:260-289` 和 `N/dist/core/agent-session.js:1041-1046,1097-1134`。

当前 MCP reconnect 的 active reconciliation 保留不属于自己工具的 active names，见 `R/extensions/mcp/src/index.ts:142-159`。goal 的 active 修改同样从现有 active 集合增删自己的 mutable tools，见 `R/extensions/goal/src/index.ts:66-81`。没有发现它们会自动关闭 codemode。

当前工具缺省 direct，所以从 active set 移除仍能禁止其 nested 调用。不能把 upstream codemode/deferred 的“即使 inactive 仍 callable”规则误套到当前 MCP 工具上。当前 `/mcp` 替换 builtin 后也没有 builtin 的 MCP auto-enable codemode 行为；builtin codemode 初始 inactive，见 `N/dist/extensions/codemode/index.js:3-6,17-27`。用户须自行启用，或由其他 extension 启用。

## Events, permissions, and displays

### Nested calls still pass permission gates

`N/dist/core/agent-session.js:305-340,366-390` 对 nested calls 调用相同的 before/after tool hooks，且传 `parentToolCallId`。`N/dist/core/nested-tool-calls.js:109-117,140-150,158-165` 的 execution start/update/end 同样有此字段，ID 是 `<caller id>/<n>`。执行了无网络 mock `NestedToolCallRunner` probe，确认 `outer/1` 的 start/end 均带 `parentToolCallId="outer"`，root record 汇总 `input=7, output=3`，没有 nested message event。

当前 permissions 按 `toolName` 决定是否审批，不依赖 transcript 中存在 toolCall，见 `R/extensions/permissions/src/index.ts:46` 与 `permission-policy.ts:152-154,195-211`。因此 nested bash/write/edit/MCP 不会因为不是顶层模型调用而绕过权限。Default mode 还会先审批 codemode 本身，因为它不在 read-only 或 orchestration allowlist，见 `permission-policy.ts:35-48,152-154`。Full access 本来就不审批，见 `permission-policy.ts:200`。

仓库没有使用 MCP `annotations` 决定审批，所以 read-only MCP 工具依然要批，这是原有策略，不是兼容性故障。

`models.classify()` 是 codemode global，不调用 `ctx.executeTool()`，见 `N/dist/extensions/codemode/execute.js:349-381`。它只有 codemode result details 中的 activity 与 usage，没有每次 classifier 的 tool_call gate。审批 codemode 后再做 classifier call 不会弹第二次 tool approval。这是确认的边界，是否增加独立模型调用审批由产品策略决定，不能称为实际 nested tool gate 被绕过。

### Nested activities are not standalone transcript tool results

上游 nestedCalls 记录保留 name、arguments、status、duration、error，不保留结果全文；最多 256 calls、每次 arguments 8 KiB、累计 32 KiB，不完整时 `complete:false`，见 `N/dist/core/nested-tool-calls.js:16-20,35-52,73-77`。root `toolResult` 获得该记录，见 `N/dist/core/agent-session.js:688-697`。`parentToolCallId` 不意味着 session 中另有 child toolCall/toolResult pair。

当前 subagent reader 只从 assistant content 的 toolCall 和顶层 toolResult 配对，见 `R/extensions/subagent/src/session-reader.ts:580-650`，不会把 root `nestedCalls` 展开。确认后果是用户通过 subagent_read 活动列表只看到外层 codemode activity，不会看到它内部每个 read/bash/MCP activity。root tool result 的存在与完成判断仍正常。nested result text 本身未持久化，不能承诺仅加 parser 就能恢复内部工具全文。

### Codex UI does not invent top-level read rows

codex-ui 的 read execution handlers 未过滤 parentToolCallId，见 `R/extensions/codex-ui/src/tools.ts:222-233`。但 `ReadGroups.start/result()` 必须找到 unique transcript occurrence，见 `R/extensions/codex-ui/src/read-groups.ts:117-134,173-175`。occurrences 来自 assistant toolCall content，见 `read-groups.ts:64-94`。nested read IDs 不在该 content 中，所以 execution event 会被安全忽略，不会创建 phantom row 或并入顶层 read group。

这也意味着 nested read 不会得到当前 extension 的单独 read row；它由 codemode 展示，不能当成当前 top-level renderer 的退化。未发现这些新增 events 会破坏普通 read 分组。

## Risks requiring targeted regression tests

1. goal loop detector 同时观察 nested 与 outer `tool_result`，见 `R/extensions/goal/src/scheduler.ts:138-165`。新增 call sequence 会改变 repeat window；本次未验证是否误暂停或漏暂停，不能报成已证实故障。
2. goal 的 `completionBatch` 只识别 assistant content 中直接 `update_goal(status="complete")`，见 `scheduler.ts:135`。通过 codemode nested 调用时不满足这个识别条件，虽然 `update_goal.execute()` 本身仍会真正更新状态，见 `R/extensions/goal/src/tools.ts:50-60`。需验证重复调用 pause fence 与完成同批运行的情况。
3. 当前 goal、subagent orchestration tools 未设置 `model-only`。0.99 把它们默认视作 active direct callable，见 `N/dist/core/agent-session.js:1079-1090` 与上述工具注册位置。是否允许 codemode 批量创建 child 或调用状态修改工具需要明确约定。仅出现这种新可调用方式不能推断已经有 race。

## Suggested verification slices

- mock finalized codemode root result 带 usage，验证 root goal 与 child reporter 各自只统计一次；nested event usage 不额外累计。
- ResourceLoader 同时加载当前 MCP 与 builtin MCP，验证 builtin 被省略、仅一个 session connector、发出 replacement warning；codemode 仍可独立启用。
- 在 Default permissions 下审批 codemode，然后拒绝内部 bash，验证实际 bash 不执行；同时允许 nested read，确认不会新增 top-level read group。
- 当前 MCP 工具被 active set 移除后，验证 codemode 无法调用它。重连不得重新开启用户关闭的工具，也不得关掉 codemode。
- 用 root toolResult.nestedCalls fixture 验证 subagent reader 当前只返回 root activity，再决定是否补充 nested 摘要。
- 当前 extension 读取 builtin 格式 fixture，明确 `enabled:false` 与 `exposure:hidden` 不被支持。若选择迁移到 builtin，单独验证配置合并、SSE、timeout、输出截断与 OAuth，而不是直接删 extension 后假定配置等价。

本次只运行了上述无网络、无文件写入的 recorder 与 accounting probes。未运行 `pnpm run check` 或完整 Pi session 测试。直接用 Node strip-types 导入 `src/accounting.ts` 的第一次尝试因 `.js` specifier 找不到未生成的 src 文件失败；改用既有 dist 后，还需清除 child 环境变量，最终 mock probe 成功。没有为 probes 修改生成产物。
