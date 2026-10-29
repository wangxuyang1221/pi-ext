# Working and lifecycle

用户提交任务后，在输入框上方看到青色 spinner、Working 反光及计时，footer 右侧显示最近约两秒的估算接收速率。工具、等待、retry 和 compaction 期间保持动画，宿主真正 settled 后隐藏。

## Sub-features

- `working-stream`：生产事件驱动 spinner、反光、计时和 `≈… t/s`；无新片段过期到 `-- t/s`。
- `working-permission`：权限/输入等待不结束任务，批准执行真实 shell，goal 后续行保持。
- `working-cancel`：Esc 实际取消工具，settled 后清除动态 UI，不产生迟到文件。
- `working-recovery`：429 retry、overflow 自动压缩、最终错误各按宿主边界结束。
- `working-replacement`：模式/new/reload/quit 不复活旧任务或 timer。

## How to get to it (user POV)

加载正式 codex-ui，提交 prompt 即出现 Working。对话框中输入或按 Enter 批准，运行中 Esc 取消，`/settings` → `TUI mode` 切换，`/new` 新会话，reload 后再提交，最后 `/quit`。验证中 F7/F8 打开公开 UI overlay/input，F9 切换主题；这些是夹具快捷键，不是产品新增按键。

## Driving it with local-refresh-pty

Preconditions:

- [Launch/Doctor](../SKILL.md) 完成。`working-provider.ts` 只替代远程模型和摘要，permissions 扩展、shell、AgentSession 均真实。

```bash
conda run -n codex-py312 python scripts/local-refresh-pty.py "$RUN/working-regular" --working --cli "$PWD/node_modules/.bin/pi"
conda run -n codex-py312 python scripts/local-refresh-pty.py "$RUN/working-fullscreen" --working --mode fullscreen --cli "$PWD/node_modules/.bin/pi"
```

- **Submit and edit.** 旅程先打开 idle input，确认不启动 Working，再提交 `Generate visible thinking and text`。公开 provider 事件进入生产采样，屏幕有 `≈`，spinner accent 为 `5efcff`，12 次取样至少五种帧与两种文字灰度。草稿中间插入 `X` 后 editor 事件准确。32/40/100 列保留速率与计时，12 列安全裁剪；小于 40 列没有中断提示。
- **Wait and approve.** 提交 `Run the permission tool`，等待真实 `Allow Pi to run bash?`，2.2 秒无新输出后显示 `-- t/s` 且动画继续。Enter 批准后真实 shell 写 `tool-proof.txt`，`artifacts/workspace/tool-proof.txt` 必须为 `TOOL-FINISHED`。结合 tool_execution 公开事件核对执行，不仅依赖 UI。
- **Cancel executing work.** 提交 `Cancel the running tool` 并批准，先观察 `CANCEL-TOOL-ENTERED` 的 tool_execution_update，再发送 Esc。`agent_settled` 之后 Working/rate 消失；`artifacts/workspace/should-not-exist.txt` 不存在，summary 记录取消断言。不能把按键本身当终止。
- **Recover through host.** 429 第一次响应触发真实 retry，第二次请求 attempt=2；overflow 事件为 `reason=overflow, willRetry=true`，存在 session_compact。等待期间动画继续，最终 settled 后隐藏。非 retry 错误也结束动态 UI。
- **Replace and exit.** 两次设置页切换读回实际 settings，active Working 持续；`/new`、reload 后 idle 不残留，再提交成功。`/quit` 退出码 0，保留 session/settings 副本，按 Cleanup 查进程组/监听并确认 artifacts 仍在。
- **Repeat on consumers.** [installation](installation.md) 的四个实际发布入口用 `--extension` 传已安装文件，原版加 `--original`，不能用源码入口代替包入口。

## Gotchas

fixture 的 `plan.json` 选择下一次远程响应，不修改 Working 内部状态。summary 的目标成功字段与 CLI 正常退出是两项独立条件。速率按 UTF-16/4 估算，固定两秒分母；最终 usage 不等于窗口采样，也不代表远程 tokenizer 精度。真实 bash 取消不证明 Esc 恰好命中 Write/Edit 文件系统 await，后者仍按旧 skill 边界记录。执行前不要另跑会清理 dist 的任务。
