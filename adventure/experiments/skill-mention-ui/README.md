# Skill mention UI prototype

## Question

在真实 Pi 输入框和发送后的任务正文中，同一种 `$skill` 标识使用强调色还是浅底色，更容易识别且不干扰阅读和编辑？

用户选择两处都做。具体配色尚待用户查看原型决定。右侧标点允许激活、候选仍要求两侧空白是本轮新方向；标点全集及复杂 Markdown 边界不在这次视觉选择中定稿。

## Landing Map

- Target：Pi 0.86.0 主输入框及普通 user 正文，原生 skill 卡片保留。
- Context：真实 Pi CLI、完整 codex-ui、实际补全菜单、编辑器、Markdown renderer 与消息历史。原型不重建周边界面。
- Contract：公开 editor factory 组合仅改变 render 输出，getText、回调、光标和提交仍委托真实 editor；user Markdown transformer只改变显示。使用Pi发现的skill名称，正文标识来自本次快照。

## Boundary

只写此实验目录和 adventure/evidence，不修改产品src、发布入口、当前全局安装或用户配置。依赖固定现有Pi0.86.0。Context7只有main文档，具体接口以锁定安装包docs、types及真实CLI运行核验。已完整阅读extensions/tui/themes文档及rainbow-editor示例。

原型使用离线faux provider，两个具名fixture skill仅用于表现。原生技能卡片、补全、协议和历史adapter复用现有产品代码；右侧标点适配和视觉装饰属于实验。输入高亮表示已识别名称，不保证随后文件读取成功。未知名称、代码和转义保持普通输入。绝不向真实provider发送请求。

## Variants

- `accent`：蓝青色加粗，不增加背景或字符。
- `tint`：相同字色加浅蓝灰底，不增加空格、图标或不可编辑对象。

这是可编辑文字，不是原子chip。不要将视觉原型的实现直接视为生产代码。

## Run

在冒险worktree运行，默认完整Codex UI和浅底色：

```bash
cd /Users/wangxuyang/Code/t3code/pi-ext-skill-mentions
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs tint
```

打开即有示例草稿，可直接编辑或发送；回复为离线的 `Fixture response`，不执行skill内容。输入 `/prototype accent` 或 `/prototype tint` 通过公开reload切换样式。`/quit` 退出，launcher删除独立HOME、配置、fixture与session。真实skill内容与全局安装都不会被修改。

启动强调色或原生编辑器：

```bash
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs accent
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs tint --native
```

## Preview

- [浅底色，输入和发送后正文](../../evidence/skill-ui-tint-both.png)
- [强调色，输入和发送后正文](../../evidence/skill-ui-accent-both.png)
- [浅底色，原生编辑器](../../evidence/skill-ui-tint-native-both.png)

PNG来自真实PTY输出的字符、前景色、背景色网格，不是重建页面，也不是macOS窗口截图。Pillow绘制时使用Menlo/PingFang字体，字体、字重和行距属于approximation，以交互入口为准。截图中第二行的代码内容沿用Pi原生代码颜色，不是激活状态。

## Verification

以下均实际运行通过：

```bash
pnpm exec vitest run --config adventure/experiments/vitest.config.ts adventure/experiments/skill-mention-ui/ui.test.ts
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs tint --capture
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs accent --capture
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs tint --native --capture
```

- 两项行为测试先失败后通过，验证标点识别与严格补全分离、输入渲染不改原文/光标标记、代码和转义排除。补充实际Markdown渲染断言先失败，揭示两个美元符号被Pi当成LaTeX；视觉转换改用仅显示的代码span后通过。
- 三组真实CLI PTY smoke通过：前后两处颜色、原生卡片、原文及两个快照、provider内容没有ANSI、Tab补全不发送、逗号不弹菜单、公开reload切换样式。
- 原型TypeScript独立typecheck通过。全仓check仍为typecheck通过、2070 passed/5 skipped，仅既有MCP缺文件suite失败；单独build通过，package:check仍因旧文档缺失失败。没有改旧检查门槛。
- 三组最终PTY PID为10617、10722、10838，均exit 0；临时目录已删除，无本任务监听服务。

[PTY记录](../../evidence/skill-ui-tint.json)、[强调色记录](../../evidence/skill-ui-accent.json)、[原生编辑器记录](../../evidence/skill-ui-tint-native.json)包含断言和屏幕文本。生成截图需要现有Conda codex-py312中的pyte0.8.2、Pillow12.3.0；普通交互入口只需现有Node/Pi依赖。

## Implementation limits

- 输入装饰仅处理能完整映射到一行屏幕的逻辑行。长行软换行、滚动裁剪或折叠粘贴时保守不高亮，不假装已验证完整坐标映射。窄终端生产实现需另做设计和测试。
- 标点adapter只覆盖试验使用的逗号、句号、问叹号、分号、冒号、顿号，保持原文坐标。不是最终标点语法；不承诺所有括号、链接、URL和Markdown标记组合。
- 发送前颜色表示名称匹配，不代表读取已成功。发送后颜色来自成功加载快照。live显示的原始任务使用临时按文本映射，仅供视觉原型，不替代产品请求ID关联或通过队列/分支验收。
- 单个隔离会话可正常编辑/发送/切换变体，不覆盖生产分支、压缩、所有主题、物理IME或任意其他扩展。固定使用codex-pi主题，reload前未绑定context时使用该主题的已知背景色。
- 原生Markdown会解析成对美元符号为LaTeX。原型通过display-only代码span保护引用，并恢复父user背景色；模型及持久化任务仍是原文。不能直接将注入ANSI/代码span当成最终富文本架构。

## Sources

- [Pi editor composition / Markdown transformer](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/extensions.md)，本地0.86.0文档完整核验；Context7只提供main，版本依据不采用main代替。
- [Pi rainbow-editor example](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/examples/extensions/rainbow-editor.ts)，仅装饰render而不改getText的官方示例。
- [Pillow12.3.0 ImageDraw](https://github.com/python-pillow/pillow/blob/12.3.0/docs/reference/ImageDraw.rst)，Context7已匹配12.3.0，使用text/rectangle绘制真实终端网格。pyte沿用上一轮已核验的0.8.2接口。

## Handoff

可复用已验证的设计结论：两处一致标识能通过公开editor factory和Markdown transformer接入；不必更改原生卡片或插入图标/空格；补全和提交识别可以分开。

可以复用launcher和PTY截图/断言夹具。正式实现应重新处理语法分离、精确渲染坐标、历史关联、主题适配和Markdown语义，并在用户审核新切片后由worker完成。原型代码不迁入产品，当前安装仍是上一版。

相关规划：[Planning #11](https://github.com/wangxuyang1221/pi-ext/issues/11)。下一步等待用户选择 `accent` 或 `tint`，再移交Spec，不据此宣称新需求交付完成。
