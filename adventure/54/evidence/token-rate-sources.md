# Token rate sources

## Scope change

用户将冒险扩展为实际给 codex-ui 添加 Working 动画和 token 速率，显示位置待定。现有局部刷新机制和降 CPU 目标保留，正文渲染优化仍不在范围。旧两关实施草案已暂停，未派发 worker。

统计口径由 [Planning #58](https://github.com/wangxuyang1221/pi-ext/issues/58) 确定；位置与生命周期由 [Planning #59](https://github.com/wangxuyang1221/pi-ext/issues/59) 确定。

## Confirmed decision

用户接受缺少准确 token 计数时进行实时估算，并用 `≈` 标识，例如 `≈102 t/s`。采用最近约 2 秒的输出速率，不使用当前模型响应的累计平均速率。计入模型实际传来的正文、可见思考片段和工具调用参数；不计输入、工具执行结果，不推算未传出的隐藏思考。估算算法尚未确定。

已确认：运行未结束，但尚未收到可计数内容或约 2 秒窗口内已无新片段时显示 `-- t/s`，保留位置、表明暂无数据，不显示 `0 t/s`。最终结束时是否保留显示归属后续生命周期设计。

## Inspected sources

以下为本工作区实际安装的 Pi 1.4.0，未进行联网模型请求：

- coding-agent `dist/core/extensions/types.d.ts`：message_update 暴露 assistantMessageEvent；agent_settled 表示自动重试、压缩或排队续接全部结束后的收敛点。
- pi-ai `dist/types.d.ts`：text_delta、thinking_delta、toolcall_delta 携带字符串片段，不承诺每个事件或每段字符串恰好一个 token。partial 为共享的当前响应对象，不是事件发生时的不可变快照。
- pi-ai `dist/api/openai-responses-shared.js`：普通增量追加正文、思考或工具参数；在 response.completed/response.incomplete 调用 finalizeResponse，从 response.usage 更新 output 等计数。Codex Responses 复用该处理器；初始 usage 为零不能解释为已经获得准确的实时计数。
- pi-ai `dist/api/anthropic-messages.js`：仅在 message_start/message_delta 提供 usage 时更新，不能假定所有内容片段都携带 token 计数。
- Usage.output 已包含 reasoning 子集，不能把 output + reasoning 当作总输出。输入和缓存 token 不应未经定义混入生成速率。
- AssistantMessage.durationMs 是完成后从请求开始测量的单调时长，旧消息和部分延后结果可缺失。它能支持最终平均统计，不直接提供短窗口实时速率。
- pi-ai `dist/utils/estimate.js` 的 estimateTextTokens 使用字符长度除以 3.5。这是现成粗估，不证明中文、代码或不同模型的 token 精度，尚未选作正式方法。
- codex-ui [terminal-title.ts](../../../extensions/codex-ui/src/terminal-title.ts) 已在 agent_start 启动标题动画、agent_settled 停止，并处理压缩和退出；agent_end 可能先于后续自动工作，不能直接作为所有动画的结束点。
- codex-ui [index.ts](../../../extensions/codex-ui/src/index.ts) 当前隐藏原生 Working，安装自定义 [footer](../../../extensions/codex-ui/src/footer.ts)。新增功能需明确替换或组合，不叠加两条相同提示。

## Implications

- 不能承诺所有 provider 都提供实时准确 token 计数，也不能用 delta 次数冒充 token 数。
- 隐藏思考不一定有可见流式内容；可见 thinking 也可能只是摘要。不能从未收到的文本推算出准确隐藏 token 速率。
- 准确的最终 usage、用户感知的近期传输速率、从请求开始的平均输出速率是不同量，界面需保持口径一致，不能静默互换。
- 若使用窗口估算，按新 delta 增量维护计数并淘汰窗口外样本；避免每个事件重新分词或扫描完整历史/完整响应，使采集本身抵消渲染节省。
- 工具参数在 toolcall_start 时可能已有内容，结束事件也可能补齐内容；只监听 toolcall_delta 可能漏计，而把 start/delta/end 全文分别相加会重复计数。实现需按响应和内容块识别新增量，不把共享 partial 当作历史快照，不计思考签名等非可见负载。
- 请求切换、重试、工具等待、用户阻塞交互、压缩、会话切换与退出的速率/动画行为尚未确定。未收到可计数内容不自动等同于生成速度为零。

## Verification status

源码核验之外，新增 [窗口实验](../experiments/token-window.mjs) 与 [结果](token-window.json)。通过真实 AssistantMessageEventStream 队列发送受控事件，验证正文/思考/工具参数聚合、共享 partial 不被重复计数、分片数量不影响估计值、两秒过期、新响应重置和旧回调隔离、无 delta 的完整工具参数只计一次、排除脱敏负载和工具结果，以及 100000 次更新后采样仍为固定 20 桶。

夹具使用字符数/3.5，并在窗口聚合后换算，不逐片段取整。它证明低成本有界采样可行，不证明这种粗估与具体模型 tokenizer 等价。100ms 时间桶使窗口边界有至多约 100ms 的量化差异。正式实现可以选择满足同一含义和 CPU 约束的估算方法，须说明精度边界，不每帧重新扫描或分词完整历史/响应。

尚未验证所有 provider 的完整事件组合、缺失尾部补齐、任意重放或扩展/会话生命周期，也未做联网实流测试。未创建产品代码或 UI 原型。以上缺口归属新增功能的实施和最终组合验收，不把夹具通过当成生产正确性已通过。
