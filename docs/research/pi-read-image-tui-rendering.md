# Pi Read Image TUI Rendering Research

## Executive Conclusion

**能关闭，而且不需要修改 Pi 上游源码。** 对项目当前依赖的 Pi 0.84.3 和本机 CLI 0.84.4，首选做法都是设置：

```json
{
  "terminal": {
    "showImages": false
  }
}
```

可写入全局 `~/.pi/agent/settings.json`，也可写入项目 `.pi/settings.json`。项目设置覆盖全局设置。交互模式下也可进入 `/settings`，将 `Show images` 改为 `false`。官方设置文档将 `terminal.showImages` 定义为默认值为 `true` 的终端显示开关；设置文件位置及覆盖关系见 Pi 0.84.4 `docs/settings.md:5-10,350-366`，选项定义见 `docs/settings.md:179-190`。Pi 0.84.3 也已有同一选项，见项目依赖的 `node_modules/@earendil-works/pi-coding-agent/docs/settings.md:177-185`。

这个开关只抑制交互 TUI 的 inline image 组件，不删除 `read` 返回的 `ImageContent`，因此不会让模型失去图片。代价只是终端不再显示图片，fallback renderer 可能改为显示图片占位文本。当前 `codex-ui` 的自定义 renderer 会继续显示 `Image loaded` 摘要，但不会显示图片本体。

## Scope and Version Baseline

本仓库开发依赖固定为 `@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui` 0.84.3，见 `package.json:74-83`。本机官方 CLI 是 0.84.4，其包版本见下方 Pi 0.84.4 root 的 `package.json:2-3`。

本文使用以下第一方源码根目录：

- Pi 0.84.3 coding-agent：仓库内 `node_modules/@earendil-works/pi-coding-agent/`
- Pi TUI 0.84.3：仓库内 `node_modules/@earendil-works/pi-tui/`
- Pi 0.84.4 coding-agent root：`/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.4/5484b716e06098eef8d880198d4a9a05cf96cd39781283d853cb077259affc45/node_modules/@earendil-works/pi-coding-agent/`
- Pi TUI 0.84.4 root：`/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-tui/0.84.4/12f503858bff6b853643dbebc1e337514dbc1f03679a020712c6804f8ccf93b0/node_modules/@earendil-works/pi-tui/`

0.84.3 与 0.84.4 的 `dist/core/tools/read.js`、`dist/modes/interactive/components/tool-execution.js` 和 `dist/core/tools/render-utils.js` 内容相同。因此，`read` 结果与 TUI 行组件的核心链路没有版本差异。0.84.4 的新增点是 terminal capability override，详见后文。

## Rendering Pipeline

### Read Tool Result

图片路径被 `read` 识别后，工具读取二进制并调用 `processImage()`。处理成功时返回两个 content blocks：一个文本说明和一个 `{ type: "image", data, mimeType }`。这一步只产生工具结果，不负责 TUI 绘制。见 0.84.3 `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js:167-190`。0.84.4 同文件位置和逻辑一致。

### Extension Result Hook

工具完成后，`AgentSession` 先触发 extension 的 `tool_result` hook；若 hook 返回替换内容，就采用替换后的 `content`，随后统一执行图片规范化，并把最终结果交回 agent。见 0.84.3 `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:242-269`。

`tool_result` 是可修改结果的正式 hook，返回类型允许替换 `content`；见 `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:710-718,755-756,820-825`。与之不同，`tool_execution_end` 是通知事件，没有返回结果类型；见同文件 `:607-614,917-923`。

### Interactive TUI Row

交互模式在工具开始时创建 `ToolExecutionComponent`，把 `settingsManager.getShowImages()` 传入组件；见 0.84.3 `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:2631-2632,2696-2697,3019-3020`。工具结束事件到达时，交互模式把 `event.result` 交给该组件；见同文件 `:2716-2723`。

`ToolExecutionComponent` 才是决定是否增加图片组件的一层：

1. 构造函数保存 `options.showImages ?? true`，见 `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js:33-41`。
2. 它先调用工具的 `renderResult`，见同文件 `:246-270`。
3. 调用结束后，它独立扫描原始 `this.result.content` 中的 image blocks。只有 `caps.images && this.showImages && img.data && img.mimeType` 成立时，才创建并追加 Pi TUI `Image`，见同文件 `:278-303`。
4. 即使 `renderShell` 是 `"self"`，组件的 `render()` 仍会在自定义内容后逐个绘制 `imageComponents`，见同文件 `:186-210`。
5. 最底层 Pi TUI `Image` 再调用 terminal image encoder，见 `node_modules/@earendil-works/pi-tui/dist/components/image.js:1-3,28-53`。

所以，决定“是否把工具结果中的图片变成 TUI 图片组件”的是 coding-agent 的 `ToolExecutionComponent`，不是 `read` 的 renderer，也不是 `codex-ui`。

## ShowImages Semantics

`showImages` 有三个相关来源和用途：

