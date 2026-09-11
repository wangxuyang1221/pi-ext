# Write / Edit validation

## Status

本次在 `main` 上实施，基线为 `957e589e2f890274a7b682a58dac75ffaa9e5763`。用户已确认原型的静态进行中、灰色成功点、红色失败叉及 12 行 diff 预览。资源上限与降级文案已获用户确认并实施。类型检查、测试、发布包检查，以及两个 Pi 版本的普通、全屏 CLI 验收均已通过。

原始清单保存在 `/Users/wangxuyang/Code/pi/claude-code/docs/todos/codex-ui-write-edit.md`。其中目标 worktree 已合并到当前仓库，用户明确允许在当前 `main` 施工。没有自动提交。

## Implemented

- `extensions/codex-ui/src/tools.ts` 共用静态进行中标题和完成结果渲染。目录弱化、文件名突出；进行中不展示正文、统计或展开详情，不增加定时刷新。失败标题仅有一个红叉；省略提示与定稿原型一致，正文后没有额外空行。
- `extensions/codex-ui/src/write-changes.ts` 使用公开 `createWriteToolDefinition(cwd, { operations })`。每调用独立采集，采集发生在权限放行后的 execute 内、内置 mutation queue 内。没有在外层再套文件锁。原 mkdir、UTF-8 写入、取消检查和模型可见结果保留。
- `details.codexWrite` 保存 version、可靠的新建/覆盖动作和可用 patch。旧正文只在本次调用期间持有，执行失败时不生成成功 patch。渲染使用持久结果，不从当前磁盘反推历史变化。
- 非文本、旧正文不可读或 diff 生成异常时不伪造 patch，仍保留本可成功的写入。自定义 Write factory 不启用本地采集，保留原 factory 的参数、元数据、cwd 和回调委托。
- low-power Write 只 stat 识别操作，不读旧正文、不计算 diff。low-power Edit 保留原有有界 patch 预览。
- 缺少变化元数据的旧 Write 结果仍使用中性的 Write 标题与原有总行数摘要。该数字不是增删统计。

## Test evidence

已观察的 Red → Green：

1. 静态进行中测试先看到旧 `Write` 标题而失败，随后通过。测试同时检查不同宽度、展开时正文不可读、零高亮、零定时器及零主动刷新。
2. 省略提示测试先因 14 行输出而非 13 行失败，随后改为 12 行正文加一行轻量提示。
3. 失败状态测试先看到旧圆点而失败，随后统一为单红叉及不带重复叉号的错误正文。
4. 真实 Write 测试先因没有 `details.codexWrite` 失败，随后验证新建、覆盖 patch 与原模型文字。
5. low-power 执行测试先因生成了完整 patch 失败，随后验证旧文件读取及 diff 调用均为零。
6. 持久结果渲染测试先因重新读取 content 参数失败，随后验证 Write 与 Edit 相同 diff 的 ANSI 输出一致。
7. 旧 Write 成功标记测试先因绿色圆点失败，随后灰色完成点通过。
8. 编码与参数隔离测试先出现未实际写入的文本，随后改为使用 writeFile 接收到的原始字符串及其 UTF-8 编码结果。
9. 不可得 diff、文本与 patch 上限测试先失败，随后验证真实写入成功、无虚构统计，以及恰好达到上限仍可生成 patch。
10. 长行测试先因高亮输入超限失败，随后验证 Write、Edit 和直接 diff 渲染均只高亮有界前缀，保留完整文本、不截断代理对，重复渲染复用缓存。

补充回归覆盖同路径并发 Write/Edit、符号链接别名、快照读取失败、不变内容、空文件、末尾换行、BOM、写入失败、取消后字节已落盘、后续操作恢复。读取失败通过注入 EACCES/ENOENT/EIO 检查，不等于真实 OS 权限矩阵已全部验收。

使用真实 SessionManager 写入仓库内临时 session JSONL，重新打开后删除源文件，再通过真实 ToolExecutionComponent 恢复、展开和 resize。恢复后的文件读取与 diff 计算调用均为零。临时目录在测试 finally 中删除。

最后一次完整 `pnpm run check` 通过，包含类型检查、1088 项测试、构建与发布包检查，另有仓库原有 2 项集成测试跳过。`git diff --check` 通过。第一次检查发现两个旧标题断言并已更新；另一次运行曾超时，未将超时计为通过。

## Performance measurements

环境为 Node `v22.22.2`、pnpm `11.9.0`、Pi `0.84.3`，终端宽度 92。基线通过 `git archive HEAD extensions/codex-ui/src` 保存并编译到仓库内 `.scratch/write-edit-baseline`。每个版本、样本单独启动 Node，执行三轮实际覆盖、折叠、展开和重复绘制。使用固定基线在前的顺序，未做反序与多次进程统计，数值只能作为当前诊断。

复现入口：

```bash
node extensions/codex-ui/__tests__/fixtures/write-benchmark.mjs .scratch/write-edit-baseline/dist/tools.js lines1800
node extensions/codex-ui/__tests__/fixtures/write-benchmark.mjs extensions/codex-ui/dist/tools.js lines1800
```

