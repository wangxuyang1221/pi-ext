# Pi goal provider gate probe

## Status

历史替代调度候选，未接入产品。用户随后确认 C11，接受原 ctx.abort 路线清除其他扩展排队消息、把用户追加消息退回编辑器的副作用，决定不采用本检查层。#6 按更新后的规格恢复实施，以下保留研究证据，不再作为待确认或待实施方案。

此前真实 TUI 反例见 `docs/goal-scheduling-blocker.md`。`ctx.abort()` 会通过 TUI 清空其他扩展的队列；只过滤失效提醒仍会调用一次模型。本实验仅验证能否在公开 provider 接口上结束失效请求而不调用 `ctx.abort()`，不证明整个调度器已经可用。

## Candidate

通过 `ctx.modelRegistry.getProvider(id)` 获取现有 provider，再通过公开 `pi.registerProvider(provider)` 包装其 stream/streamSimple。正常请求原样委托，保留 auth、模型目录、refresh、过滤策略及其他能力，不另设网络代理或复制 OAuth 实现。

失效自有提醒在本次 context 中换成一次性随机取消标记。包装层消费当前请求的标记，返回内容为空的 `aborted` 流，不调用底层 provider，不触发 TUI abort。不能用一个共享布尔值代表下一请求，避免其他模型请求消费错误的取消状态。原型校验每次委托的上下文不含内部标记。

这个 aborted 结果是本地控制事件，不是模型生成的成功回复，也不是网络用量；Pi 仍会生成内部 assistant/turn/end 事件和会话记录。正式实现必须识别该事件，不计为用户中断、执行失败轮或收费请求；不承诺隐藏所有原生取消显示。

## Evidence

环境：macOS，Node 22.22.2，pnpm 11.9.0，Pi 0.84.3 与 0.85.1。使用真实 PTY 和原装 InteractiveMode，faux 模型；全局 fetch 禁用且实际网络尝试为 0。所有 agent/session/证据目录均注入仓库内位置。

| Scenario | 0.84.3 | 0.85.1 |
| --- | --- | --- |
| 失效 goal 后排有其他扩展消息 | 2 次底层 provider 调用，1 次本地取消，其他消息执行 | 相同 |
| context 等待期间真实键盘 Alt+Enter 输入 | 3 次底层调用，分别为初始、其他扩展、用户；1 次本地取消 | 相同 |
| 用户 follow-up 保留 | 进入模型上下文，编辑器为空，不退回用户输入 | 相同 |
| Codex provider 包装及注销的模型目录 | 原有 7 个模型一致 | 原有 8 个模型一致 |
| Codex OAuth 方法引用 | login/refresh/toAuth 保留，未实际登录或刷新凭据 | 相同 |
| TUI abort 次数、网络尝试 | 均为 0 | 均为 0 |

最终基线检查 `pnpm run check` 通过：828 tests passed，1 个既有 skipped，类型、构建及发布包检查通过。产品源码未修改。

复现脚本：`prototypes/goal-provider-gate-probe/probe.mjs` 与 `driver.py`。本地证据 `.scratch/goal-provider-gate/`。关键目录为 `meta-final-0843`、`meta-final-0851`、`typed-0843`、`typed-0851`。目录内保存 events.jsonl、真实会话、terminal.ansi；check.log 保存完整检查结果。早期单布尔值试验 `first-0843` 只作探索记录，不是推荐请求归属方案。

```bash
GOAL_PROBE_ASSERT_PROTECTION=1 GOAL_PROBE_CODEX_META=1 \
  conda run -n codex-py312 python prototypes/goal-provider-gate-probe/driver.py \
  .scratch/goal-provider-gate/reproduce-meta node_modules/@earendil-works/pi-coding-agent

GOAL_PROBE_ASSERT_PROTECTION=1 GOAL_PROBE_TYPED=1 \
  conda run -n codex-py312 python prototypes/goal-provider-gate-probe/driver.py \
  .scratch/goal-provider-gate/reproduce-typed node_modules/@earendil-works/pi-coding-agent
```

每次传入新的证据目录；旧目录不可重复。第二个参数可换为 0.85.1 的已安装 package root，路径见 blocker 报告。

## Ownership and limits

这不是纯事件订阅方案。goal 需要介入 OpenAI Codex provider 的注册与请求转发，不能声称与任意同样覆盖该 provider 的扩展自动兼容。

实际源码 `ModelRuntime.registerNativeProvider()` 会删除同 id 的 legacy extension config，使用新的 native provider 作为组合基础；`unregisterProvider()` 恢复内建及 models.json 行为，而不是自动恢复另一扩展的旧注册。包装有效 provider 可以保留当时行为，但不能解决后续注册覆盖、热重载叠层、撤销时覆盖他人新注册的归属问题。

因此实施前须确认是否接受 provider 检查层这一设计，实施中必须明确安装/撤销归属、防止重复包装、保护他人的后续注册。检测不兼容时停止自动 goal 并给出提示，不能无条件注销覆盖别人，也不能偷偷恢复到有丢消息风险的 ctx.abort 路线。

未通过本实验的事项：真实 Codex HTTP/OAuth/usage、models.json 叠加配置完整矩阵、另一个 provider 覆盖插件共存、reload/new/fork 后包装生命周期、多个并行摘要或请求的归属、末端模型切换、标记被其他 context 插件变换、取消发生在 provider 已委托后、重试/压缩完整矩阵、真实 Esc/取消弹窗，以及工具/完整 turn 审计。上述内容仍由 #6、#7、#10 的相应验收负责，不能把此窄实验当作 V1 完成。

后续方案应在发起自动请求前确认支持的 provider 与包装能力，在 context 及 provider 发起实际请求之前验证 request/owner/goal/generation。正常用户与其他扩展请求不得因 goal 停止状态被取消；已开始的模型回合与尚未发出的自动请求分开处理。关键归属假设若不成立，仍回到 #2，不能降低输入保护要求。

## Sources

Context7 `/earendil-works/pi` 只给出 main，未提供 0.84.3/0.85.1 固定版本索引；具体依据为这两个已安装版本的官方文档、类型、源码及上述实际运行。

- `docs/custom-provider.md` 和 `docs/extensions.md`：完整 Provider 注册、公开 getProvider、stream/streamSimple。
- `dist/core/model-runtime.js`：registerNativeProvider、unregisterProvider 与 provider 组合。
- `dist/core/agent-session.js`：post-agent-run 检查队列并继续。
- `pi-ai/dist/models.d.ts`：Provider 的 auth/模型/stream 契约。
- [Pi 0.84.3 固定源码](https://github.com/earendil-works/pi/tree/4e58f324fae8ebfa98a3d45181fb248072a2afac)
- [Pi 0.85.1 固定源码](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477)

## Next move

用户已明确选择接受原方案的队列副作用，C11 取代本节此前的检查层提案。按 `pi-goal-spec.md` 当前 Scheduling contract 恢复原 #6 worker，保留本报告及实验，不实现 provider 包装。
