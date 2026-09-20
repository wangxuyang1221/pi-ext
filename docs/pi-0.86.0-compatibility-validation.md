# Pi 0.86.0 Compatibility Validation

## Scope

2026-09-20 在 macOS、Node.js 22.22.2、pnpm 11.9.0 下，将 Pi AI、Coding Agent、TUI 的开发依赖、peer 依赖与锁文件统一到 0.86.0。当前支持范围明确为该宿主版本；恢复旧版本创建的会话不等于继续支持旧宿主。

CI 通过冻结锁文件安装依赖，原有 Node 22.19.0 和三个操作系统的配置无需改动。本轮未在 Linux、Windows 或 Node 22.19.0 上实际运行 CI，不将这些平台记为已验证。pnpm 自动生成的 `pnpm-workspace.yaml` 只为本次指定的六个 Pi 0.86.0 包增加发布日期例外。

## Sources

- [Pi 0.86.0 changelog](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/CHANGELOG.md)：逐项检查 0.84.4、0.85.0、0.85.1、0.86.0 的接口与行为变化。
- [Transcript change](https://github.com/earendil-works/pi/commit/9e05370b298d0a6b8d9bc2c02e4bfae189ef1616)：提示和工具变化进入历史。
- [Responses conversion](https://github.com/earendil-works/pi/blob/v0.86.0/packages/ai/src/api/openai-responses-shared.ts) 与本机安装的 0.86.0 源码：对照消息、工具声明、strict schema、grammar、ID 和推理设置。
- [Node 22.19 module API](https://nodejs.org/download/release/v22.19.0/docs/api/module.html#modulefindpackagejsonspecifier-base)：核验公开包解析 API 在最低 Node 版本中的可用性。

Context7 未覆盖所需版本的具体转换细节，本次以固定 tag 和安装包源码为依据。

## Changes

- 压缩历史重建使用公开 transcript helpers，保留 system sections、工具增删及其顺序。工具格式复用 SDK 公开的 Responses converter，避免另写 strict schema 与 grammar 转换。
- 文件扩展加载器会将直接 `pi-ai/api/*` 导入错误拼接到 `compat.js` 后。`pi-responses.ts` 通过 Node 解析包的公开 `exports`，不修改宿主、不注入内部补丁；源码和构建产物均经过真实宿主加载。
- checkpoint 后的转换先考虑完整历史中的声明状态和消息位置，再截取保留的输出。直接从截断历史开始会把第一条 system 更新误当作开头提示，也可能改变消息 ID。
- 0.86.0 不再根据旧 `toolResult.addedToolNames` 生成加载项。插件跟随目标宿主语义，已保存的 checkpoint 声明保持不变。
- 历史前缀校验继续拒绝不一致请求。失败记录增加 `history_prefix_mismatch`、错误类型和不一致位置，不记录正文、认证或 encrypted content。
- 压缩请求的 thinking off 对齐宿主，按模型映射发送 effort，默认 `none`。模型切换测试改用仍在目标版本目录中的模型。
- 用户 Markdown 不再注入 `›`，原文、背景、首块语义和缓存行为保持不变。Write 返回文本和历史重建测试跟随目标 SDK 的实际行为。
- provider 测试改用 `normalizeContext`。质量工具、goal accounting 和性能报告的版本约束更新为 0.86.0。goal 集成脚本改用非持久会话验证不支持的场景，当前 goal 本来就支持不同 provider，不能继续把 faux provider 当作拒绝条件。

## Extension Audit

| Extension | Affected boundary | Evidence |
| --- | --- | --- |
| codex-compact | Transcript、checkpoint、工具声明、thinking off、模型目录、取消与重试 | 上游 payload 对照、连续请求与失败 marker、脱敏诊断、真实 loader、只读事故重放、完整 compact suites |
| codex-ui | Markdown、工具输出文本、历史重建、working indicator | 完整渲染行与高度、三种窗口宽度、原生 UserMessageComponent、真实 SDK reload 与 execution-settings、分组与缓存 tests |
| openai-fast-mode | before_provider_request 的实际 payload | 真实 SDK 会话和 Codex adapter 的离线请求验证 priority tier，另有配置、切换与状态 suites |
| permissions | tool_call 允许与拒绝 | 真实 SDK 会话验证允许执行一次、拒绝不执行并保存错误结果；原有精确命令/路径授权 tests |
| mcp | 工具动态注册、历史、HTTP/stdio、模式隔离 | transport、history-host、history-handoff、pi-modes-smoke 等全仓 suites；缺失原型源码的 suite 单列为基线缺口 |
| subagent | provider 输入、Pi CLI、tmux、会话读取、取消和清理 | 归一化 provider payload、runtime-integration、真实 Pi 加隔离 tmux、scope-performance 和历史读取 suites |
| goal | usage、事件顺序、会话恢复、分支与 provider | 74 个真实 SDK 离线 accounting 场景、288 次请求；整包发现、暂停、恢复、fork、reload、预算和内容编辑集成脚本 |

上游新增 `user_bash` fail-closed、`pi.on()` unsubscribe 和工具参数限制也在审查范围内。上述扩展没有依赖旧 `user_bash` 返回值，不依赖 `pi.on()` 原先的空返回值，注册工具已有参数 schema。无需为这些变化修改生产代码。

## Regression Evidence

- UI：完整渲染测试先出现 2 项预期失败，精确检出额外 marker 与空白行；修复后通过，覆盖空文本、自带 marker、窄窗换行、首块 Markdown 和缓存。
- 压缩：system 更新加工具完成后的测试先复现原错误；新增紧邻 checkpoint 的连续请求测试再次暴露边界问题，修复后通过。矩阵覆盖提示单独更新、工具单独更新、组合更新、删除/重定义、additional tools、tool search、grammar、strict schema、折叠 system 的模型和失败用户重试。
- 诊断：不匹配请求测试先缺少错误类别与位置，修复后通过；实际扩展失败 marker 的测试确认仅保存结构信息。
- 成本：每次转换只按历史和声明执行有限次数线性遍历，没有为每条消息重复扫描全量历史。checkpoint 输出仍需遍历旧历史以保持声明状态和 ID；中间数据随历史规模增长。10/100 条历史的对照测试检查同一请求不重复重建相同 raw view，UI 测试检查不重新转换未变化历史。
- 事故重放：493、495、497、499、502 行对应的五个分支全部成功；497 分支完整重建与目标输入无差异，`firstDifference = -1`。没有模型网络请求、认证读取或原会话写入。

重放使用 `.tmp/codex-compact-incident/replay-086.mjs`。原脚本保留不动；新副本只跑目标版本，并将 `toolOptions` 对齐真实 Codex `buildRequestBody` 的 `strict: null` 和 grammar 设置。旧脚本未指定该参数，SDK 通用 converter 默认值是 `false`，不能用它验证修复后的完整工具格式。升级后仓库导入已不是旧 converter，也不能继续把它标成 0.84.3 对照。原始 wire payload 未留存，因此本轮仍是受控离线重放，不声称完成服务端重放。

## Validation Results

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 通过，三个 Pi 包实际安装版本均为 0.86.0，开发和 peer 声明均为精确版本 |
| `PI_SUBAGENT_ISOLATED_INTEGRATION=1 pnpm run check` | 类型检查通过；140 个测试文件通过，1 个收集失败，1 个跳过；1941 项通过、1 项跳过。因基线收集错误退出，不能标为全绿 |
| `pnpm run build` | 单独执行通过，包含全部七个扩展及媒体资源校验 |
| `pnpm run package:check` | 单独执行失败，首个缺失为既有清单引用的 `docs/goal-descendant-acceptance.md` |
| `node extensions/goal/__tests__/accounting-runtime.mjs` | 74 个场景、288 次离线请求通过，真实 0.86.0 SDK 与 adapter |
| `integration-runtime.mjs` | 整包实际发现、构建产物加载、恢复、暂停、fork、reload、预算与内容编辑通过，无外部模型请求 |
| 事故只读重放 | 五个分支全部通过，完整重建无差异，零模型请求、零原会话写入 |
| 进程与端口清理 | 隔离 tmux 与生产入口用例均确认 `livePids: []`、socket 不可用；HTTP suites 通过关闭/取消后的资源检查；末次进程审计没有任务残留 |
| `git diff --check` | 通过 |

唯一跳过的测试为依赖真实模型的 `extensions/subagent/__tests__/integration.test.ts`。原先默认跳过的隔离和生产入口共四个场景已在最终全仓运行中启用并通过。

日志位于被 git 忽略的 `.tmp/pi-086-validation/`，不包含原始会话正文。已有测试失败时遗留的本任务临时目录已清理；未启动供用户长期使用的服务，未提交或推送。

## Baseline Exceptions

升级前的沙箱内检查为 127 个文件通过、9 个失败、3 个跳过；1902 项通过、23 项失败、5 项跳过。失败包含禁止监听本地端口、子进程/tmux 限制、goal 的两个 child report 用例和缺失的 MCP 原型模块。解除执行环境限制后，未修改 goal 生产代码、tmux 生产代码或这些用例，它们均通过。不能沿用交接记录的 133 项 goal 失败作为本轮结果。

两项仓库缺失与本次升级无关，未通过跳过检查或伪造文件隐藏：

- `extensions/mcp/__tests__/status-ui-prototype.test.ts` 引用的 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 不存在。升级前即收集失败，MCP 生产路径的其余 tests 可以运行。
- 发布检查要求的 `docs/goal-descendant-acceptance.md` 不存在。进一步核对发现，发布清单共引用 13 个缺失文档，且全部已存在于修改前 HEAD 的清单中：`subagent-runtime-reliability.md`、`subagent-runtime-reliability-acceptance.md`、`tool-status-acceptance.md`、`goal-provider-support.md`、`goal-footer-acceptance.md`、`goal-descendant-acceptance.md`、`goal-ui-acceptance.md`、`goal-integration-acceptance.md`、`goal-parity-acceptance.md`、`goal-storage-acceptance.md`、`goal-lifecycle-acceptance.md`、`goal-execution-report.md`、`goal-budget-acceptance.md`，均位于 `docs/`。本次没有伪造验收文档或删除发布校验。

未执行付费模型流量、真实外部 MCP 服务或用户原会话的写入式验收。跨平台 CI、外部服务连通性和其他 Pi 版本不在本轮已验证声明内。
