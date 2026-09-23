# Fast planning evidence

## Scope

本记录为 [Planning #36](https://github.com/wangxuyang1221/pi-ext/issues/36) 提供实现前证据，不代表候选方案已通过运行验收。

## Shared configuration writes

[Fast extension](../../../extensions/openai-fast-mode/src/index.ts) 在 loadForContext、--fast、/fast 和 session_shutdown 保存配置。Pi reload 会触发 shutdown，因此 child 隔离须覆盖整个生命周期，不能只把独立值加到启动参数。

[payload](../../../extensions/openai-fast-mode/src/payload.ts) 基于 config.enabled、模型支持情况和当前会话排除列表决定是否注入 service_tier。Fast 开关与模型实际是否支持 Fast 不是同一个状态，父子继承应读取开关值，不能从 footer 是否显示 fast 推断。

## Session state interface

通过 Context7 查询 [官方扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，appendEntry 用于不进入模型上下文的自定义会话状态，session_start 可从 sessionManager 读取。文档来自 main，已对主工作区安装的 Pi 0.87.0 发布源码进行交叉核验：

- dist/core/agent-session.js 将 appendEntry 转交给 sessionManager.appendCustomEntry。
- dist/core/session-manager.js 的 appendCustomEntry 添加 custom entry；_persist 在尚无 assistant 且尚未 flushed 时延迟写入。
- 因此存在 custom entry 接口不能单独证明首次回复前设置一定落盘。该条件已通过下方实验进一步核验。普通新会话仍延迟写入，但既有 managed child 所用的预创建空文件路径会先写 header 并设置 flushed，因此后续 custom entry 可在首次回复前立即落盘。

## Implementation implications

可沿用现有 launch 元数据传递初始解析值。会话内开关采用 custom entry 保存的方向已获得下方实验支持；实现仍须覆盖首次回复前的切换和退出，以及真正 managed child 的 reload/resume。

## Session persistence probe

运行 [session-state.mjs](../experiments/session-state.mjs)，使用主工作区实际安装的 Pi 0.87.0。命令为：

```sh
node adventure/32/experiments/session-state.mjs /Users/wangxuyang/Code/t3code/pi-ext/node_modules/@earendil-works/pi-coding-agent
```

结果通过：普通新 session 首次 custom entry 不立即创建文件；预创建空 session 文件并打开后，true 和 false 两次 custom entry 在没有模型回复时已写入 JSONL；重新打开恢复最后值 false；buildSessionContext().messages 为空。

该证据支持采用 custom entry 保存既有 managed child 会话的 Fast 状态。它不覆盖真正 tmux child、Fast 扩展恢复、reload 或父子请求隔离，后者仍待集成验证。实验所有临时文件位于 worktree 内的 .scratch，结束后已删除；未启动服务、未请求模型。

产品代码尚未修改。

## Provider matching and failure detection

当前代码没有实时能力查询，也没有启动前 Fast 探测请求。[payload.ts](../../../extensions/openai-fast-mode/src/payload.ts) 对 openai 精确匹配本地模型名单，对 openai-codex 模型默认尝试注入 priority，其他 provider 不注入。未匹配本地规则不构成模型真实不支持的证据。

[index.ts](../../../extensions/openai-fast-mode/src/index.ts) 只对已经尝试 Fast 的 openai-codex 错误识别 unsupported_service_tier、fast_mode_unsupported 等标识，或同时包含 Fast/service tier 与明确不支持含义的文本。当前失败保持失败并提示，后续对本会话的该模型停止注入，不自动重放。其他错误不改变开关。UI fast 表示请求意图，扩展没有校验服务端最终采用的 tier。

## Cross-extension integration

项目 [subagent usage](../../../extensions/subagent/src/usage.ts) 与 [subagent entry](../../../extensions/subagent/src/index.ts) 已使用 pi.events 传递带 promises 数组的请求，并在调用方等待结果。Pi 0.87.0 的 dist/core/event-bus.js 采用 EventEmitter；emit 本身不等待异步订阅者。因此查询 Fast 当前开关时需要显式收集或等待回复，不可把 emit 当成异步 RPC。

父进程解析初始值后可沿用 manager.launch 的受控环境与 launch 元数据传递；child 在首次 provider 请求前完成恢复，且 load/command/shutdown 不保存共享配置。各扩展具有独立 tsconfig rootDir，优先使用明确的小型事件/环境契约，避免直接跨扩展导入源码导致构建范围扩张。

现有 host-compatibility 测试使用真实 Pi 会话和离线 provider 记录 before_provider_request payload；production-integration 使用隔离 tmux 和完整包启动实际 child。实施应复用这些路径，记录最终 payload、工具目录、生命周期状态及共享配置字节，不能仅由参数断言推导整体通过。以上测试设施仅在本轮阅读，未执行。

## Built-in provider origin

用户追问 openai 的来源。主工作区 @earendil-works/pi-ai 的 package.json 显示 0.87.0，其 dist/providers/openai.js 的 openaiProvider() 定义 id=openai，默认 baseUrl 为 https://api.openai.com/v1，使用 API key auth，环境变量为 OPENAI_API_KEY。同包 dist/providers/openai-codex.js 的 openaiCodexProvider() 定义 id=openai-codex，默认 baseUrl 为 https://chatgpt.com/backend-api，使用标记为订阅方式的 OAuth。

这些是 Pi 自带的 provider，Fast 扩展没有新增它们，而是读取模型的 provider 字段进行匹配。默认地址与认证描述以所查 Pi 0.87.0 源码为准，不表示用户不能通过自定义配置覆盖 provider。Context7 的 [Pi provider 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) 和 [pi-ai README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md) 提供旁证；未读取用户凭证。
