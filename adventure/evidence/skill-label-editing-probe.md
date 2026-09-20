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

## Pending decision

一般情况下可将标签整块移到下一行。若标签本身比整行还宽，需要用户选择显示完整名称并允许跨行，或单行省略名称。该选择会影响显示坐标与渲染策略，先明确再验证。
