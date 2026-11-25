# Working animation and receive rate

## User behavior

codex-ui 在输入框上方显示青色十帧转圈、静态粗体 `Working` 文本和计时。转圈每 80ms 一帧，并与 footer 速率轮询共用一个 80ms 相位对齐调度器（在 100ms 采样桶基础上按 80ms 节拍检查速率变化）。`codex-pi` 主题的 accent 为 `#7fd4e6`，`Working` 文本使用主题 `text` 前景色加粗。32、40、100 列保留计时与 footer 右侧速率；小于 40 列省略中断提示，更窄时按显示列截断。

任务从 `agent_start` 持续到 `agent_settled`。工具执行、自动重试、自动压缩以及工具和输入对话框等待期间继续动画。按下 Esc 后，宿主完成取消才隐藏；`agent_end` 不停止动画。idle 时打开对话框不会启动它。结束后速率也隐藏，footer 恢复可用宽度，中性状态后续行保持原有宽度。原生 Working 行继续隐藏，标题动画保持原有行为。

## Rate meaning

`≈102 t/s` 是最近约两秒收到的可见模型输出的估算速率。计入正文、传来的可见 thinking 及工具调用参数，排除用户输入、工具执行结果、签名、redacted thinking 和未传出的隐藏思考。此数值不表示模型服务端吞吐，也不替代账单 usage。

估算将正文和 thinking 的 UTF-16 单元数除以 4；工具参数先按 JSON 字符流计量，字符串外空白不计、转义合并为解码后的单元，再除以 4。JSON 引号、结构符号、数字和布尔值仍计入。计量只按新增片段推进，不把片段数量当 token，也不逐片段取整。因此同一内容改变分片方式不会改变估算。该方法没有模型 tokenizer 的精度保证，中文、emoji、代码和不同词表可能有明显偏差。JSON 数字的不同合法写法也可能有少量估算差异。

窗口为 20 个 100ms 桶，分母始终是两秒；冷启动自然爬升。桶边界可能使样本提前不到 100ms 过期。时钟使用 `performance.now()`。没有有效样本显示 `-- t/s`，小于一个 token/s 时显示一位小数，避免把非零样本写成 0。响应结束的 usage 不进入这条统计。

## Event and resource ownership

采样按每次 assistant 响应重置，Working 按整个任务存续。正常 provider 的共享 content 数组用于响应识别；固定 faux provider 每块替换数组并在最终消息中重建内容，因此同时使用其响应内保持的 usage 对象身份。已经见过的旧数组不会重新绑定，结束后的更新无效。这里使用对象身份，不按 timestamp 或字符串内容猜测响应归属。

start 事件引用的 partial 可能已经被后续生产者修改，不能把它当作 start 时的快照。采样立即计入 delta，在块结束及最终消息时补齐缺失部分；无 delta 的完整内容在结束时计入一次。工具参数最终 JSON 只处理一次。正文/思考用长度差补齐，工具参数用归一化计量差补齐，不重复计入已经传来的内容。

保存 20 个时间桶、当前响应各内容块的数字计数及增量 JSON 状态，不保存文本片段或历史消息副本。一次 final 遍历本响应的内容块；delta 和动画帧不重扫完整响应。响应结束清空块状态，身份集合使用弱引用，不延长消息寿命。session replacement、reload、shutdown 释放旧调度器和所有区域句柄，过期调度回调检查 generation 后退出。

## Rendering

Working 与 CodexFooter 通过 widget 和 footer factory 挂载。动画帧或速率标签变化时，同一个 TUI 只请求一次刷新。

footer 的上下文比例按只追加的会话分支读取。会话管理器、叶节点、模型或 contextWindow 改变时重新调用宿主统计；其余动画帧复用结果，避免每 80ms 重建未变化的历史投影。追加消息、context edit、分支切换和压缩都会改变该版本。每次 footer 安装单独持有一个结果，没有跨会话缓存。`pi-virtual` 路由的实际模型上限还依赖 live agent messages，因此保持实时 getter；缺少分支版本接口时也正常读取。

## Verification

采样与生命周期快速验证通过仓库隔离入口运行：

```bash
pnpm test extensions/codex-ui/__tests__/token-rate.test.ts extensions/codex-ui/__tests__/token-rate-provider.test.ts extensions/codex-ui/__tests__/json-units.test.ts extensions/codex-ui/__tests__/working.test.ts extensions/codex-ui/__tests__/working-session.test.ts
```

普通与全屏终端的真实工具、取消、重试和会话切换验收见 [Working 旅程](../.cursor/skills/verify-pi-codex-ui/features/working.md)。
