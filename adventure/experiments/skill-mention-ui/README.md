# Skill mention UI prototype

## Question

在无底色、统一青色的整体标签中，命令图标与线框立方体，哪种更适合用户？

用户认为 blue 方案尚可，但否定菱形图标，要求 `⌘` 和立方体都做，并指定新截图中的青色。本轮两版均沿用无底色、正常字重、整块编辑，图标和名称统一为从截图提取的 `#8DF9FD`。

- `command`：`⌘` 命令图标，默认入口。
- `cube`：Nerd Fonts 的线框立方体 `md-cube_outline`，U+F01A7。

两版的图标都占一格，留白与交互相同。用户已选择cube；command与旧gray/blue保留为原型对照，不要求产品提供这些变体。最终要求见[Spec Visual references](https://github.com/wangxuyang1221/pi-ext/issues/2#visual-references)。

## Landing Map

- Target：Pi 0.86.0 主输入框和普通 user 正文，原生 skill 卡片保留。
- Context：真实 Pi CLI、完整 codex-ui、补全菜单、编辑器、Markdown renderer 与消息历史。周边界面不重建。
- Contract：组合公开 editor factory。编辑器内部保存实验性标签投影；getText、getExpandedText、onChange、onSubmit 返回原始 `$skill-name`。补全确认生成标签，提交与快照继续用原文。正文通过 Markdown transformer 显示标签。

## Boundary

只写本实验目录和 adventure/evidence、progress，不修改产品 src、发布入口、当前全局安装或用户配置。依赖固定现有 Pi 0.86.0。Context7 只有 main 文档，版本行为以安装包声明、源码及实际 CLI 核验。

真实入口采用离线 faux provider。`presentations` 与 `lark-doc` 是沿用原描述的具名 fixture，正文无外部操作。原生 skill 卡片、补全、加载、协议和历史 adapter 复用产品代码。标点适配、标签投影和输入包装是实验代码，不向真实 provider 发送请求。

不模拟像素级圆角边框。command 使用常见 Unicode 图标；cube 需要支持 U+F01A7 的 Nerd Font。本机已安装字体包含该图标，但未确认终端当前实际字体或 fallback，也没有改终端配置。PNG 字体与行距属于 approximation，实际终端显示为准。

## Behavior

- Tab 或 Enter 确认 skill 补全后，文字转成整体标签。左右键跨过整个标签；Backspace、Delete 整块删除；撤销恢复完整标签。
- 已有示例草稿、setText 和历史回填中的已知引用转成标签。纯手写或粘贴仍可按原文激活，输入时不会自动转成标签；何时将这两种输入转成标签尚未定稿。
- 发送后仅对已成功加载快照中的名称显示标签。输入标签表示确认了名称，不保证后续文件读取成功。
- 右侧示例标点允许激活，候选仍要求双侧空白。未知名称、代码和转义不转标签。
- 模型、快照及回调收到 `$skill-name`，不包含图标、颜色或实验投影标记。普通用户输入的 `‹ ◇ presentations ›` 不会被误当作引用。

## Run

```bash
cd /Users/wangxuyang/Code/t3code/pi-ext-skill-mentions
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs command
# Or start the outline cube version:
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs cube
```

打开即有示例。可以先发送查看正文效果，再清空草稿，输入 `用 $pre` 并按 Tab，试左右键、退格、撤销。回复固定为离线 `Fixture response`，不执行 skill 内容。

`/quit` 退出，launcher 删除独立 HOME、配置、fixture 和 session。加 `--native` 可试原生编辑器。用 `/prototype command` 或 `/prototype cube` 切换；若终端仍运行上一版代码，先 `/reload`。切换后已发送消息会使用新样式，输入新引用并确认补全可比较输入效果。

旧 `chip` 命令作为 `command` 的别名。旧 `accent`、`tint`、`gray`、`blue` 仅保留作为历史对照。

## Preview

- [A：命令图标，上方发送后、下方输入](../../evidence/skill-ui-command-detail.png)
- [B：线框立方体，上方发送后、下方输入](../../evidence/skill-ui-cube-detail.png)
- 完整 Codex UI：[command](../../evidence/skill-ui-command-both.png) / [cube](../../evidence/skill-ui-cube-both.png)
- 原生编辑器：[command](../../evidence/skill-ui-command-native-both.png) / [cube](../../evidence/skill-ui-cube-native-both.png)

PNG 来自实际 PTY 字符与颜色网格，不是重建网页，也不是 macOS 窗口截图。局部图只裁剪真实网格图。第二行的代码内容沿用原生代码颜色，不代表激活。

## Verification

```bash
pnpm exec vitest run --config adventure/experiments/vitest.config.ts adventure/experiments/skill-mention-ui/chips.test.ts adventure/experiments/skill-mention-ui/ui.test.ts
pnpm exec tsc --noEmit --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node adventure/experiments/skill-mention-ui/*.ts
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs command --capture
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs cube --capture
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs command --native --capture
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs cube --native --capture
```

- 原有整体标签交互和样式测试保留。command、cube 两项图标/指定青色测试分别完成 Red/Green。[10 项测试](../../evidence/skill-ui-icons-tests.log)通过，独立 tsc 通过。立方体虽然是 supplementary-plane 字符，其显示仍为单格，输入和删除坐标未改变。
- 最终方案使用公开 getCursor、handleInput、setText 等方法，不修改原 editor 的方法或 prototype。测试核对原方法引用未变。最初内部 segmenter 探针虽能运行，但与此前公开 API 约定冲突，已撤除，不作为交付代码或结论。
- 四组真实 CLI PTY smoke 通过，覆盖 command/cube × Codex/native。保留原有交互与提交断言，验证两处图标与指定青色、继承背景，以及两种图标之间 reload 往返。
- PTY 记录：[command/Codex](../../evidence/skill-ui-command.json)、[cube/Codex](../../evidence/skill-ui-cube.json)、[command/native](../../evidence/skill-ui-command-native.json)、[cube/native](../../evidence/skill-ui-cube-native.json)，包含最终 PID、退出码、字形、取色、截图字体、断言和屏幕文本。本轮启动的进程正常退出回收，对应 launcher 临时目录清除，无监听服务。用户此前手动启动的 tint 原型及其目录保留，不擅自关闭。
- [全仓 check](../../evidence/skill-ui-icons-check.log)仍为 typecheck 通过、2070 passed/5 skipped，仅既有 MCP 缺文件 suite 失败。[build](../../evidence/skill-ui-icons-build.log)通过，[package:check](../../evidence/skill-ui-icons-package-check.log)仍缺旧文档。未修改旧门槛或恢复无关文件。

截图脚本使用已有 Conda codex-py312、pyte 0.8.2、Pillow 12.3.0 和 fontTools 4.63.0。图标截图使用本机现有 JetBrainsMono Nerd Font Mono 3.4.0，可用 `MENTION_UI_ICON_FONT` 指定其他截图字体。普通交互入口仅需现有 Node/Pi 依赖，终端须能显示所选图标。详细[取色、字体及边界证据](../../evidence/skill-ui-icon-font-and-color.md)。

## Implementation limits

- 投影使用不可见分隔符区分真实标签与外观相同的普通文本，内部留白用等宽非空白字符避免普通软换行断开；渲染时改回空格。它是一次性实验表示，不是生产富文本数据结构或安全边界。
- 标签比整行还宽时会被原生编辑器拆行，样式可能降级。测试仅覆盖标签能放入一行时的 27 列渲染和 104 列 PTY，不宣称所有极窄终端、裁剪、滚动或折叠粘贴已通过。
- 原子删除借用公开 setText 保存单个原生 undo 快照，再通过方向键恢复位置。这可能影响原生历史浏览状态；生产版本需要明确文档模型、坐标和 undo/redo 策略。
- 已验证常规方向键、删除、撤销及相邻 Ctrl+W。鼠标包装会吸附光标，但物理鼠标、选区、IME、自定义键位、复杂按词剪切、外部编辑器和跨 session 恢复未验收。原型不能替代日常编辑器。
- 手写、粘贴、reload 后重建的旧历史何时投影为标签，完整标点语法和原文到显示文本的选择/复制规则仍需后续规划。不要由这次试验自动推导产品要求。
- live 正文关联沿用按任务文本匹配的实验方案，不覆盖同文不同快照、队列/分支/压缩。不替代产品 requestId 关联。
- 仅验证 codex-pi 主题和固定两个 fixture。视觉方案已选定并移交Spec，cube字体兼容由Planning #13补齐。不保证所有字体或主题一致，截图不能证明用户当前终端的字体配置。
- Markdown 显示采用 display-only 代码 span 与 ANSI 并恢复父背景；不能当作生产富文本架构。

## Sources

- [Pi editor composition / Markdown transformer](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/extensions.md)，本地 0.86.0 文档已完整核验，Context7 仅提供 main。
- [Pi Editor](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/components/editor.ts)，getCursor、setText、handleInput、补全、undo 与换行依据，同时核验本地对应 dist 源码。
- [Pi rainbow-editor example](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/examples/extensions/rainbow-editor.ts)，渲染装饰参考。
- [Pillow 12.3.0 ImageDraw](https://github.com/python-pillow/Pillow/blob/12.3.0/docs/reference/ImageDraw.rst)，Context7 匹配 12.3.0，截图栅格化与裁剪使用现有接口。

## Handoff

用户已选择cube，Planning #11已通关并将要求移交Spec。#5已修订通关，正式边界见Spec，勿沿用本原型的有限标点适配。当前#12处理标签生成/编辑，#13处理字体兼容。Spec仍修订中，新Implementation切片未审核，旧#8/#9/#10不覆盖本轮新增需求。

可复用 launcher、离线 fixture 和 PTY 断言；正式实现应重新设计文档模型、坐标、主题及历史关联。未经用户审核新切片，不把实验代码移入产品或更新日常安装。

[Planning #11](https://github.com/wangxuyang1221/pi-ext/issues/11)保存当前选择及待确认问题。
