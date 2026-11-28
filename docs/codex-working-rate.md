# Working animation and receive rate

## User behavior

codex-ui 在输入框上方显示青色十帧转圈、静态粗体 `Working` 文本和计时。转圈每 80ms 一帧，并与 footer 速率轮询共用一个 80ms 相位对齐调度器。`codex-pi` 主题的 accent 为 `#7fd4e6`，`Working` 文本使用主题 `text` 前景色加粗。32、40、100 列保留计时与 footer 右侧 12 列固定槽位（10 列标签加左右各 1 列空格）；小于 40 列省略中断提示，更窄时按显示列截断。

任务从 `agent_start` 持续到 `agent_settled`。工具执行、自动重试、自动压缩以及工具和输入对话框等待期间继续动画。按下 Esc 后，宿主完成取消才隐藏；`agent_end` 不停止动画。idle 时打开对话框不会启动它。结束后速率也隐藏，footer 恢复可用宽度，中性状态后续行保持原有宽度。原生 Working 行继续隐藏，标题动画保持原有行为。

## Rate meaning

footer 右侧的单一指标表示**最近一段连续输出中，Pi 实际收到的可见模型输出速率**。计入正文、传来的可见 thinking 及规范化工具调用参数，排除用户输入、工具执行结果、签名、redacted thinking 和未传出的隐藏思考。此数值不表示模型服务端吞吐，也不替代账单 usage，因此始终带有 `≈` 前缀。

估算器以整数 milli-tokens（`1000 = 1 token`）对解码后的 Unicode 标量分类计权：ASCII 字母 `0.24`、ASCII 数字 `0.34`、内容空白（含换行）`0.12`、其余 ASCII 符号与结构符 `0.45`、CJK（汉字/假名/韩文）`0.80`、其余 Unicode 按 UTF-8 字节数除以 3 计权；每块最多保留一个待配对高代理项，孤立代理项在块结束按 U+FFFD 计。工具参数增量解码 JSON 转义与 `\uXXXX` 代理对，跳过字符串外空白，喂入同一套标量权重。计量只按新增片段推进，不把片段数量当 token，因此同一内容改变分片方式不会改变总估算。该方法没有真实 tokenizer 的精确保证，跨词表和内容形态仍有偏差。

速率基于 21 个 100ms 到达观测点计算累计斜率。每个收到有效 delta 的桶记录该桶最后一次到达时间 $t_i$ 与截至该次的累计估算量 $C_i$；首个有效包建立基线，排除首包等待（TTFT）与初始大包尖峰。在满足至少两个不同桶且观测跨度 $t_j - t_i \ge 240\text{ ms}$（最大窗口 `2000 ms`）时，输出斜率 $(C_j - C_i) / (t_j - t_i)$，即 `≈102 t/s`（小于 `1 t/s` 时显示一位小数，大于等于 `1000` 时使用 `k`/`M` 缩写并保证宽度不超过 10 列）。收到内容但观测跨度不足 `240 ms` 或仅收到单个整包时，诚实显示已收到量 `≈12 tok`（小于 1 时显示 `≈<1 tok`）。两次到达之间保持最近一次实测速率；连续 `2000 ms` 无新内容或响应结束（`message_end`）时立即切回 `-- t/s`（使用 `dim` 色调以区分活跃数值的 `muted` 色调）。连续流式阶段同态数值最多每 `240 ms` 刷新一次文本，状态跃迁立即刷新。

同会话内按 `provider + api + model` 维护最多 16 条正文校准系数（初始 `1.0`，对数空间几何 EMA，夹在 `[0.67, 1.5]`），仅在可比的纯正文正常 `stop` 响应（无工具、无 thinking/redaction/替换异常、`usage.imageOutput` 缺省或为 `0`、基础估算不少于 64 tokens、非 faux/虚拟路由、`responseModel` 匹配且可确信正文 token 数）结束时更新，并在下一轮响应开始时冻结生效，从不回改当前已显示的实时速率。

## Event and resource ownership

采样按每次 assistant 响应重置，Working 计时与会话级校准跨任务存续。正常 provider 的共享 content 数组用于响应识别；faux provider 每块替换数组并在最终消息中重建内容，因此同时使用响应内保持的 usage 对象身份。已经见过的旧数组不会重新绑定，结束后的更新无效。

start 事件引用的 partial 可能已经被后续生产者修改，不能把它当作 start 时的快照。采样立即计入 delta 到观测环；块结束与终态消息只补齐或校准缺失总量（`text_end` 长度一致时跳过全文重扫，工具参数采用迭代对象遍历并在存在 `argumentsError` 时保留已流出的估算），终态补齐量不进入实时斜率环。若流中出现迟到 redaction（如 Bedrock thinking 块被标为 redacted），立即撤回该块计数、作废当前观测环并跳过校准。

保存 21 个数值观测槽、当前响应各内容块的数值计数及有限解码状态，以及最多 16 条标量校准系数，不保存文本片段或历史消息副本。响应结束清空块与观测状态，身份集合使用弱引用，不延长消息寿命。session replacement、reload、shutdown 释放旧调度器和所有区域句柄，过期调度回调检查 generation 后退出。

## Rendering

Working 与 CodexFooter 通过 widget 和 footer factory 挂载。动画帧或速率标签变化时，同一个 TUI 只请求一次刷新。

footer 的上下文比例按只追加的会话分支读取。会话管理器、叶节点、模型或 contextWindow 改变时重新调用宿主统计；其余动画帧复用结果，避免每 80ms 重建未变化的历史投影。追加消息、context edit、分支切换和压缩都会改变该版本。每次 footer 安装单独持有一个结果，没有跨会话缓存。`pi-virtual` 路由的实际模型上限还依赖 live agent messages，因此保持实时 getter；缺少分支版本接口时也正常读取。

## Verification

采样与生命周期快速验证通过仓库隔离入口运行：

```bash
pnpm test extensions/codex-ui/__tests__/token-estimator.test.ts extensions/codex-ui/__tests__/token-rate.test.ts extensions/codex-ui/__tests__/token-rate-provider.test.ts extensions/codex-ui/__tests__/json-units.test.ts extensions/codex-ui/__tests__/working.test.ts extensions/codex-ui/__tests__/working-session.test.ts
```

普通与全屏终端的真实工具、取消、重试和会话切换验收见 [Working 旅程](../.cursor/skills/verify-pi-codex-ui/features/working.md)。