- **持久设置**：`SettingsManager.getShowImages()` 读取 `terminal.showImages`，未配置时返回 `true`；见 0.84.3 `node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js:797-805`。0.84.4 对应位置为 `dist/core/settings-manager.js:806-815`。
- **现有组件即时更新**：`/settings` 的回调写入设置，并对聊天区已有的每个 `ToolExecutionComponent` 调用 `setShowImages()`；见 0.84.3 `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:3745,3785-3788`。开关只在终端报告支持图片时出现在设置列表中，见 `dist/modes/interactive/components/settings-selector.js:489-498`。
- **renderer 上下文**：`ToolRenderContext.showImages` 是“当前 TUI 是否显示 inline images”的只读状态信息；见 `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:314-339` 和 Pi 0.84.4 `docs/extensions.md:2240-2244,2262-2267`。renderer 可以据此调整自己的文字，但没有 setter。

当 `showImages` 为 `false` 时，内建 fallback 会为 image blocks 生成 `imageFallback` 文本，见 0.84.3 `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/render-utils.js:35-50`。自定义 renderer 是否显示类似文字由它自己决定。

## Custom Renderer Assessment

单独使用自定义 `renderResult` **不足以抑制图片**。它只决定结果区域返回哪个 `Component`，而 `ToolExecutionComponent` 会在其后再次扫描 `this.result.content` 并追加 `Image`。`renderShell: "self"` 也只改变 shell/framing，无法跳过追加过程。官方文档对两者的定义见 Pi 0.84.4 `docs/extensions.md:2240-2255,2290-2304,2352-2355`，实际追加顺序见 0.84.3 `tool-execution.js:246-303`。

理论上，renderer 可以利用当前实现中共享的数组引用，直接修改传入的 `result.content`。这会让后续扫描找不到图片，但它不是文档承诺的 display API 行为，可能同时篡改 session 中的工具结果，属于不应采用的副作用式 monkey patch。

当前 `codex-ui` 正是“自定义 renderer 仍保留 image content”的例子：

- 它包装 built-in `read`，保留原 `execute` 结果，使用 `renderShell: "self"` 和自定义 `renderResult`，见 `extensions/codex-ui/src/tools.ts:216-261`。
- `renderReadResult()` 检测 image block 后只输出 `Image loaded`，没有读取 `context.showImages`，见 `extensions/codex-ui/src/tools.ts:738-758`。
- 测试构造了同时含文本与 image block 的结果，并断言 renderer 输出 `Image loaded`，见 `extensions/codex-ui/__tests__/tools.test.ts:483-515`。测试上下文的 `showImages` 默认是 `true`，见同文件 `:252-267`。

因此，关闭 `terminal.showImages` 后，当前 `codex-ui` 仍显示 `Image loaded` 这一行，但 `ToolExecutionComponent` 不会追加图片本体。

## Available Solutions

| Option | Versions | Model image retained | Scope and cost |
|---|---:|:---:|---|
| `terminal.showImages: false` | 0.84.3, 0.84.4 | Yes | **推荐**。正式设置，只关闭 TUI inline image；全局或项目级均可。 |
| `/settings` → `Show images` → `false` | 0.84.3, 0.84.4 | Yes | 正式交互设置，立即更新现有工具行。若终端未报告图片能力，该菜单项不显示，可直接编辑 JSON。 |
| `terminal.images: false` | 0.84.4 only | Yes | 正式 JSON-only advanced setting。把终端图片能力整体设为不可用，范围比 `showImages` 更广；见 Pi 0.84.4 `docs/settings.md:183-190` 和 `dist/core/settings-manager.js:797-804`。 |
| `PI_IMAGE_PROTOCOL=none pi` | 0.84.4 only | Yes | 一次性启动环境变量。源码把 `none` 或 `0` 解析为 `images: null`，见 Pi TUI 0.84.4 `dist/terminal-image.js:95-110`。官方 README 的 CLI 表没有对应 `--no-images` 参数。 |
| SDK 注入 `SettingsManager` | 0.84.3, 0.84.4 | Yes | 正式 SDK API，适合自定义 host，例如 `SettingsManager.inMemory({ terminal: { showImages: false } })`。见 Pi 0.84.4 `docs/sdk.md:857-889` 及 0.84.3 `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts:10-53`。普通 CLI extension 拿不到等价的 `setShowImages` UI API。 |
| 覆盖或包装 `read` 并删除 image block | 0.84.3, 0.84.4 | **No** | 正式 `pi.registerTool()` API，可同名覆盖 built-in；见 Pi 0.84.4 `docs/extensions.md:2078-2099` 和 `examples/extensions/tool-override.ts:1-20,68-76`。只有 renderer 包装不够，必须改变 `execute` 返回的 `content`，模型随之失去像素内容。 |
| `tool_result` hook 删除 image block | 0.84.3, 0.84.4 | **No** | 正式 extension hook，可按 `toolName === "read"` 过滤，也可全局过滤。修改的是 agent 采用的最终结果，不是 TUI-only 副本。 |
| `--no-builtin-tools` 或 `--exclude-tools read` 后只加载 text-only read | 0.84.3, 0.84.4 | **No** | 正式启动参数与工具替换组合。代价同上，并需维护完整 read 行为。CLI 定义见 Pi 0.84.4 `README.md:579-588`。 |
| `-p`、`--mode json` 或 `--mode rpc` | 0.84.3, 0.84.4 | Yes | 不启动 interactive TUI，自然不会 inline render。代价是放弃交互 TUI；见 Pi 0.84.4 `README.md:540-548`。 |
| 修改 Pi TUI 全局 capability | 0.84.3, 0.84.4 | Yes | 技术上可从 extension 调用 `setCapabilities({...getCapabilities(), images: null})`。0.84.3 源码明确注释其用途是 tests，见 `node_modules/@earendil-works/pi-tui/dist/terminal-image.js:91-103`。这是进程级 monkey patch，可能被 reload 或 0.84.4 的 capability override 重置，不属于稳定的 coding-agent extension 设置 API，不推荐。 |

