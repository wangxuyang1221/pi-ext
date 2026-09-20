# Skill icon and color verification

## Decision scope

本轮沿用用户倾向的无底色方案。用户要求同时试 `⌘` 和立方体，并指定新截图中的青色。当时颜色、两处一致标识和整体编辑已有方向，图标尚未选定。后续用户选择cube为默认，command为手动降级，并确认通过命令切换、记住选择。最终有效要求见[Spec](https://github.com/wangxuyang1221/pi-ext/issues/2#visual-references)。当前只改隔离原型，不改日常插件或终端设置。

## Color sampling

读取用户提供的 `pi-clipboard-75d1eb0e-c1f0-45c1-a8d7-2607ec60b8cb.png`，用 Pillow 将像素转为 RGB。过滤 G、B 大于 150 且 R 小于 150 的前景像素，再按出现次数排序。

- 主体色 `RGB(141, 249, 253)`，即 `#8DF9FD`，出现 1721 次。
- 次高颜色 `(138, 244, 248)` 只有 33 次，其他边缘颜色属于抗锯齿过渡。
- `command`、`cube` 的图标和名称统一使用主体色，不增加背景或粗体。没有复用上一版蓝色数值。

源截图来自用户临时剪贴板目录，不复制上传。主体色与统计结果在本文件保留，不依赖临时图片存续。

## Glyph verification

| Variant | Glyph | Code point | Pi visible width |
| --- | --- | --- | --- |
| command | ⌘ | U+2318 | 1 |
| cube | 󰆧 | U+F01A7 | 1 |

立方体对应 Nerd Fonts 的 `md-cube_outline`。已通过官方 glyphnames 检索以及本机安装字体的 cmap 交叉核验。

本机字体 `/Users/wangxuyang/Library/Fonts/JetBrainsMonoNerdFontMono-Regular.ttf`：

- 版本字符串为 `Version 2.304; ttfautohint (v1.8.4.7-5d5b);Nerd Fonts 3.4.0`。
- cmap 中 U+2318 对应 `uni2318`，U+F01A7 对应 `md-cube_outline`。
- 使用现有 fontTools 4.63.0 的 TTFont/getBestCmap 和 name 表只读核验，未安装或修改字体。
- Pi 0.86.0 的 visibleWidth 对两个字形都返回 1。内部标签投影不随图标改变，只替换渲染字形，所以 supplementary-plane 的 UTF-16 长度不改变原文光标坐标。

已确认字体安装与字形存在，未确认用户当前终端实际采用的字体或 fallback。若实际终端显示方框，可选择支持 U+F01A7 的 Nerd Font，或按后续已确认方案通过命令手动切换为 `⌘`。不承诺自动识别缺字，也不承诺command在任意字体中都可用。本轮不自动修改终端配置。

## Fallback decision verification

Planning #13 已确认command作为手动降级，不是隐藏图标。用户提供的后续截图显示 `⌘`，与已有command原型一致；截图中的宿主背景不代表新增标签背景。两处样式、颜色和原文/整体编辑不变。

复用既有command/cube × Codex/native四组PTY证据。切换命令与持久化偏好是待正式实现的要求，不将原型 `/prototype` 命令视为已经交付。Context7的main文档确认registerCommand与命令上下文reload的公开入口；实际版本仍为Pi 0.86.0。本仓库也已有扩展通过getAgentDir定位用户配置，表明无需更改终端或安装字体来保存图标选择。

命令名、参数校验、配置写入失败及重启/reload恢复由后续显示/设置切片验证，实际安装与两种图标的真实终端覆盖归整体验收。本次没有写入全局配置。

## Preview limits

PNG 仍来自实际 Pi PTY 字符与颜色网格。文字使用既有 Menlo/PingFang 近似，两个新图标使用上述已安装 Nerd Font 绘制，不用手画图形冒充终端输出。Pillow 字形栅格化、基线和行距不代表用户终端的精确呈现。

`capture.py` 的 `MENTION_UI_ICON_FONT` 可指定截图用字体路径；立方体预览会核验 cmap 包含 U+F01A7，否则失败，不静默绘制缺字方框。此变量只影响截图，不改变真实 Pi 的终端字体。

## Verification

- `command` 的新字形/青色/背景继承测试先失败后通过，再完成 `cube` 的字形、单格宽度、真实 Markdown、整块编辑测试的 Red/Green。连同已有测试共 10 项通过，独立 TypeScript 检查通过。
- command/cube × Codex/native 四组真实 CLI PTY 通过。覆盖输入和发送后字形/青色、背景继承、原生卡片、源文与快照、图标不进入模型、补全、整块移动/删除/撤销、历史及两图标间 reload 往返。
- [command/Codex](skill-ui-command.json)、[cube/Codex](skill-ui-cube.json)、[command/native](skill-ui-command-native.json)、[cube/native](skill-ui-cube-native.json)保存字形码点、颜色、截图字体、PID、退出码、断言及屏幕文本。
- 四个最终 PID 为 77567、77991、78221、78804，正常退出并回收，临时目录已删除。用户此前启动的原型保留。无监听服务或终端设置变更。
- [测试日志](skill-ui-icons-tests.log)、[全仓检查](skill-ui-icons-check.log)、[构建](skill-ui-icons-build.log)、[包检查](skill-ui-icons-package-check.log)。全仓仍有既有 MCP 缺文件失败，包检查仍缺旧文档，构建通过，不将局部通过宣称为全仓通过。

## Sources

- [Nerd Fonts glyphnames](https://raw.githubusercontent.com/ryanoasis/nerd-fonts/master/glyphnames.json)：检索得到 md-cube_outline 为 F01A7，本机 Nerd Fonts 3.4.0 cmap 对应同一名称。
- [Nerd Fonts cheat sheet](https://www.nerdfonts.com/cheat-sheet)：可搜索 md-cube_outline。
- [fontTools TTFont](https://fonttools.readthedocs.io/en/latest/ttLib/ttFont.html)：Context7 仅覆盖 main，具体行为已用本地 4.63.0 执行核验。
- Pi API 与原型运行依据见[原型 README](../experiments/skill-mention-ui/README.md)。
