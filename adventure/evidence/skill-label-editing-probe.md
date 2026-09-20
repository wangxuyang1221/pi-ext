# Label editing probe

## Scope

为 [Planning #12](https://github.com/wangxuyang1221/pi-ext/issues/12) 核验公开编辑器接口与现有原型的边界。用户已确认自动成标，并决定本轮不新增复制原文操作。完整规格在 Spec 中维护；本关尚未通关。

## API and clipboard findings

核验版本为本工作区安装的 Pi 0.86.0。Context7 `/earendil-works/pi` 返回 main 文档，以下版本结论另由实际安装的 `editor.d.ts`、`editor.js`、`tui-alt-screen.js` 及 keybindings/terminal-setup 文档核验。

- Editor 公开 `getCursor`、`setText`、`insertTextAtCursor`、`handleInput`、`handleMouse` 和 `render`。游标写入、undo 栈和内部布局为 private。不能通过改私有字段或实例方法省略适配工作。
- `handleMouse` 的公开点击路径可以设置可见行中的位置，但不能据此推断可直接跳到任意不可见的逻辑位置。
- fullscreen `getActiveSelectionText` 从渲染后的 `previousScreen` 或 `scrollContentLines` 按列取文本，并去除终端序列。它不读取编辑器原始任务。鼠标复制保持这个行为，不承诺变回 `$skill-name`。
- 原有外部编辑器读取 `getExpandedText`，仍须得到原始任务，不含视觉图标或内部投影标记。本次未写入系统剪贴板，也未更改终端设置。

对应上游固定源码：[Editor](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/components/editor.ts)、[fullscreen selection](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/tui-alt-screen.ts)。

## Experiment

使用真实 `Editor` 和既有 `chipEditor`，宿主仅替代 TUI 的终端尺寸与重绘请求，不启动真实 CLI。运行：

```bash
pnpm exec vitest run --config adventure/experiments/vitest.config.ts adventure/experiments/skill-mention-ui/editing-probe.test.ts
```

3项探针断言通过。这表示以下现象被复现，不表示原型达到生产要求：

| Probe | Observed result |
| --- | --- |
| `$presentations`，宽度80、24 | 保留cube与青色 |
| 同一输入，宽度16、12、8 | 名称拆行，cube丢失为内部菱形，青色也丢失；没有超宽，原文仍完整 |
| 宽度8时左右键、整块删除、撤销 | 原文与整块操作仍通过 |
| 手写完成后直接调用setText自动成标 | 第一次undo只撤掉投影转换，原文完全不变，形成多余撤销步骤 |

窄行问题来自 `styleChipLines` 逐行查找完整投影 token，跨行后匹配不到，不能直接迁移为正式渲染。自动成标也不能直接在每次原生编辑后调用 `setText`，否则污染撤销步骤。

最初用仓库默认测试配置运行时未发现此实验文件。改用已有 `adventure/experiments/vitest.config.ts` 后执行成功，未修改全仓测试范围。

另重跑 `pnpm run check`：typecheck通过，2070 passed/5 skipped，仍因既有MCP原型缺文件而suite收集失败。未修复无关文件，也未降低检查门槛。

## Design implications

正式方案需要区分原始任务、已成标范围和显示坐标。标签重投影不应成为独立文本编辑，撤销要恢复对应的文本和标签状态。跨行渲染不能依赖一行内出现完整标签，或依赖显示字符反向识别标签，避免普通文字与图标外观相同造成误判。

以上是需要验证的候选实现约束，不代表正式状态模型已验证。公开API组合、快捷键映射、kill ring、长粘贴折叠、历史和reload尚需进一步验证。旧视觉关卡明确未验收这些边界，因此本次不推翻已确认的cube外观。

## Confirmed wrapping behavior

用户已选择跨行显示完整名称，不省略。一般剩余空间不足但整行能容纳时，标签整体移到下一行；标签本身超过整行宽度时可以拆行，编辑仍为一个整体。

## Source model probe

新增 [source-model-probe.ts](../experiments/skill-mention-ui/source-model-probe.ts) 与[测试](../experiments/skill-mention-ui/source-model-probe.test.ts)，验证另一条路线：原生 Editor 始终保存 `$skill` 原文，标签状态用范围数据单独记录，只在显示布局阶段替换图标与名称。不向原生buffer插入隐藏标记，也不从显示字形反推原文。原生补全仍读取原文，纯视觉转换不调用setText，因此不额外增加undo步骤。

4轮 Red → Green：

1. 原型手写后没有自动成标，断言先失败。新方案在分隔符后建立显示范围；输入名称期间不成标，撤销先移除空格、再按原生合并规则撤销名称，没有仅撤销投影的步骤，onChange次数不增加。
2. 原生左键只移动一个字，整块移动断言先失败。通过有进度检查和循环上限的公开handleInput移动，以及一次公开setText完成整块删除后，左右移动、删除与原生undo恢复标签通过；原方法引用未改。
3. 完整粘贴位于输入末尾时最初未成标。识别bracketed paste的完成事件后，末尾成标和一次undo撤销粘贴通过；普通文本中的同形cube字符串不会被当作标签。
4. 真实产品补全provider选中名称后最初未成标。区分菜单确认事件后，原生菜单关闭、原文缓冲和标签同时通过。

显示布局将每个标签作为一段；超过整行才拆为字素，每段按范围着色。宽度8的多行名称、cube及各行青色通过，原文不受影响。Pi的`wordWrapLine`虽然在内部模块有导出，但未从package root导出，实验没有继续使用深层导入，而采用自有投影布局。

本次全部原型与探针共17项测试通过，独立tsc通过。运行：

```bash
pnpm exec vitest run --config adventure/experiments/vitest.config.ts adventure/experiments/skill-mention-ui
pnpm exec tsc --noEmit --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node adventure/experiments/skill-mention-ui/*.ts
```

## Remaining feasibility work

新探针不是完整EditorComponent，也没有接入实际CLI。它验证真实Editor的原文、补全和撤销路径，但显示只验证标签内容布局，没有包含宿主边框/菜单、滚动视口、光标标记、上下移动或鼠标坐标映射。使用现有严格解析器做空白边界用例，不能声称已接入#5的新语法。kill ring、自定义快捷键、长粘贴折叠及reload/历史完整集成尚未验证。

因此#12仍open，原文模型是一条有局部证据支持的候选，不是已经通过的整体可行性结论。接下来可以先处理独立的#13字体前提，再回到#12把选定字形/降级条件纳入完整坐标与宿主渲染验证。不创建Implementation，也不将此实验安装到日常Pi。
