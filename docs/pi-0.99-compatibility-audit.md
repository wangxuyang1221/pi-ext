# Pi 0.99 compatibility audit

## Conclusion

存在兼容性影响，但没有发现八个发布插件在 Pi 0.99.1 上普遍加载失败。主要问题是新增能力与旧插件判断规则不一致，而不是旧 API 大量消失。

| Area | Verified impact | Trigger |
| --- | --- | --- |
| Goal / child usage | 漏计工具结果中的模型用量，影响预算统计 | Codemode classifier 或有 model usage 的嵌套工具 |
| Virtual models | Fast 与原生压缩仍按选中的虚拟模型判断，没有使用本次实际请求模型；Fast 拒绝后的降级可失效 | 选择 virtual model |
| OpenAI ChatGPT login | 新认证不自动供旧 Codex 搜索使用；OpenAI 模型不进入现有 Codex 原生压缩路径 | 改用 `/login openai`，没有另外配置 legacy Codex |
| New OpenAI models | `openai/gpt-6.1-sol` 不在 Fast 静态名单内；legacy Codex 分支没有这个名单限制 | 使用 OpenAI provider 的新模型 |
| Built-in MCP | 本仓库 `/mcp` 替换 builtin MCP；新旧配置、动态注册和 Codemode 结果接口不能混用 | 按 builtin MCP 文档配置，但继续加载本仓库 MCP |
| Tests / metadata | 新宿主下有旧断言、固定版本和测试 context 类型需要更新 | 将仓库验证基线升级到 0.99.1 |

建议优先处理工具用量和 virtual model 的请求模型判断。MCP 需要明确保留当前实现还是迁移 builtin，不能把两套同名配置当成等价接口。新 ChatGPT 登录需要另行设计支持，不能只把 `openai-codex` 字符串改成 `openai`。

## Scope and environment

- 检查基线为仓库提交 `b3f6e47`。开始时工作区干净。
- Node.js `22.22.2`，pnpm `11.9.0`，实际 `pi --version` 为 `0.99.1`。
- `package.json` 与安装依赖中的 `pi-ai`、`pi-coding-agent`、`pi-tui` 仍为 `0.87.0`，peerDependencies 也精确指定 `0.87.0`。
- 检查八个 `package.json#pi.extensions` 发布入口，以及未列入该清单、但本仓库已有源码和测试的 `codex-search`。
- 使用已安装的 0.99.1 官方文档、JS 与类型定义，并对比 0.87.0 安装文件。Context7 提供了 `/earendil-works/pi/v0.99.0` 的 virtual models 文档；准确事件字段以本机 0.99.1 类型和实现为准。
- 没有单独安装 0.99.0。对 0.99.0 功能的判断来自 0.99.1 实现及其 CHANGELOG，不是分别执行两个发行包。
- 没有修改生产源码、测试、依赖、用户配置或运行中的用户会话。新增两份研究文档；临时副本、探针与日志保存在被忽略的 `.scratch/pi-0.99-audit/`。构建产物由构建命令生成，没有手工编辑。
- 没有调用远端模型、认证或 MCP 服务。真实 AgentSession 探针只替换 HTTP 响应和目录/凭据存储，不产生付费推理。

本机一手来源路径缩写如下。

```text
R=/Users/wangxuyang/Code/t3code/pi-ext
O=R/node_modules/@earendil-works/pi-coding-agent
N=/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.99.1/5afa292de32253c6346f335c2638052409be2c82333982ac9cbbf32cd3c584a7/node_modules/@earendil-works/pi-coding-agent
A=N/../pi-ai
```

## Confirmed behavior impacts

### Goal and child usage omit tool model usage

`extensions/goal/src/accounting.ts:93-100` 和 `extensions/subagent/src/usage.ts:93-99` 只统计 assistant `message_end`，跳过 `toolResult.usage`。0.99 的 Codemode classifier 将用量放在工具结果，嵌套工具的用量也汇总到外层工具结果。

实测 recorder 收到 assistant 的 2 tokens 和 Codemode 工具结果的 10 tokens，Goal 只累计 2。子代理 reporter 有同样的 role guard，父 Goal 读取 child report 时不会补算。影响是预算可能比实际消耗更晚触发，不是所有 MCP 调用都会漏计。没有模型消耗的工具不受影响。

这是旧有统计缺口被新功能直接触发，0.87 已有 `toolResult.usage`。适配应统计最终外层结果一次，不能把每个 nested event 和外层汇总同时累加。