样本还支持 `short`、`token50k`。后者是 50 KiB 单行 TypeScript 标识符。最初诊断结果为 `.scratch/write-edit-benchmark.jsonl`，加上资源上限后的复测结果为 `.scratch/write-edit-benchmark-bounded.jsonl`。下表采用复测结果。

下表为三轮中位数，单位 ms。峰值 RSS 是整个独立进程的峰值，包含 Pi 加载和三轮操作，不是功能的独占内存或硬上限。

| Sample | Execute before / after | Collapsed before / after | Expand before / after | Details bytes after | Peak RSS before / after |
| --- | --- | --- | --- | --- | --- |
| short | 0.33 / 0.39 | 0.04 / 0.34 | 0.03 / 0.08 | 138 | 169.5 / 168.9 MiB |
| lines1800 | 0.19 / 211.68 | 0.07 / 0.72 | 0.03 / 81.75 | 82066 | 170.0 / 232.4 MiB |
| token50k | 0.39 / 0.81 | 0.04 / 21.74 | 0.03 / 0.52 | 102566 | 170.1 / 169.6 MiB |

两版本每轮都观察到 2 次宿主 requestRender，来自生命周期更新；新增 diff 功能没有周期刷新。不能据此宣称整个宿主不刷新或 CPU 有固定降幅。基线只显示 Write 摘要，新版本增加实际 diff，耗时差异反映新增工作量。

独立调用官方 helper 时，两份各 1800 行完全不同文本的 diff 耗时约 214 ms，各 4000 行约 1089 ms。输入合计只有约 162 KiB 时也可能阻塞约一秒，不能只按字节设置限额。

独立调用 `highlightCode` 高亮 50 KiB 单行 TypeScript 标识符约 1925 ms；同一字符串的 visibleWidth 和 truncateToWidth 分别约 0.48 ms、0.15 ms。最初无上限实现中，两条变化行约产生 4 秒冷渲染成本。限定高亮前缀后，该样本三轮冷渲染中位数为 21.74 ms。该结果只适用于此样本，不是任意语法的延迟保证。

## Resource boundaries

- 旧、新文本各不超过 1 MiB，合计不超过 4000 个逻辑行。快照采用有界文件句柄读取，文件增长时不把局部快照当成完整内容。无法读取、非文本、超限或 diff 失败时，保留可靠动作，普通模式显示 `Diff unavailable`，不伪造统计。
- 保存的 patch 不超过 2 MiB。该检查发生在官方同步 helper 返回之后，不代表 helper 的临时分配受 2 MiB 限制，也不是计算超时机制。
- Write / Edit 每行最多向语法高亮器传入 4096 个 UTF-16 单元，边界不拆代理对。剩余源码不着语法色，但保留原文、行号和增删底色。
- 限额按单次调用计算，不是整个进程或长期历史会话的内存上限。4000 行以内的差异仍可能造成可感知同步计算。未测大型历史会话的整体性能，也未给出最坏延迟保证。
- 内置队列只协调 Pi 内部操作，不能保证外部进程并发修改下的原子快照。

## CLI acceptance

`extensions/codex-ui/__tests__/fixtures/write-cli-smoke.mjs` 使用真实 expect PTY 和 xterm-headless 解析终端输出。离线 fixture 只替换模型传输，加载全部七个包内扩展，不替换生产 Write / Edit 执行。所有隔离目录位于仓库 `.scratch`，结束后删除并清理子进程。

Pi 0.84.3、0.85.1 各自的 regular / fullscreen 均通过以下断言：静态进行中及展开隐私、新建与覆盖、Edit、真实写入失败、权限拒绝不落盘、超限降级、12 行折叠与完整展开、窄屏 resize、`/reload`、退出后重开 session 恢复，以及成功点 dim、失败红色和进行中 warning 色。JSONL 中验证保存的真实工具结果与 Write patch。此测试不覆盖所有扩展的每个功能组合。

```bash
node extensions/codex-ui/__tests__/fixtures/write-cli-smoke.mjs
# Set WRITE_SMOKE_AGENT_ROOT to test a different installed Pi version.
```

脚本复用 `prototypes/codex-ui-performance` 已有的 `@xterm/headless` 5.5.0，依赖系统 `/usr/bin/expect`，属于可选验收入口，不加入默认单元测试。证据保存在 `.scratch/write-cli-0.84.3.json` 与 `.scratch/write-cli-0.85.1.json`，含 CLI 路径、哈希、终端各阶段、事件和 session 记录。没有启动或停止用户自己的原型会话。

## API sources

Context7 `/earendil-works/pi` 提供 main 文档，不保证固定版本。本次以项目安装的 `0.84.3` 的 `dist/core/tools/write.js`、`write.d.ts`、`file-mutation-queue.js`、`edit-diff.js` 和 `docs/session-format.md` 核验执行与持久化契约。

- [Extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Built-in Write source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/write.ts)
