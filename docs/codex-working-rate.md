# Working animation and receive rate

## User behavior

codex-ui 在输入框上方显示青色十帧转圈、固定的 Working 文字反光和计时。转圈每 80ms 一帧，反光每两秒循环；两者与 footer 共用一个 32ms 调度器。`codex-pi` 主题的 accent 为 `#5efcff`。32、40、100 列保留计时与 footer 右侧速率；小于 40 列省略中断提示，更窄时按显示列截断。

任务从 `agent_start` 持续到 `agent_settled`。工具执行、自动重试、自动压缩以及权限和输入对话框等待期间继续动画。按下 Esc 后，宿主完成取消才隐藏；`agent_end` 不停止动画。idle 时打开对话框不会启动它。结束后速率也隐藏，footer 恢复可用宽度，goal 的后续行保持原有宽度。原生 Working 行继续隐藏，标题动画保持原有行为。

## Rate meaning

`≈102 t/s` 是最近约两秒收到的可见模型输出的估算速率。计入正文、传来的可见 thinking 及工具调用参数，排除用户输入、工具执行结果、签名、redacted thinking 和未传出的隐藏思考。此数值不表示模型服务端吞吐，也不替代账单 usage。

估算将正文和 thinking 的 UTF-16 单元数除以 4；工具参数先按 JSON 字符流计量，字符串外空白不计、转义合并为解码后的单元，再除以 4。JSON 引号、结构符号、数字和布尔值仍计入。计量只按新增片段推进，不把片段数量当 token，也不逐片段取整。因此同一内容改变分片方式不会改变估算。该方法没有模型 tokenizer 的精度保证，中文、emoji、代码和不同词表可能有明显偏差。JSON 数字的不同合法写法也可能有少量估算差异。

窗口为 20 个 100ms 桶，分母始终是两秒；冷启动自然爬升。桶边界可能使样本提前不到 100ms 过期。时钟使用 `performance.now()`。没有有效样本显示 `-- t/s`，小于一个 token/s 时显示一位小数，避免把非零样本写成 0。响应结束的 usage 不进入这条统计。

## Event and resource ownership

采样按每次 assistant 响应重置，Working 按整个任务存续。正常 provider 的共享 content 数组用于响应识别；固定 faux provider 每块替换数组并在最终消息中重建内容，因此同时使用其响应内保持的 usage 对象身份。已经见过的旧数组不会重新绑定，结束后的更新无效。这里使用对象身份，不按 timestamp 或字符串内容猜测响应归属。

start 事件引用的 partial 可能已经被后续生产者修改，不能把它当作 start 时的快照。采样立即计入 delta，在块结束及最终消息时补齐缺失部分；无 delta 的完整内容在结束时计入一次。工具参数最终 JSON 只处理一次。正文/思考用长度差补齐，工具参数用归一化计量差补齐，不重复计入已经传来的内容。

保存 20 个时间桶、当前响应各内容块的数字计数及增量 JSON 状态，不保存文本片段或历史消息副本。一次 final 遍历本响应的内容块；delta 和动画帧不重扫完整响应。响应结束清空块状态，身份集合使用弱引用，不延长消息寿命。session replacement、reload、shutdown 释放旧调度器和所有区域句柄，过期调度回调检查 generation 后退出。

## Rendering and fallback

Working 与 CodexFooter 通过真实 widget/footer factory 挂载，登记 factory 返回的同一组件。存在可选 `registerTextRegion` 时请求局部刷新，否则调用正常 `requestRender`。原版保留功能，缺少的只有 CPU 优化。目标高度改变、对话框、overlay、搜索、选择及复杂布局按[宿主契约](pi-text-region-refresh.md#contract)回退，状态更新不接管输入焦点。

footer 的上下文比例按只追加的会话分支读取。会话管理器、叶节点、模型或 contextWindow 改变时重新调用宿主统计；其余动画帧复用结果，避免每 32ms 重建未变化的历史投影。追加消息、context edit、分支切换和压缩都会改变该版本。每次 footer 安装单独持有一个结果，没有跨会话缓存。Pi 1.4 的 `pi-virtual` 路由还依赖 live agent messages，因此保持实时 getter；缺少分支版本接口时也正常读取。

## Verification

采样与生命周期快速验证通过仓库隔离入口运行：

```bash
pnpm test extensions/codex-ui/__tests__/token-rate.test.ts extensions/codex-ui/__tests__/token-rate-provider.test.ts extensions/codex-ui/__tests__/json-units.test.ts extensions/codex-ui/__tests__/working.test.ts extensions/codex-ui/__tests__/working-session.test.ts
```

真实 CLI 使用扩展后的正式 PTY 入口。外部模型和压缩摘要由离线 provider 提供，审批、shell、取消、自动重试/压缩和 session 流程由实际宿主执行：

```bash
conda run -n codex-py312 python scripts/local-refresh-pty.py .tmp/working-regular --working --cli node_modules/.bin/pi
conda run -n codex-py312 python scripts/local-refresh-pty.py .tmp/working-fullscreen --working --mode fullscreen --cli node_modules/.bin/pi
```

可将 `--cli` 指向[干净安装驱动](../scripts/local-refresh-install.mjs)输出的补丁或原版 bin，原版加 `--original`。`--extension` 可指定实际打包安装后的 codex-ui 入口。每次使用新证据目录；驱动记录进程组并清理自己的运行配置，保留 ANSI、操作、事件和屏幕证据。物理像素和系统剪贴板不在该自动驱动覆盖范围。

[CPU 驱动](../scripts/local-refresh-cpu.mjs)使用同一生产 Working、CodexFooter、采样器、受控接收事件和真实历史组件比较正常与局部刷新。默认同步批次隔离渲染成本；`--interval=32` 单独记录宿主原生调度。预算仍为 200/1000 对历史动态帧下降至少 30%，正常更新与未接入路径额外中位数不超过 `max(基线10%, 0.1ms/帧)`。
