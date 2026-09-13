# Tool status acceptance

## Result

已将用户选定的大圆点 `⏺` 和原 Bash 亮灰正文接入正式 renderer。实现范围为 codex-ui 的 Bash、Read、Edit、Write，以及 MCP 工具调用；不改变工具执行、并发、权限、持久化结果或模型可见返回值。

- 标记占一列，后接一个空格，工具标题加粗。参数生成、可见等待态和执行中统一黄色，成功绿色，失败红色；可靠识别的中断、超时为黄色。
- Bash、Read、MCP 正常正文使用语义颜色 `text`，codex-pi 中为 `#d6d6d6`。辅助信息仍弱化，文件名强调色和 diff 增删配色保留。
- 没有修改全局 `toolOutput`。它还用于 subagent 和默认工具卡片，全局提亮会超出此次范围。
- Read 保留相邻分组、成员独立状态及 Ctrl+O；Bash 保留逐条命令和输出。Edit、Write、MCP 不新增 batch 卡片。full Bash 仍隐藏尚未执行的 pending 行，低功耗 Bash 仍在展开后显示有界正文。
- 状态标记静止，不增加计时器、轮询、周期失效或全局历史状态表。原型播放命令、模拟结果、主题代理与并行覆盖未进入正式入口。

## Diagnostic rules

只在宿主已经标记失败时应用警告色，不能用普通结果中的关键词推断失败或取消。

| Tool | Warning recognition | Fallback |
| --- | --- | --- |
| Read / Edit / Write | 单个 text block 精确等于原生异常 `Operation aborted` | 其他失败保持红色；原生文件工具没有本次可核验的 timeout 契约 |
| Bash | 原生尾部诊断 `Command aborted` 或 `Command timed out after N seconds` | 未匹配的失败保持红色；保留原有退出码和截断提示处理 |
| MCP | 匹配当前工具身份的本扩展取消或归一化超时异常，且结果缺少服务器 metadata，允许 Pi 序列化的空 `details: {}` | 有服务器 metadata 的普通错误结果不改判；无法拆分 server/tool 的历史 identity 只识别精确取消句式，其余保持红色 |

Read 的中断说明保留在文件行及诊断行；Edit、Write 保留原生异常文字。MCP 折叠摘要显示 `Interrupted` 或 `Timed out`，避免长诊断因宽度不足被省略后只剩一个黄色圆点。低功耗 Bash 的原始诊断仍可展开查看。

## Test development

生产测试直接导入正式 renderer，没有依赖原型源码替换或 fixture outcome map。

1. 五类工具的 glyph、间距与生命周期颜色测试先失败，再统一实现。正常正文与弱化辅助信息分别断言。
2. 原生取消、Bash 超时以及 MCP 严格异常信封测试先失败，再接入识别逻辑；普通错误文字、错工具身份和服务器 metadata 仍要求红色。
3. PTY 暴露了 MCP 抛出异常经宿主序列化为 `details: {}` 后错误变红的问题。补测试后修正；长超时摘要缺少可见说明的问题也按失败测试、修复、PTY 复验推进。
4. 缓存测试暴露低功耗 Bash 每次重绘都重新读取失败正文的问题。改为复用有界结果准备阶段的分类后通过。原有结果捕获与 diff 缓存测试保持通过。
5. 用户随后要求取消灰色等待态。将参数未生成完和已生成但尚未执行的断言统一改为黄色，正式 renderer 与参考原型测试均先失败再通过。内部等待/执行状态保留，full Bash 的隐藏等待行不变。PTY 增加逐次屏幕更新检查，旧构建在 MCP 参数生成阶段触发灰色断言，重新构建后通过，不再只验执行中的 hold 画面。

真实执行验证包括原生 Read/Edit/Write/Bash 的预取消异常、实际 Bash 部分输出后超时，以及本地 HTTP MCP 请求的取消和超时。MCP 测试确认请求不被重放，关闭连接、服务器和 socket 后结束。

## Verification

环境为 Node.js 22.22.2、pnpm 11.9.0、仓库固定 Pi 0.84.3。Context7 没有精确的 0.84.3 文档快照，接口依据本地安装版本的源码、声明和官方示例。参考 [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[TUI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md) 与 [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)。本轮没有在全局 Pi 0.85.1 上重复完整矩阵。

| Command | Result |
| --- | --- |
| `pnpm run check` | 类型检查通过；1148 个测试通过、2 个跳过；1 个既有 suite 因缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 失败，命令因此未进入构建与发布校验 |
| `pnpm run tool-status:check` | 独立构建通过；正式 renderer 的五组真实 PTY 验收全部通过 |
| `pnpm run prototype:tool-status:check` | 5 个原型测试与五组视觉对照 PTY 全部通过 |
| `pnpm run package:check` | 仍因既有 `docs/goal-descendant-acceptance.md` 缺失而失败；检查在首个缺失路径处停止，不能据此认定其余发布项全部通过 |
| `git diff --check` | 通过 |

正式 PTY 使用当前构建的 codex-ui/MCP 模块副本，不做源码替换或状态颜色代理。矩阵覆盖 regular/fullscreen、完整/低功耗，以及不加载 codex-ui 的独立 MCP renderer。各组检查 40/80/120 列、中文文件路径、Ctrl+O、主题切换、`/reload` 和新进程恢复持久化历史；完整模式另检查流式输出及五类批量混合状态。

PTY 的模型、Bash 进度和 MCP 响应来自离线 fixture，不等于真实远端 MCP 验证。Read/Edit/Write 成功场景操作隔离目录内的真实文件。实际 Bash 超时及 HTTP MCP 生命周期由上述执行测试覆盖。

性能检查使用可控时钟验证本次样式新增零计时器、零周期刷新，并用内容 getter 计数验证稳定重绘不重新捕获输出。Read/Bash 分组覆盖 1/3/20 项、3/1800 行、乱序完成、混合成功/失败/中断和主题切换；沿用现有分组、渲染管线与低功耗缓存回归测试。没有新增按结果长度增长的状态扫描，但原有分组遍历和必要布局计算仍存在。

这不是实际终端 CPU 基准。宿主已有的窗口标题 spinner 等功能仍可能发出 OSC 更新，不能据此承诺零 CPU 开销。

## Delivery and limits

- 由 `pnpm run build` 生成 `dist/`。本地安装指向此仓库时，重启 Pi 并恢复会话即可加载，不以 `/reload` 代替代码升级。
- 验收记录保存在忽略目录 `.tmp/check/tool-status-*.log` 与 `.tmp/tool-status-smoke-*.json`。自动验收启动的子进程、隔离 workspace 与本地 HTTP 监听均已结束；用户此前打开的原型进程不在清理范围内。
- 原有可选 `extensions/codex-ui/__tests__/fixtures/write-cli-smoke.mjs` 已同步 glyph/颜色断言，但缺少其专用 `@xterm/headless` 依赖，未运行。此次新 PTY 矩阵不依赖该脚本。
- 未验证真实远端 MCP、付费模型请求、任意第三方工具或真实终端 CPU。Goal footer、MCP 服务连接状态与 subagent 卡片不在此次改动范围内。
- 全仓检查和发布校验仍有上述既有阻塞。没有补造缺失文件、删除断言或跳过失败 suite 来制造全绿结果。
