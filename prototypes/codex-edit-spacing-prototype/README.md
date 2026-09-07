# Edit spacing prototype

## Question

摘要与 diff 不增加空行时，哪种分隔方式更容易扫读？在同一个真实 Pi transcript 中切换三个 edit 变体。

本轮回复布局对比：不用 Pi 内部补丁时，贴左、外层列表缩进和引用竖线，哪种更好读？长段落、标题、嵌套列表和代码块共用一份消息原文，转换只作用于显示。旧版圆点 gutter 原型保留为单独启动的对照。

## Landing map

- **Target**：`extensions/codex-ui/src/tools.ts` 的 edit `renderCall` 与 `renderResult`。
- **Context**：真实 Pi transcript、Read 参考行、两张 edit 卡片、thinking 摘要、原生 assistant 回复、生产编辑器和 footer。
- **Reply target**：通过公开 `registerMarkdownTransformer` 转换 assistant 文本，将其显示为一个外层列表项或引用块。thinking、工具卡片和编辑器不应用转换。旧版 `indented` 对照仍包装原生 `Markdown` 子组件。
- **Contract**：保留 `ToolExecutionComponent`、`renderShell: "self"`、共享行状态、`context.lastComponent`、`context.invalidate()`、终端宽度和 Ctrl+O 展开。包装器将内部生产组件传回生产 renderer，避免把装饰组件当作生产缓存组件复用。

## Run

在仓库根目录执行：

```bash
pnpm run prototype:edit-spacing
```

默认使用 fullscreen 模式，便于在相同位置切换比较。界面提示使用英文。

| Variant | Label | Treatment |
| --- | --- | --- |
| 1 | Tinted header | 摘要行铺满 `customMessageBg`，不改变文字和增删配色。 |
| 2 | Underlined header | 摘要文字加 ANSI underline，不另占一行。 |
| 3 | Diff rail | 在 diff 现有四格缩进内加入淡色竖线，不移动行号和源码。 |

- `Alt+1`、`Alt+2`、`Alt+3` 切换样式，也可输入 `/edit-style 1`、`/edit-style 2`、`/edit-style 3`。
- 回复默认使用 `list`。`/reply-style current` 切回贴左，`/reply-style list` 使用外层列表，`/reply-style quote` 使用引用竖线；`Alt+R` 循环切换。
- `--production-replies` 直接使用正式 `codex-ui` 的列表转换，不注册回复比较命令；edit 样式仍可切换。
- 默认使用正式打包 CLI，状态标注 `Public API`。要看旧版圆点 gutter，单独以 `--reply-style indented` 启动，状态标注 `Legacy lab host`，该进程可切换全部四种样式。
- macOS 上若 Option 键没有配置为 Meta，直接输入上述命令。
- `Ctrl+O` 展开或收起完整 diff。
- `Ctrl+D` 在空输入框退出。
- `/reload` 重新加载原型，edit 和回复布局恢复启动时指定的变体。

```bash
pnpm run prototype:edit-spacing --variant 2
pnpm run prototype:edit-spacing --variant 2 --reply-style current
pnpm run prototype:edit-spacing --variant 2 --reply-style quote
pnpm run prototype:edit-spacing --variant 2 --reply-style current --output-pad 1
pnpm run prototype:edit-spacing --variant 2 --reply-style indented
pnpm run prototype:edit-spacing --variant 2 --production-replies --pty-smoke
pnpm run prototype:edit-spacing --regular
pnpm run prototype:edit-spacing --smoke
pnpm run prototype:edit-spacing --pty-smoke
```

## Reply treatments

| Style | Treatment | Trade-off |
| --- | --- | --- |
| `current` | 不转换正文。 | 默认贴左，作为基线。 |
| `list` | 第一行前加 `- `，后续源文本行缩进两格，由原生 Markdown 排版。 | 自动换行和后续段落缩进，原有列表会再嵌套一层。 |
| `quote` | 每个源文本行前加 `> `。 | 每行显示竖线，并使用原生引用颜色和斜体。 |
| `indented` | 旧版首行圆点与两列 gutter。 | 依赖私有组件树，仅供对照，不属于公开接口方案。 |

`--output-pad 1` 可单独比较 Pi 原生的一列水平留白，需重新启动。它是全局输出设置，不只影响 assistant；默认值为 `0`。

## Real code and fixtures

