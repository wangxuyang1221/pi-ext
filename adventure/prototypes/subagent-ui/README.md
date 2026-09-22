# Subagent UI prototype

## Status

用户已确认 /after 的视觉方案，最后将成功文字绿色修正为 #46e87c。原型已收敛为这一版；原版、正文色、灰绿与暗灰的交互入口和预览已移除，历史可从 Git 恢复。完整有效规格在 [Spec #25](https://github.com/wangxuyang1221/pi-ext/issues/25) 维护。

随机英雄名属于新增的 [Planning #28](https://github.com/wangxuyang1221/pi-ext/issues/28)，尚未接入此原型。

## Run

```sh
cd /Users/wangxuyang/Code/t3code/pi-ext/.scratch/u
pnpm exec node adventure/prototypes/subagent-ui/demo.mjs
```

默认展示已确认的六类工具消息，并保留真实 codex-ui Read、Bash 作为参照。

- `/after`：重新展示六类消息。
- `Ctrl+O`：Pi 原生折叠/展开。
- `/demo all hold`：观察六类调用进行中，再用 `/finish success` 或 `/finish error` 完成。
- `/demo all error`：观察六类失败消息。
- `/demo wait timeout` 与 `/demo wait interrupted`：观察等待超时、中断。
- `/demo spawn success after long`：观察长名称，可将终端缩到 40 或 80 列。
- `/history`：重新打开已持久化的同一会话，验证历史重建。
- `/palette light|dark|codex-pi`：切换真实宿主主题。
- `/quit`：退出并清理隔离运行目录。

启动时可加 `--expanded` 或 `--fullscreen`。原型不会运行真实子代理。

## Landing Map

- Target：Pi 主对话中的 spawn、prompt、list、read、wait、close 工具调用与结果行。
- Context：真实 Pi 0.86.0 InteractiveMode，加上当前生产 codex-ui 的编辑器、页脚、Read 和 Bash 渲染。
- Contract：registerTool 的 renderShell self、renderCall/renderResult、共享 state、isPartial/isError 与原生展开状态。正式模式仅替换 execute 的数据来源。

## Real and fixture

真实部分是仓库的 codex-ui、主题、subagent renderer、Pi 会话与流式工具参数、工具组件、编辑器、页脚、快捷键和窗口尺寸变化。

fixture 为 Pi 官方 fauxProvider 的固定模型响应，以及子代理和 Read/Bash 的固定结果。显示的 Bash 命令只是例子，不执行 shell。原型不加载真实 subagent manager，不创建 tmux 或子代理，不读取真实凭证和用户配置。

approximation：固定结果不能证明真实子代理的认证、调度、任务耗时或恢复行为。PNG 根据真实 PTY 单元格重绘，字体回退和行高可能与用户终端不同。实际效果以运行入口为准。

## Files and cleanup

prepare.mjs 将源码直接转译到隔离目录，不再应用 renderer 源码补丁或主题代理。正式视觉规则已在生产 src 实现。加 --production 会调用构建产物中的 registerSubagentTools，保留生产 schema 与 renderCall/renderResult，仅替换 execute 为固定结果。运行此模式前先执行 pnpm run build。

check.mjs 从 Git 基准 19e82a1 读取旧 renderer 作为信息保留对照，不提供旧视觉交互入口。正式模式不替换 renderer 源码。

临时运行目录位于仓库 .tmp，退出时删除。原型捕获保存在 .tmp/subagent-ui-after-*，正式模式捕获保存在 .tmp/subagent-ui-production-*。已确认原型预览在 previews/，正式证据在 adventure/evidence/implementation-30/。没有后台服务和监听端口。

## Verification

```sh
pnpm exec node adventure/prototypes/subagent-ui/check.mjs
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --fullscreen
# 正式工具注册、schema 与 renderer 的宿主验证
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --production
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --production --fullscreen
```

收敛后只验证已确认方案：40 组文字信息对照、0/1/2/12/40/80/120 列边界、六类状态、成功文字颜色、展开/折叠、长名称和窗口变化，以及退出清理、网络零调用。原型验收与预览见 [review.md](review.md)，正式集成证据见 [implementation-30.md](../../evidence/implementation-30.md)。

## API sources

运行版本为 @earendil-works/pi-coding-agent 与 pi-ai 0.86.0。Context7 提供 main 文档，因此 API 调用另与本地同版本 SDK/extension 声明、pi-ai 的 faux.d.ts 及现有 tool-status-prototype/runtime.mjs 核验。

官方参考：[SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[extension rendering](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。