### CLI and Extension API Gaps

Pi 0.84.4 官方 CLI Reference 的 Modes、Tool Options 和 Other Options 中没有 `--no-images` 或 `--show-images=false`；见 `README.md:540-548,558-610`。extension 虽可通过 `registerFlag()` 添加自己的 flag，见 Pi 0.84.4 `docs/extensions.md:1651-1666`，但公开 `ExtensionUIContext` 只提供 tool expansion 等相关接口，没有 `setShowImages()`；见 0.84.3 `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:171-192,936-946`。因此，自定义 flag 本身无法通过正式 extension UI API 改变内建工具行的图片开关。

0.84.4 的 `terminal.images: false` 与 `PI_IMAGE_PROTOCOL=none` 是 capability 层方案。前者有正式设置文档，后者能从第一方源码确认，但未列入 coding-agent README 的 CLI options。二者都比 `terminal.showImages: false` 影响面更大。

## Model Visibility and Result Mutation

`terminal.showImages`、`terminal.images`、`PI_IMAGE_PROTOCOL` 以及 TUI capability monkey patch 都不修改 `result.content`，所以不会删除模型可见图片。`convertToLlm()` 对 `toolResult` 原样返回，见 0.84.3 `node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js:75-118`。

相反，通过 replacement `read` 或 `tool_result` hook 删除 image block，会修改最终工具结果。`AgentSession` 在 hook 后采用替换的 `content`，见 `dist/core/agent-session.js:242-269`，模型因此收不到图片。把图片挪到 `details` 也不能兼得，因为模型上下文使用的是 `content`，`details` 只供工具状态和 UI 使用。

`images.blockImages: true` 也不是本问题的解法。它的定义就是阻止图片发送给 LLM，见 Pi 0.84.4 `docs/settings.md:189-190`。实现是在 `convertToLlm` 阶段把 user/toolResult 中的 image block 替换成 `Image reading is disabled.`，见 0.84.3 `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js:146-174,184`。原工具结果仍可被 TUI 扫描，因此它可能让模型看不到图片，却仍不能保证 TUI 不渲染，方向正好相反。

目前没有公开的“同一 tool result 对模型保留 image，但只对 TUI 提供过滤后 content”逐结果 API。需要这种 display/content 分离时，应使用现成的 `terminal.showImages`，而不是改写结果。

## Version Differences

- **0.84.3 与 0.84.4 共同支持**：`terminal.showImages`、`/settings` 的 `Show images`、自定义 renderer 上下文中的 `showImages`，以及相同的 `ToolExecutionComponent` 图片追加逻辑。
- **0.84.4 新增**：`terminal.images`、`terminal.trueColor`、`terminal.hyperlinks` 等 capability override。类型见 Pi 0.84.4 `dist/core/settings-manager.d.ts:26-32`，应用入口见 `dist/main.js:9,683` 和 `dist/modes/interactive/interactive-mode.js:354,1528`。
- **0.84.4 新增**：Pi TUI 识别 `PI_IMAGE_PROTOCOL=none|0`；见 Pi TUI 0.84.4 `dist/terminal-image.js:95-110`。0.84.3 的 `terminal-image.js:35-103` 没有该环境变量解析与 `setCapabilityOverrides()`。
- **选择建议**：本仓库若需要同时兼容 0.84.3 开发依赖和 0.84.4 CLI，应只依赖 `terminal.showImages: false`。不要把 `terminal.images: false` 或 `PI_IMAGE_PROTOCOL=none` 当作跨版本方案。

## Recommendation

采用 `terminal.showImages: false`。若只希望当前项目关闭，写入项目 `.pi/settings.json`；若希望所有 Pi 会话都关闭，写入 `~/.pi/agent/settings.json`。注意项目设置会覆盖全局设置，且项目设置是否加载受 project trust 规则影响，见 Pi 0.84.4 `docs/settings.md:14-18,350-366`。

不建议修改 `codex-ui` 的 `renderResult` 来解决，因为 renderer 无法阻止外层追加图片。不建议过滤 `result.content`，除非业务明确接受模型失去图片。不建议 extension monkey patch terminal capability，因为已有更窄、更稳定、跨 0.84.3/0.84.4 的正式设置。