入口加载当前生产 `codex-ui`，包装 edit 显示组件，并为回复注册原生 Markdown 显示转换。diff 解析、语法高亮、增删统计、长路径裁剪、折叠预览和隐藏行 footer 均来自生产代码。三种变体都不在摘要后留空行，保留 footer 前的空白行。包装器先去除生产摘要的下划线，再应用所选变体，保证方案 1 和 3 不叠加方案 2 的效果。错误、进行中和没有 diff 的结果不应用装饰。

`src/fixtures.ts` 提供静态恢复会话，包括接近原截图的 `+4/-0` 示例和短路径的 `+1/-1` 示例。文件名、工具参数和结果都是 fixture，不读取或修改对应文件。第一份 diff 使用英文内容，不是原截图的逐字复刻，此处属于 approximation。

回复 fixture 包含长段落、标题、嵌套列表、TypeScript 代码块、链接、行内代码和连续 thinking 摘要。排版与高亮均来自原生 Markdown，列表和引用样式的语义与视觉差异也保留，不用手工渲染掩盖。

正式 `codex-ui` 已采用外层列表方案。原型比较模式仅跳过生产 assistant 转换，再应用所选变体，避免双重包装，user 和 thinking 转换保持生产实现。`--production-replies` 则保留正式 transformer，关闭回复实验。

默认及 `current`、`list`、`quote` 启动路径直接使用包的 `bin.pi` 入口，不预加载、不修改组件原型。手动切换样式时通过公开 TUI `invalidate()` 刷新历史 Markdown 缓存；流式更新不执行全历史刷新。

Pi 0.84.3 没有公开的 assistant 组件包装接口，因此只有旧版 `indented` 启动路径使用同版本未打包的 `dist/cli.js` 入口，通过 Node `--import` 预加载宿主适配器。适配器在隔离进程中临时包装 `updateContent`，只处理 `spacing-ui-fixture` 消息，关闭或重载时恢复。不修改 Pi 安装文件。

启动器把 HOME、Pi 配置、缓存、会话和 workspace 隔离到本目录 `.tmp/run-*`，退出时删除。模型请求、工具执行和用户 shell 输入均被阻止；不继承凭据和代理变量，不连接生产服务。运行原型不会修改正式 edit 或回复样式，也不会将原型编译到 `extensions/**/dist`。

## Verification and limits

本轮通过仓库锁定的 Pi 0.84.3、Node.js 22.22.2、pnpm 11.9.0 验证。Context7 的 [tool renderer 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/tool-execution.ts) 未固定到 0.84.3，接口另外通过本地已安装版本的类型定义与真实 CLI 验证。

`--smoke` 使用真实 `ToolExecutionComponent` 检查无额外空行、三种样式、切换命令、宽度、展开、重绘、增删背景、源码对齐和错误状态。回复测试使用真实 `AssistantMessageComponent`，检查两列对齐、单个标记、多文本块、thinking 不变、窄宽度、逐步更新、切换和恢复。流式输入在组件测试中模拟，原型不会调用模型。

新增公开接口测试检查命令切换能刷新已渲染的回复，组件原型不变，原文和 thinking 不变，以及部分代码块、表格、中英文换行在 24、60、100 列下的表现。空白文本不会产生标记。转换按文本块执行，多文本块回复可能出现多个外层标记，不等同于旧版整条消息一个圆点。

`--pty-smoke` 使用系统 `/usr/bin/expect` 启动真实 Pi CLI，检查公开接口回复布局、edit 命令切换、Alt+3、Alt+R、Ctrl+O、窗口缩放、重新加载与退出。已分别验证正式打包入口和旧版未打包对照入口。

已验证三种方案都能在真实渲染路径中实现，不增加终端行数。用户已选择方案 2，正式 edit renderer 已实现摘要下划线并移除摘要后的空白行；仅有非空 diff 的成功结果应用下划线，进行中、错误、无 diff 和低功耗结果保持原样。underline 的位置和粗细受终端字体影响；标题背景依赖主题色，当前只用 `codex-pi` 暗色主题判断视觉效果。窗口宽度不足四格时不画竖线，优先保证宽度契约。

## Throwaway boundary

原型只帮助选择视觉方案。可复用 fixture 和宿主组件断言；正式实现应在生产 renderer 内实现选定规则并补回归测试，不直接迁移切换命令、provider、启动脚本或装饰包装器。只有旧版 gutter 适配器依赖 Pi 私有组件树，不能直接作为正式扩展发布。外层列表方案已正式落地，验证与性能记录见 [Reply list implementation](../../docs/plans/codex-ui-reply-list.md)。引用方案仍是实验，不能将它与正式列表方案的验证结果混为一谈。
