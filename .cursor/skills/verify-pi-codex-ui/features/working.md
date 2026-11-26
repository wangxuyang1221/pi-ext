# Working and lifecycle

用户提交任务后，在输入框上方看到青色 spinner、静态粗体 `Working` 文本及计时。footer 右侧随当前响应显示占位符、已收到的估算 token 数或接收速率。工具、等待、retry 和 compaction 期间保持动画，宿主发出 `agent_settled` 后隐藏。

## Sub-features

- `working-stream`：首包建立基线，显示 `≈… tok`（不足 1 时为 `≈<1 tok`）。至少两个到达桶且跨度达到 240 ms 后，显示 `≈… t/s`。连续 2000 ms 没有新内容或当前响应结束时显示 `-- t/s`。活跃值使用主题的 `muted` 色，占位符使用 `dim` 色。
- `working-tool`：真实 shell 工具启动时速率已复位，工具执行和输入等待期间 Working 动画与计时继续，footer 后续状态行保留。
- `working-cancel`：Esc 实际取消工具，settled 后清除动态 UI，不产生迟到文件。
- `working-recovery`：429 retry、overflow 自动压缩、最终错误各按宿主边界结束。
- `working-replacement`：模式/new/reload/quit 不复活旧任务或 timer。

## How to get to it (user POV)

加载正式 codex-ui，提交 prompt 即出现 Working。对话框中输入，运行中 Esc 取消，`/settings` → `TUI mode` 切换，`/new` 新会话，reload 后再提交，最后 `/quit`。验证中 F7/F8 打开公开 UI overlay/input，F9 切换主题；这些是夹具快捷键，不是产品新增按键。

## Driving it with working-pty

前置条件：

- [Launch/Doctor](../SKILL.md) 完成。`working-provider.ts` 只替代远程模型和摘要，shell、AgentSession 均真实。

```bash
mkdir -p "$PWD/.tmp"
RUN="$(mktemp -d "$PWD/.tmp/verify-working-XXXXXX")"
conda run -n codex-py312 python scripts/working-pty.py "$RUN/regular" --mode regular
conda run -n codex-py312 python scripts/working-pty.py "$RUN/fullscreen" --mode fullscreen
```

验证发布包时，两个命令均追加 `--cli "$CONSUMER/node_modules/.bin/pi" --extension "$CONSUMER/node_modules/pi-ext/extensions/codex-ui/dist/index.js"`，其中 `CONSUMER` 是安装了本次 tarball 和固定 Pi 版本的目录。驱动从仓库复制 codex-pi 主题，另在 consumer 中校验打包主题的内容和发现结果。

- **Submit and edit.** 旅程先打开 idle input，确认不启动 Working，再提交 `Generate visible thinking and text`。可见 thinking 和正文经过公开 provider 路径。footer 首行右侧出现速率，spinner 使用 codex-pi 主题的 accent，12 次取样至少五种帧且 `Working` 保持稳定的粗体主题 `text` 前景色（切到 `light` 主题后颜色随主题同步变更）。草稿中间插入 `X` 后 editor 事件准确。32/40/100 列保留速率与计时，12 列安全裁剪；小于 40 列没有中断提示。
- **Receive Chinese text.** 提交 `Run the shell tool`。工具调用前同一响应先发送中文正文，每个整包 500 个汉字。首包显示 `≈400 tok`；第二包到达时，用新增的 400 tokens 除以两次公开正文事件的实测间隔（秒），核对首个 `≈… t/s`（允许 5% 的计时与取整偏差）。在 `screens.json` 查看 `tool-warmup` 和 `tool-stream-rate`，后者含间隔与期望速率。
- **Tool wait.** 驱动观察到 `tool_execution_start` 后即检查 footer，给终端 650 ms 呈现 `dim` 色的 `-- t/s`。查看 `tool-start-rate` 画面及观测延迟。工具结束前继续采样 spinner，检查占位符仍在。真实 shell 写入的 `artifacts/workspace/tool-proof.txt` 必须为 `TOOL-FINISHED`。
- **Cancel executing work.** 提交 `Cancel the running tool`，先观察 `CANCEL-TOOL-ENTERED` 的 tool_execution_update，再发送 Esc。`agent_settled` 之后 Working/rate 消失；`artifacts/workspace/should-not-exist.txt` 不存在，summary 记录取消断言。不能把按键本身当终止。
- **Recover through host.** 429 第一次响应触发真实 retry，第二次请求 attempt=2；overflow 事件为 `reason=overflow, willRetry=true`，存在 session_compact。等待期间动画继续，最终 settled 后隐藏。非 retry 错误也结束动态 UI。
- **Replace and exit.** 两次设置页切换读回实际 settings，active Working 持续；`/new`、reload 后 idle 不残留，再提交成功。`/quit` 退出码 0，保留 session/settings 副本，按 Cleanup 查进程组/监听并确认 artifacts 仍在。

## Gotchas

夹具的 `plan.json` 选择下一次远程响应。通过时需同时核对 summary 的 `passed`、CLI 退出码及清理结果。速率使用 Unicode 标量权重和最多 21 个观测槽估算，分母取实际到达跨度。faux 响应不参与同会话正文校准；校准门控、大数缩写及同态数值 240 ms 刷新间隔的定向测试见[速率规范](../../../../docs/codex-working-rate.md#verification)。真实 bash 取消的覆盖边界见[文件修改取消边界](../scripts/README.md#file-mutation-cancellation)。运行旅程期间应保留已构建的 dist。
