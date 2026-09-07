# Codex UI reply list

## Decision

采用 edit 原型中的 `list` 方案，放弃独立淡色圆点 gutter。正式实现只调用公开 `registerMarkdownTransformer`，不修改上游 Pi，不包装私有组件，不修改全局 padding。

普通 assistant 文本显示为外层列表项。原生 Markdown 负责换行、标题、链接、代码高亮、列表与表格。接受已有列表多嵌套一层，以及多文本块回复出现多个外层标记。

## Implementation

- `extensions/codex-ui/src/index.ts` 在现有 transformer 中增加 assistant 分支。空白内容原样返回，其余内容前置 `- `，每个换行后加入两格缩进。
- 转换无状态，每次处理当前输入文本，不缓存或修改消息，不累积包装，不注册新的生命周期监听器。
- user、thinking、工具、编辑器、`outputPad` 及原生错误提示不变。已有 `outputPad: 1` 会保留一列原生留白，列表缩进叠加在正文内部。
- edit 原型的比较模式跳过生产 assistant 转换，避免双重包装；`--production-replies` 直接使用正式转换，并关闭回复比较命令。

## Verification

按 Red-Green-Refactor 推进。先将正式 transformer 的 `hello` 期望改为 `- hello`，确认失败，再实现转换。原型组合测试随后复现 `- - Reply fixture`，修复原型的重复包装后通过。

`extensions/codex-ui/__tests__/reply-markdown.test.ts` 覆盖：

- 空白、CRLF、标题开头、已有列表、重复渲染。
- 24、60、100 列，`outputPad: 0/1`，长段落、嵌套列表、代码块、链接和表格。
- 中英文流式片段、未闭合代码块、完成后渲染、历史恢复与 invalidate。
- 多文本块、thinking、取消、错误、截断和空回复。
- 内存会话条目、模型上下文与 `/copy` 的原文来源保持不变。测试不操作系统剪贴板。
- 20 条已缓存历史消息在当前回复更新时不重新进入 transformer；同一宽度下重复 render 沿用原生缓存。

真实打包 CLI 验证使用隔离 fixture，不发送外部模型请求：

```bash
pnpm exec vitest run extensions/codex-ui/__tests__/reply-markdown.test.ts extensions/codex-ui/__tests__/index.test.ts
pnpm run prototype:edit-spacing --smoke
pnpm run prototype:edit-spacing --variant 2 --production-replies --pty-smoke
pnpm run prototype:edit-spacing --variant 2 --pty-smoke
pnpm run prototype:reasoning-ui --variant production --runtime repository --pty-smoke
pnpm run prototype:reasoning-ui --variant production --runtime installed --pty-smoke
pnpm run check
```

以上命令均通过。仓库运行时 Pi 0.84.3、本机 Pi 0.85.1 均验证了 fixture 经原生 provider 流式链路输出、工具执行、取消、重载、持久化会话恢复和退出。新增断言同时检查显示中的外层列表，以及 JSONL 中未添加标记的回复原文。全仓测试为 689 通过、1 个原有集成测试跳过。

## Performance

在改动前采集正式编译代码的基线，改动后复用相同测量脚本。环境为 Node.js 22.22.2、Pi 0.84.3、80 列、`outputPad: 0`、原生 dark 主题。内容包含段落、标题、列表、代码与链接，每次增加 256 个字符，测量 `updateContent` 加 `render`，先预热一轮，再记录五轮中位数。

| Reply size | Frames | Total before / after | Frame p95 before / after | Sampled heap peak delta before / after |
| --- | --- | --- | --- | --- |
| 2 KiB ASCII | 8 | 3.83 / 5.57 ms | 0.73 / 1.11 ms | 3.92 / 4.92 MiB |
| 16 KiB ASCII | 64 | 152.39 / 206.12 ms | 4.70 / 6.12 ms | 16.98 / 16.37 MiB |

外层列表增加了原生 Markdown 排版成本，16 KiB 用例总耗时增加约 35%，不能宣称没有性能退化。新增字符串转换按当前文本长度线性处理，无历史扫描或增长型缓存。五轮释放组件并执行 GC 后，16 KiB 用例的每轮 heap 增量均在约 -6 至 88 KiB 之间，此次测量未显示随轮次增长的组件保留，但不构成长时间运行的内存证明。表中的峰值是每帧结束后的 heap 采样增量，不是精确分配量或进程 RSS。

没有产品级帧耗时预算，因此保留这些数据供后续判断，不新增任意硬阈值。原生嵌套列表的排版成本不在本轮通过私有补丁规避。

复测命令如下，`--baseline` 只绕过 assistant 显示转换，其余使用当前正式代码：

```bash
pnpm run build
pnpm exec node --expose-gc prototypes/codex-edit-spacing-prototype/measure-replies.mjs --baseline
pnpm exec node --expose-gc prototypes/codex-edit-spacing-prototype/measure-replies.mjs
```

## Limits and sources

- `/copy` 的原文来源已通过宿主方法验证。终端选择复制取显示内容，包含布局标记；未自动操作系统剪贴板。
- 流式验证使用本地 provider fixture，并非联网模型服务验收。
- 手动重载或窗口缩放可以让宿主重排历史。本实现没有逐 token 的全历史刷新。
- 官方 [Markdown transformer 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#piregistermarkdowntransformertransformer) 由 Context7 查询，未固定到目标版本。接口另外对照本地 0.84.3、0.85.1 的类型与渲染源码，并通过上述打包 CLI 验证。