详细上游来源和探针记录见 [tool compatibility research](pi-0.99-tool-compatibility-research.md#confirmed-accounting-gap)。

### Virtual selection is no longer the physical request model

0.99 明确区分 selection 与 dispatch。`ctx.model`、`ctx.thinkingLevel` 仍表示用户选中的 virtual model；assistant message 才记录本次实际物理模型。来源为 `N/docs/virtual-models.md:15-35`，以及 [v0.99.0 官方说明](https://github.com/earendil-works/pi/blob/v0.99.0/packages/coding-agent/docs/virtual-models.md)。

实现也确认这个区别：

- `N/dist/core/agent-session.js:434-464` 在每次请求中返回 route.model，但保留 agent state 的 selection。
- `N/dist/core/agent-session.js:2684` 将 extension context 的模型绑定为 `this.model`，不是 routed model。
- `N/dist/core/extensions/runner.js:1060-1074` 的 `before_provider_request` 只有 payload，没有物理模型字段。不能建议插件直接读一个不存在的 `event.model`。

当前插件依赖旧的等同关系：

- `extensions/openai-fast-mode/src/index.ts:194-205` 用 `ctx.model` 匹配 Fast 和保存 pending model id。
- 同文件 `208-220` 用实际 assistant message.model 清除 pending 和记录不支持 Fast 的模型。
- `extensions/codex-compact/src/index.ts:371-418` 的完整上下文、headers、response、usage、request hooks 均按 `ctx.model` 做 Codex 判断。
- `extensions/codex-ui/src/index.ts:74-77,111,125-126` 只记录 selection id；自定义 footer 没有新版原生 footer 的 routed model 展示。

真实 0.99.1 AgentSession 加现有 Fast/compact 源码的离线探针得到：

```json
{
  "selected": "audit-router/auto",
  "selectedApi": "pi-virtual",
  "actualPayloadModel": "goal-budget-fixture",
  "nativeGuard": false,
  "physicalResponse": { "provider": "openai-codex", "model": "goal-budget-fixture" }
}
```

实际请求已路由到 Codex，但当前 Fast 不注入 service tier，compact 的 provider-specific hooks 被跳过。

另一真实探针将 virtual model 注册在 `openai-codex/audit-auto`。物理模型第一次返回不支持 priority，第二次手动重试时插件仍发送 priority，且没有降级警告：

```json
{
  "selected": "openai-codex/audit-auto",
  "physical": "goal-budget-fixture",
  "tiers": ["priority", "priority"],
  "fallbackWarnings": 0
}
```

原因是 pending 集合保存 `audit-auto`，message_end 查的是物理模型 ID，两者不匹配。直接选择物理 Codex 模型时，原有拒绝后降级测试仍通过。

只有启用 virtual model 时才触发这些问题，升级不会把所有物理模型自动变成 virtual model。没有验证跨 provider 路由时每种 payload 的行为，也没有把“可能给其他 provider 注入 service tier”报成已复现故障。适配需要请求级物理模型上下文，或在插件中明确限制 virtual model 支持；仅从 payload.model 猜 provider 不可靠。

### OpenAI ChatGPT login is not a legacy provider rename

0.99 的新登录将凭据保存在 `openai` provider，直接调用 `https://api.openai.com/v1`。旧 Codex provider ID 仍为 `openai-codex`，只是展示名改成 legacy。

依据：

- `A/dist/providers/openai.js:8-20` 为 OpenAI 新增独立 OAuth 方法。
- `A/dist/auth/oauth/openai-chatgpt.js:1-6,18-24,278-288` 描述 direct token flow、resource 和 toAuth。凭据含 clientId/scopes，不能假定它就是旧 Codex bearer token。
- `A/dist/providers/openai-codex.js` 保留 `id: "openai-codex"` 与旧 Codex API。
- `extensions/codex-compact/src/native-compaction.ts:153-155` 只接受 provider `openai-codex` 且 API `openai-codex-responses`。
- `extensions/codex-search/src/index.ts:306-319`、`command.ts:452-454` 和 `pi-auth.ts:4,29-30` 只获取 `openai-codex` 凭据和 account id。

离线 credential/runtime 探针仅设置 `openai` OAuth 后，OpenAI 获取凭据成功，legacy Codex 的 getAuth 返回 undefined。实际目录中的 `openai/gpt-6.1-sol` API 为 `openai-responses`，因此原生 Codex guard 返回 false；`openai-codex/gpt-6.1-sol` 则返回 true。

因此，只登录新 OpenAI 路径的用户运行当前 Codex 搜索会收到 legacy Codex 未配置的提示；OpenAI 模型继续采用 Pi 自己的压缩路径，不会自动获得本插件的 Codex 原生压缩。这是新路径支持缺口，不是旧登录失效。保留旧 Codex 认证、继续选择物理 legacy Codex 模型的现有工作流不因显示名改变而失效。

没有用真实新 token 调用旧 Codex endpoint。不能保证把 provider 字符串替换成 `openai` 后协议与权限就兼容。

### Fast allowlist omits new OpenAI models

`extensions/openai-fast-mode/src/config.ts:15-39` 的 OpenAI targets 是静态名单。`payload.ts:35-45` 对 legacy Codex 动态支持所有模型，但 OpenAI 必须命中名单。`config.ts:67-71` 每次加载都会恢复插件的默认 targets，因此不能把手工编辑配置里的 targets 当作稳定补救办法。

离线实测，在 enabled=true 时：

```text
openai/gpt-6.1-sol          -> no service_tier
openai-codex/gpt-6.1-sol    -> service_tier=priority
```

0.99.1 将 legacy Codex 默认改为 GPT-6.1 Sol，不会仅因 ID 新增就失去当前 Fast 支持。Codex 原生压缩也没有该 ID 的静态名单限制，压缩兼容 hash 从目录动态获取，见 `extensions/codex-compact/src/capabilities.ts:45-65`。本轮没有验证远端目录是否对当前 metadataClientVersion 返回该模型的 hash，不能声称真实 GPT-6.1 Sol 压缩已验收。

### Built-in MCP replaces rather than duplicates the current MCP

本仓库 MCP 注册 `/mcp`，导致 0.99 builtin MCP 被整个省略。用 0.99.1 DefaultResourceLoader 加载原仓库 0.87.0 依赖的 src 和 dist，各得到八个仓库插件加 builtin Codemode、tool_search，共十个扩展，零加载错误；builtin MCP 被省略并发出一条 replacement warning。没有启动连接，也没有两套 MCP 同时连接的证据。

但用户不能直接套用 builtin MCP 的配置或示例：

- 当前 extension 选择第一个存在的配置文件；builtin 合并 global 与 trusted project。
- 当前使用 `disabled:true`，builtin 使用 `enabled:false`。当前校验不保留 `enabled`、`exposure`、`toolExposure`、`oauth`。
- 当前 extension 不消费 `pi.getMcpServers()` 和 `mcp_servers_change`，所以新版 `pi.registerMcpServer()` 不会自动建立连接。
- 当前 MCP 工具没有 outputSchema，Codemode 收到的是 text string，不是 builtin 示例使用的完整 CallToolResult 对象。Goal、subagent 工具也需要解析返回的 JSON text。
- `pi mcp` shell commands 始终使用 builtin 实现，不保证与本仓库 `/mcp` 操作同一批连接或配置。

尤其要避免用 `enabled:false` 或 `exposure:"hidden"` 作为本仓库 MCP 的禁用保证，当前代码没有实现这些字段。

配置边界、准确源文件行号与权限检查结果见 [tool compatibility research](pi-0.99-tool-compatibility-research.md#mcp-replacement-and-configuration-boundaries)。

## Verification results

### Baseline and upgraded dependency matrix

临时复制生产源码和现有测试，在副本 node_modules 中仅将宿主相关包指向已安装 0.99.1，其余依赖保持仓库版本。没有修改真实 package.json 或锁文件。

| Verification | Pi 0.87.0 baseline | Pi 0.99.1 isolated copy |
| --- | --- | --- |
| Eight published extensions typecheck | passed | passed |
| Existing Vitest suite | 2622 passed, 13 skipped | 2617 passed, 5 failed, 13 skipped |
| Build and package check | passed | passed |
| Separate codex-search typecheck | passed | 8 context fixture type errors |
| New semantic probes | not applicable | 4 passed |

真实执行 `pnpm run check` 在隔离 TMPDIR 与 PI_CODING_AGENT_DIR 后通过。0.99.1 副本检查使用相同的 TypeScript/Vitest/构建脚本入口，通过 Node 直接执行已有工具；原因是副本执行 `pnpm run` 会根据未修改的清单重新安装 0.87.0，覆盖临时链接，不能把那次检查误算作 0.99.1。

首次非隔离测试出现两个 metadataClientVersion 断言失败，实际请求使用用户配置的 `0.159.1`，测试期待默认 `0.156.0`。隔离 agentDir 后两者均消失。这是测试读取全局配置，不是上游兼容性问题。

### Five failures are test adaptation, not five production faults

1. `extensions/skill-mentions/__tests__/lifecycle.test.ts:69` 两个用例期待第一条 assistant 之前不存在 session file。0.99 在第一条 user 后就落盘，这是官方修复，见 `N/dist/core/session-manager.js:785-807`。测试停在这个旧断言；其他生命周期用例通过。不能据此宣称 skill snapshot 丢失或恢复失败。
2. `extensions/codex-ui/__tests__/tools.test.ts:301` 一项 malformed write 参数的宿主 fallback 期待只有 `write`。新宿主默认展示参数，实际为 `write path="src/new.ts" content=undefined`。现有断言与官方 UI 变化不一致，不表示 write 执行绕过参数校验。
3. `scripts/codex-compact-quality-plugin.mjs:85-88` 在 worker 启动阶段强制 Pi `0.87.0`，另外 `:56` 固定结果版本。两个 quality-plugin 用例因此失败，stderr 明确为 `Installed Pi runtime version mismatch`。这是冻结评估工具的版本限制，不是 native compaction 生产入口失败。
4. 单独 typecheck `codex-search` 时，`__tests__/renderers.test.ts:78,108,128,143,161,204,220,233` 的 mock ExtensionContext 缺少新增 ExtensionToolContext.tools/executeTool。生产插件的 filesystem loader 可以加载，Vitest 中既有 codex-search 测试也通过；应更新测试 context 类型，不必据此改生产 execute 实现。

### Host-only upgrade loading

额外使用新宿主直接加载原仓库入口，不替换原仓库依赖：

```text
0.99.1 host + repository 0.87.0 dependencies + source entries -> 0 load errors
0.99.1 host + repository 0.87.0 dependencies + dist entries   -> 0 load errors
0.99.1 host + standalone codex-search source                -> 0 load errors
```

这是加载与注册验证，不等于所有功能已做新宿主端到端验收。13 个默认跳过的真实 tmux/隔离生产测试仍未执行；没有运行全部真实 TUI/PTY 场景。

## Unaffected contracts and remaining risks

- 没有发现 session projection、native checkpoint replay 或物理 legacy Codex 的 request conversion 契约变更。0.99.1 新增 provider stream event 和未完成 tool call 校验；本仓库已有正常 Responses fixtures、压缩前缀与恢复测试通过。
- Bash 的非零 exit 现在可返回 isError:true 和 structuredContent，而不是仅 throw。codex-ui 透传完整基础定义和结果，没有基于 throw 才判断错误的执行包装；本轮未发现 Bash 状态因此丢失。
- Theme.fg/bg/getFgAnsi/getColorMode 与本仓库使用的主题接口保留；codex-pi 主题验证通过。codex-ui session_start 主动切换 codex-pi，因此用户不会仅因宿主默认 system theme 改变就看到 system 配色，这是现有插件行为。
- Nested tool calls 仍经过 permissions 的实际 tool_call gate，不是 Codemode 权限绕过。
- subagent 的 prompt 派发通过 tmux 与自身 delivery receipt，不依赖 RpcClient.prompt 的新 disposition 返回值，没有发现该 SDK/RPC 返回类型改变会破坏现有派发。
- subagent_read 当前不展开 nestedCalls，只能展示外层 Codemode 活动；nested result 全文也不在上游记录中，不能承诺仅加 parser 就能恢复。
- Goal 的 loop detector 与 nested update_goal completion batch 交互、virtual model 在子进程中的注册继承，没有完整回归验证。本轮仅登记待测，不认定已经出错。

## Evidence files

以下临时记录均位于仓库内，未包含用户凭据或真实模型请求内容。

```text
.scratch/pi-0.99-audit/baseline-isolated-check.log
.scratch/pi-0.99-audit/new-typecheck.log
.scratch/pi-0.99-audit/new-isolated-tests.log
.scratch/pi-0.99-audit/search-baseline-typecheck.log
.scratch/pi-0.99-audit/semantic-probes.log
.scratch/pi-0.99-audit/virtual-fallback.log
.scratch/pi-0.99-audit/mixed-host-load.mjs
.scratch/pi-0.99-audit/mixed-host-load.log
.scratch/pi-0.99-audit/workspace/extensions/openai-fast-mode/__tests__/pi-099-audit.test.ts
.scratch/pi-0.99-audit/workspace/extensions/openai-fast-mode/__tests__/pi-099-virtual-fallback.test.ts
```

没有提交、推送、发布或部署。现有进程没有被重启。测试中的本地服务器和 worker 由测试清理；研究 subagent 在结果收齐后关闭。
