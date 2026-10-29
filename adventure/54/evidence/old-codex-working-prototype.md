# Classic Codex Working prototype

## Decision and scope

用户审阅第一轮布局后选择 B：速率放在 footer 右侧。用户不满意 `Working..` 的省略号动画，希望观看 Codex CLI 大幅调整 TUI 样式之前的动画原型。此次保留 B，单独制作动画原型，仍不调用模型或修改正式功能。

布局已确认；动画尚待体验。旧原型与其证据保持可追溯，新入口在 `adventure/54/prototypes/old-codex-working/README.md`，仅本 worktree 保留，遵守仓库对 prototypes 的忽略和提交门禁。

## Source and fidelity

以可核验的 OpenAI Codex `rust-v0.97.0` 为参照，没有证据证明它就是用户所指大改版的紧邻前一版。原型用于确认具体效果，不能把参照版本选择当作用户已确认。

- [shimmer.rs](https://github.com/openai/codex/blob/rust-v0.97.0/codex-rs/tui/src/shimmer.rs)：2 秒循环，左右各 10 字符留白，扫描位置取整，余弦带半宽 5，逐字加粗并混合颜色。
- [exec_cell/render.rs](https://github.com/openai/codex/blob/rust-v0.97.0/codex-rs/tui/src/exec_cell/render.rs)：truecolor 下小圆点 `•` 同样调用 shimmer；非 truecolor 分支为每 600ms 在 `•` 和暗 `◦` 之间切换，本次不展示该分支。
- [status_indicator_widget.rs](https://github.com/openai/codex/blob/rust-v0.97.0/codex-rs/tui/src/status_indicator_widget.rs)：`Working` 无省略号，附计时和 Esc 提示，32ms 请求下一帧。
- [color.rs](https://github.com/openai/codex/blob/rust-v0.97.0/codex-rs/tui/src/color.rs)：混色参数方向已核对。

本地 `animation.mjs` 改写上游算法，保留出处、修改说明及 Apache-2.0 LICENSE。配色采用上游没有取得终端默认颜色时的回退值：基础 RGB 128、扫描目标 RGB 255。没有接入上游的前景/背景色探测，因此真实终端自定义颜色下可能存在外观差异，不声称像素完全复刻。

## Real integration

沿用真实 Pi 1.4.0 CLI、生产 codex-ui 初始化、聊天/输入框/主题和 CodexFooter。原型通过 widget/footer 工厂接入。速率固定在 B 位置，无 A/B 切换。

Working 使用基于单调时钟的 32ms 调度；`Working` 文本稳定，小圆点和字母颜色变化。F4 暂停，F2 重启，Esc 停止模拟运行使屏幕提示具有实际作用。这些是原型控制，不代表产品结束或取消规则已经确定。窄于 40 列省略 Esc 提示，保留 Working 与计时。

会话与所有配置写入隔离 `.run-*`，速率及周围业务数据为 fixture。禁止提交输入和调用模型；正常退出读取 provider 实际调用计数。未改正式源码、补丁、全局 Pi 或安装配置。

## Run and verification

从冒险 worktree 根目录运行：

```bash
node adventure/54/prototypes/old-codex-working/launch.mjs
node adventure/54/prototypes/old-codex-working/launch.mjs fullscreen
conda run --no-capture-output -n codex-py312 python adventure/54/prototypes/old-codex-working/smoke.py
```

2026-10-29，普通和全屏真实 PTY 共 36 项断言通过：

- 从真实 CLI 入口加载预置聊天；多个连续帧的 Working 字母产生至少九种颜色状态，且同一帧多个字母具有不同颜色；没有动画省略号。
- 速率在原 footer 行，Working 行没有速率；暂停同时冻结计时与颜色。
- 32/40/100 列仍有完整速率和 Working；无数据替换不残留数字；四位速率正常。
- Esc 停止模拟运行，F2 恢复动画；输入可编辑而 Enter 不提交。
- 两种模式正常退出，实际模型调用计数为零；两组进程已停止，临时 `.run-*` 全部删除，没有监听服务。

本地证据为 `adventure/54/prototypes/old-codex-working/verification-1793238487784199000/`，包含断言、快照、ANSI 和逐帧字符颜色。网页预览复用相同动画公式，输入框/footer 来自实际终端快照；它是辅助示意，不能替代真实 TUI 体验。

本次 `pnpm_config_verify_deps_before_run=false pnpm run check` 退出码 0，196 个测试文件、2913 个测试通过，构建、类型、发布包及宿主 source/dist 加载均通过。本地日志为 `.tmp/old-codex-working-check.log`。被忽略的原型不属于该命令自动覆盖范围，原型行为由上述 PTY 驱动单独验证。

## Boundaries and continuation

未接入局部刷新补丁，32ms 调度仍走宿主现有刷新，不是 CPU 优化交付。没有验证模型实时统计、真实运行生命周期、取消传播、低功耗或非 truecolor 配色。产品 CPU 和语义要求保持不变。

当前等待用户确认动画是否为所指效果，位置 B 不再重复询问。之后完成 #59 剩余生命周期决定，再修订实施切片。
