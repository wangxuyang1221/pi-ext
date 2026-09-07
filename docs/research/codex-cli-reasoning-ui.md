# Codex CLI reasoning UI

## Scope

核验对象为 `codex-cli 0.153.4`。官方 `rust-v0.153.4` tag 指向提交 `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`，以下源码链接均固定到该提交。[tag object](https://api.github.com/repos/openai/codex/git/tags/042fb41b7c813ac7999105e886b2b7aa715b5081)

本报告依据官方源码和版本内测试断言，没有启动 Codex 实际会话，也没有亲自观察终端 UI。

## Live thinking

运行中的 reasoning 不逐字写入普通历史。TUI 累积当前 summary part，从中提取第一个闭合的 `**...**`，去掉 Markdown 标记后更新底部状态组件的标题。没有完整标题时保留原状态，任务开始时通常为 `Working`。[streaming][streaming] · [turn start][turn-start]

这是一条会更新的状态，不是每个分段追加一行。分段切换只保存缓冲区并重置标题提取；整个 reasoning item 完成后，才合并所有 part，提交一个 history cell。实时完成路径不会再把完成通知里的 summary 重复追加一次。[streaming][streaming] · [completion][completion]

主代理另行核验了同版本的实时状态源码。状态行位于 composer 上方，依次显示活动标记、扫光标题、dim 的耗时与 `esc to interrupt` 提示；超宽时省略截断。[status widget][status-widget]

- 启用动画且支持真彩时，标题使用 RGB 扫光并加粗，不叠加斜体。颜色由终端默认前景色与背景色混合，不是固定青色。
- 非真彩标题在 DIM、默认和 BOLD 间表现扫光；活动圆点每 600 ms 在 `•` 与 dim 的 `◦` 间切换。
- Reduced motion 下，标题使用默认样式，这条状态行不显示活动圆点。[motion][motion] · [shimmer][shimmer]

实时状态与 history cell 是两套渲染路径。因此既不能把历史中的 `dim + italic` 套到实时标题，也不能笼统说“Codex 思考行不加粗”。

## Completed history

0.153.4 不能概括为“思考完成后只在 Ctrl+T 显示”。实际判断为：

```rust
let transcript_only = header.is_empty() && !title_only;
```

带可识别首标题的正文，以及仅含一个 `**标题**` 的内容，可以进入普通历史。无可识别标题的普通正文则只在 transcript overlay 显示。[construction][construction]

| 输入形态 | 普通历史 | `Ctrl+T` overlay |
| --- | --- | --- |
| `**Plan**`，空行，再接正文 | 显示正文，首标题不重复显示 | 同样正文、同样样式 |
| 只有 `**Confirming backend JSONL source**` | 显示该标题 | 同样标题、同样样式 |
| 无标题的 `Summary only` | 不显示 | 显示正文 |
| 只有标题和空占位正文 `<!-- -->` | 不显示 | 不显示 |

前两种和空占位情况均有官方测试明确断言。首标题拆出后存入 `_header`，历史渲染不单独输出它；后续正文中的其他标题仍可保留。[tests][tests] · [splitting][splitting]

`on_agent_reasoning_final` 旁的注释仍写着 "record transcript-only content"，但实际分支与测试允许普通历史显示部分 reasoning，结论应以实现为准。[streaming][streaming] · [construction][construction]

应用始终把已提交 cell 加入 `transcript_cells`，再根据普通渲染结果写入终端历史。因此“普通屏幕不显示”不等于“丢弃记录”。不会因为最终答复到达，就自动删除所有已完成 reasoning cell。[history insertion][history-insertion]

## Expansion and style

`Ctrl+T` 打开独立的 transcript overlay，进入 alternate screen，使用已保存的 history cells。它不是在单条摘要原位置展开。[overlay][overlay]

Overlay 的 live tail 不包含 `reasoning_buffer`，所以不能承诺它会逐字显示尚未完成的 reasoning item。完成并提交的新 cell 才会加入已经打开的 overlay。[live tail][live-tail] · [history insertion][history-insertion]

Reasoning 的普通历史与 overlay 使用同一个正文渲染函数。[rendering][rendering]

- 完整正文先解析为 Markdown，再给每个 span 叠加 `dim + italic`。
- 不统一加粗。粗体来自正文的 Markdown，因此仅含 `**标题**` 时会呈现 `bold + dim + italic`。
- 首行圆点 `•` 只有 `dim`，未指定青色，也没有加粗或斜体；后续行缩进两列。
- 按宽度换行，没有只取最后一段、固定一行或统一省略号截断的规则。
- `dim` 是弱化亮度的终端修饰符，不是固定灰色 RGB。行内代码、链接等可保留 Markdown 原有配色。[Markdown styles][markdown-styles]

## Configuration

`show_raw_agent_reasoning` 默认 `false`。设为真后，TUI 接受服务端已经提供的 raw reasoning delta，并在重放时加入 raw content；它不会凭空获得完整内部推理。[defaults][defaults] · [notifications][notifications] · [completion][completion]

`hide_agent_reasoning` 也默认 `false`。配置说明声称可以隐藏 reasoning，但固定版本源码中的交互式 TUI 没有读取该字段，实际运行读取点在 `codex exec` 的 human-output processor。不能把说明文字直接当作这个版本 TUI 的隐藏保证。[defaults][defaults] · [exec processor][exec-processor]

`model_reasoning_summary` 是请求摘要的配置，不是历史展开开关。未指定时使用当前模型的默认值；`none` 使请求不携带 summary 值，不删除已有历史。[model default][model-default] · [request construction][request-construction]

## Comparison with codex-ui

当前 `codex-ui` 取最后一个段落，压成单行并按宽度省略；流式与完成态使用同一个 transformer。圆点通过行内代码 `` `•` `` 获得主题青色，`thinkingText` 则映射到灰色。[local transformer](../../extensions/codex-ui/src/index.ts#L40-L60) · [local tests](../../extensions/codex-ui/__tests__/index.test.ts#L45-L82) · [theme](../../themes/codex-pi.json#L4-L65)

所以，“灰色粗斜体 + 青色圆点 + 单行摘要历史”不是 Codex CLI 的完整复刻。Codex 区分运行中状态与完成态历史，历史圆点是 dim，正文可以多行，是否加粗和是否进入普通历史都取决于内容。它也确实会把某些粗体标题保留到普通历史，不能反过来说“完成后 thinking 一律消失”。

## Performance considerations

Codex 0.153.4 的状态组件在渲染区域非空且动画开启时，每次 `render` 都调用 `schedule_frame_in(Duration::from_millis(32))`，请求 32 ms 后的下一帧。对应约 31.25 Hz 的名义调度节奏，不代表实测稳定 31 FPS，也不能据此推算 CPU 占用或每帧重绘范围。[status scheduling](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/status_indicator_widget.rs#L279-L288)

移植这种动画会引入周期性重绘请求，但不能把 Codex Rust TUI 的成本直接套到 Pi。本次未对新思考 UI 运行基准，不提供未测量的性能百分比。

主代理核验了本机 Pi 0.85.1 的实际安装源码，发布元数据指向 `d981de1229ef899957bbe968bc8dcda02a21f477`。普通模式的每次绘制先调用组件树 `render(width)`，处理整组行，再扫描新旧行寻找变化。组件可以命中缓存，但“终端只收到一行”不代表“宿主只计算一行”。首个变化行位于此前视口之上时，仍调用 `fullRender(true)` 清屏并重发历史。把动态内容固定在文档底部、保持历史不变，可以避开这一类稳定更新的全量输出，却不能消除组件遍历与差分成本。[release metadata](https://registry.npmjs.org/@earendil-works/pi-tui/0.85.1) · [regular renderer](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/tui/src/tui-main-screen.ts)

Pi 的普通 `requestRender` 合并相邻请求，最小绘制间隔为 16 ms。这不是对 32 ms 动画的自动低功耗节流。原生 `Loader` 默认每 80 ms 切换帧并请求绘制；只有零帧或单帧时不启动动画 interval。因此恢复 working row 时，应显式选静态标记，不能直接恢复默认 spinner 后声称没有周期性开销。[scheduler](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/tui/src/tui.ts) · [loader](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/tui/src/components/loader.ts)

公开的 `setWorkingMessage`、`setWorkingVisible`、`setWorkingIndicator` 可以承载轻量状态。建议只有提取出的标题变化时才更新，先不加扫光或常驻秒表；历史在完成后定稿并缓存。宿主仍会在 assistant `message_update` 时更新组件和请求绘制，插件隐藏思考正文不等于取消原有流式处理。Markdown transformer 只改变显示文本，也不能单独接管原生容器间距与历史/overlay 架构。[interactive lifecycle](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/interactive-mode.ts) · [extension interfaces](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts)

本仓库此前已经实测过“离屏动态行触发全历史重放”，并通过移动 Bash 动态元信息解决目标场景。那是 Pi 0.84.3/0.85.0 的工具负载，不是本次思考 UI 的性能预测。后续落地仍应比较新方案的实际帧数、CPU、终端输出字节、全量重绘次数和输入延迟。[existing performance evidence](codex-ui-performance.md#production-delivery)

## Verification

本子任务核验了固定版本实现和官方测试断言，并合并主代理核验的实时状态样式。未执行 Codex Rust 测试或实际 UI，未修改生产代码。主代理已运行 `pnpm run check` 并通过：52 个测试文件，666 项测试通过、1 项跳过，构建和发布包检查通过，本子任务没有重复运行。源码缓存位于 `.tmp/codex-reasoning-research/`。

[status-widget]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/status_indicator_widget.rs
[motion]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/motion.rs
[shimmer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/shimmer.rs
[streaming]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/streaming.rs#L232-L300
[turn-start]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/turn_runtime.rs#L70-L103
[completion]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/replay.rs#L131-L150
[construction]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/messages.rs#L623-L645
[splitting]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/messages.rs#L647-L698
[tests]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/tests.rs#L2700-L2750
[history-insertion]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/app/history_ui.rs#L23-L64
[overlay]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/app_backtrack.rs#L217-L254
[live-tail]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget.rs#L1902-L1957
[rendering]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/messages.rs#L297-L367
[markdown-styles]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/markdown_render.rs#L105-L124
[defaults]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/config/mod.rs#L4250-L4258
[notifications]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/protocol.rs#L73-L90
[exec-processor]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/exec/src/event_processor_with_human_output.rs#L44-L65
[model-default]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/step_settings.rs#L55-L75
[request-construction]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/client.rs#L906-L925
