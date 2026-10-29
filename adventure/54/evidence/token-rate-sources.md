# Token rate sources

## Scope change

用户将冒险扩展为实际给 codex-ui 添加 Working 动画和 token 速率，显示位置待定。现有局部刷新机制和降 CPU 目标保留，正文渲染优化仍不在范围。旧两关实施草案已暂停，未派发 worker。

统计口径由 [Planning #58](https://github.com/wangxuyang1221/pi-ext/issues/58) 确定；位置与生命周期由 [Planning #59](https://github.com/wangxuyang1221/pi-ext/issues/59) 确定。

## Confirmed decision

用户接受缺少准确 token 计数时进行实时估算，并用 `≈` 标识，例如 `≈102 t/s`。采用最近约 2 秒的输出速率，不使用当前模型响应的累计平均速率。计入模型实际传来的正文、可见思考片段和工具调用参数；不计输入、工具执行结果，不推算未传出的隐藏思考。估算算法尚未确定。

当前等待用户选择运行未结束但窗口内无可计数内容时显示 `-- t/s`，或暂时隐藏速率。推荐 `-- t/s` 保留位置、表明暂无数据；尚未确认。最终结束时是否保留显示归属后续生命周期设计。

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

以上为源码和类型核验，不是所有 provider 的实流测试。未创建产品代码、UI 原型、token 估算算法或性能承诺。正式统计与显示的组合验证应在新切片中明确输入来自哪类真实事件，以及用哪些受控流和必要的真实集成证明行为。
