# Goal execution todo

## Understanding

沿用原 #6 worker，按最新 #3/#6、C11/C12 实施工具与事件调度。不采用 provider 请求检查层、editor 接入/重建或 Pi 核心改动。基准 f4a7e44 加原 #4/#5/#6 WIP，保留研究和历史 Red。

## User Visible Changes

- 保存目标后可自动推进；模型有三个固定 Codex goal 工具，用户可 edit/pause/resume，停止状态不自动续跑。
- 真正中断模型运行和 /goal pause 会暂停目标，关闭编辑或确认弹窗不会暂停。C12 允许原生重试等待中 Esc 取消后为 blocked，仍保留统计、停止且可 /goal resume。原生重试耗尽或压缩失败会停止目标并显示原因。
- C11 取消失效自有续跑时，其他扩展排队消息可能被清除，用户追加文字可能退回编辑器，需要重发。已有历史和保存的目标不受损。

## Todo

- [x] 核验固定上游 schema/提示、双版本事件源码及 C11，保留原 Red 诊断。
- [x] 增加权威控制提交与三个工具，保持身份、计数和继承门禁。
- [x] 完成存储失败 fail-closed 与检查点、工具/旧事件负例、edit 专属提示、切模型限制和最小状态 UI。
- [x] 完成续跑身份校验、失效过滤、错误/压缩协调及完整轮次失败审计。
- [x] 补充真实 runtime 与实际 PTY TUI 夹具，覆盖 C11、Esc、弹窗、输入交错和恢复。
- [x] 提供最小状态显示、上游归属和限制文档，运行 check 与双版本 #4/#5 回归。
- [x] 追加 #6 证据评论，更新正文并读回，回收进程后交还写权。

## How To Test

- 每个行为先写失败测试，再最小实现。保存失败不得发请求，取消弹窗不改状态；旧工具和事件不得改变新目标。
- 工具测试核对三个 schema、固定提示、Unicode 边界与响应字段。完整 turn 多次 bash 失败只能计一轮，连续三轮各自无成功工具才 blocked；同一 agent run 中的用户 follow-up 仍按完整 turn 计数。
- 调度按事件驱动，无轮询，最多一个待执行自有续跑。用实际调用计数检测重复或失效请求，保留调用和上下文证据。
- 两版本免费 faux runtime，networkAttempts=0；实际 InteractiveMode PTY 键盘验证不能用受控 UI SDK 替代。C11 检查用户文字可找回、历史和 goal 保留，并记录其他扩展消息清除的已接受限制。
- 原生重试成功、耗尽，以及 C12 取消后的 blocked/统计保留/resume；运行中真实 Esc 仍为 paused。压缩成功、失败、取消，以及失败后显式用户输入/手动压缩不被永久阻断。
- 最终 pnpm run check，双版本基础 runtime/lifecycle/processes 回归；记录退出码、子进程回收和监听端口。

## Progress

C12 范围下实施完成，待协调者独立验收。goal 53 单测、双版本各 9 项实际 runtime 与各 14 项真实 PTY TUI 通过；#4/#5 每版本 6/15/4 项回归通过。完整 check 为 856 passed、1 既有 skipped，类型/构建/发布包通过。原重试 Esc 必须 paused 的 Red 保留，不宣称修复；新增 C12 blocked/停止/统计保留/resume 验证。实际工具中断 error stop reason 的新 Red 已修复为 paused，双版本 Green。详细结果、复现、限制和清理见 [execution report](./goal-execution-report.md) 与 [#6 证据评论](https://github.com/wangxuyang1221/adventure/issues/6#issuecomment-5602144267)。正文已读回一致并保持 OPEN，交回写权。
