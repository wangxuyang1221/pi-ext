# Web search UI acceptance

## Delivery

已将认可的两行方案接入 `extensions/codex-search/src/renderers.ts`。本机 Pi 配置直接加载仓库 `extensions/codex-search/src/index.ts`，无需修改安装来源或根发布清单。运行中的旧会话仍需 `/reload` 或重启才能加载新代码，本次没有自动操作用户会话。

默认标题展示首条查询及剩余数量，结果行展示进度或摘要。查询和结果之间无空行，相邻搜索之间只保留 Pi 的一行前置间距。状态使用 `⏺`、主题语义颜色和静态标记，不再展示默认查询树、模式标签或重复完成对勾。

Ctrl+O 或用户配置的工具展开键显示完整查询、运行设置、模型、失败诊断和真实结果正文中的来源 URL。显示文本限制为宿主默认 50KB / 2000 行，并在宽度换行后限制显示行数；截断会明确提示，不改变发送给模型的正文。

## Implementation

- `renderers.ts`：独立加载的 compact renderer，复用组件、按结果 identity 缓存摘要、按需读取有界正文；处理窄窗口、主题切换、控制字符和旧历史记录。
- `standalone-renderers.ts`：保留原 Standalone 渲染实现。调用标题、Opened 等预览及原动画策略未改。
- `animation.ts`：`watch()` 增加可选动画开关。Web Search 只订阅活动状态，不建立周期 timer；Standalone 默认继续使用原动画。
- `index.ts`：从真正抛出的错误和 abort signal 提取 `searchFailure` 元数据，通过 `tool_result` 保存。保留原抛出对象、错误正文和 isError 语义，不根据正文出现 timeout 一词推断超时。
- 诊断暂存于当前执行与 `tool_result` 之间，消费后删除；agent settled 和 session shutdown 清理，generation 防止旧执行在 shutdown 后重新发布诊断。

成功来源数沿用原有 citations 条目总数，不新增去重规则。部分失败显示成功/失败计数和警告色。没有完整 metadata 的旧记录显示原始摘要或不可用提示，不编造成功状态和统计。

## Commands

```sh
# Formal renderer with offline fixtures in the real Pi TUI
pnpm run prototype:web-search --production

# Original approved reference prototype
pnpm run prototype:web-search

# Formal typecheck, all search tests, regular/fullscreen PTY and restart
pnpm run web-search:check

# Reference prototype regression
pnpm run prototype:web-search:check

# Repository check
pnpm run check
```

`--production` 使用正式 renderer 和 `WebSearchDetails` 形状的离线数据，不使用参考原型的私有状态 DTO 或颜色代理。搜索仍是 fixture，故障来自具名脚本，不连接真实模型或远端搜索。真正执行器的错误分类与元数据发布另由 `renderers.test.ts` 的网络边界 mock 测试覆盖。

## Verification

环境：Node.js 22.22.2、pnpm 11.9.0。开发依赖和本次 PTY 使用 Pi 0.84.3，本机日常 CLI 为 0.85.1。此前源码调研确认两版 self-shell 的前置间距行为一致，但本次没有在用户日常 0.85.1 会话中发起真实订阅请求。

- `pnpm run web-search:check` 通过，搜索扩展 80 个测试通过。
- `pnpm run prototype:web-search:check` 通过，参考原型 7 个测试及普通/全屏 PTY 通过。
- 两行布局、状态更新、展开、旧数据降级和错误 metadata 均按先失败测试、再实现通过推进。
- 正式 PTY 覆盖进度原位更新、成功/部分失败/超时/失败颜色、Ctrl+O、相邻调用单行间距、40/80/120 列缩放、主题切换和取消后重播。
- 正式 PTY 验证 `/reload` 后仍显示超时警告，并在退出、启动新进程后恢复同一条超时记录；不依赖上一进程的活动 map。
- 单元测试验证用户重绑定的展开提示、终端控制字符清理、极窄行宽、无 metadata/不完整 metadata、部分成功后的真实取消、预取消和 shutdown 后的迟到错误。
- Standalone 单独回归标题、Opened 预览、活动期间一枚原 timer，以及结束后零 timer。

## Performance

- Web Search 无周期刷新 timer；没有新进度事件时不请求主动重绘。时间随真实进度及最终结果更新，等待期间不保证每秒变化。
- 正常结束、取消和 shutdown 后，搜索活动从 map 删除，abort listener 解除，不再持有 row invalidator。
- 使用 1、1000、10000 个来源条目的输入，断言折叠态只计数，不访问单条来源；重复渲染和缩放不再访问已缓存的 successes 数组，也不读取各查询正文。
- 一次新结果的 metadata 验证与计数随查询数量增长；正文仅展开时按显示上限读取和缓存。没有要求返回结果本身占用恒定内存。
- 保留重复渲染耗时日志作为观察数据，不以一次实测值作为合格阈值。确定性计数、访问保护和 timer/listener 断言是性能验收依据。

## Repository check and cleanup

`pnpm run check` 的类型检查通过，1159 个测试通过、2 个测试跳过；一个既有 MCP 原型测试文件因缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 加载失败。因此全仓检查未进入构建和发布包校验，未声称全仓通过。该无关缺文件问题未修改。

检查日志：`.tmp/web-search-implementation-check.log`。正式 PTY 文本证据：`.tmp/web-search-production-regular-smoke.json`、`.tmp/web-search-production-fullscreen-smoke.json`。

本次没有启动监听服务。PTY 检查启动的子进程已退出，隔离 workspace 已清理；没有改写工作目录外配置、正式 dist 或其他任务的未提交改动，没有创建 commit。
