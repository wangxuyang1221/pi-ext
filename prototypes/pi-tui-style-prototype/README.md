# Pi TUI style prototype

## Question

在现有 Ghostty 配色和 Pi 0.84.3 的公开 TUI 接入点内，Codex CLI、Claude Code，以及两者混合后的界面分别可以是什么样子？

这是一次性视觉原型，不是生产实现。三个版本通过 URL 参数 `?variant=codex|claude|hybrid` 切换。界面文案按用户选择使用 English。Codex 和 Claude 方案分别以用户本机 `codex-cli 0.149.0`、Claude Code `2.1.236` 截图为视觉参考，但主品牌统一使用 Pi 0.84.3 官方 startup wordmark：accent bold `pi` 加 dim `v0.84.3`；`π` 只用于 terminal title 等标题语境。

## Bash block study

`bash.html` 比较三种 Bash tool block：

- `A · Quiet native`：保留 Pi 默认 success shell，收紧 command、fold hint 和 output 的层级。
- `B · Command receipt`：把状态、命令、输出和折叠信息拆成清晰的内部区域。
- `C · Inline rail`：使用 `renderShell: "self"` 去掉整块填色，改成 transcript 内联事件。

三个方向通过 `?variant=a|b|c` 切换。点击 Bash block 或底部 `Collapsed` 按钮可以展开输出；`Boundaries` 显示每块设计对应的 Pi renderer 边界。

## Run

在仓库根目录运行：

```bash
npm run prototype:tui
```

Profile study：`http://localhost:4173/?variant=codex`。页面底部切换器和键盘左右方向键可以切换版本；启用 `Show Pi hooks` 可查看每块界面对应的 Pi extension API。

Bash block study：`http://localhost:4173/bash.html?variant=a`。底部切换器和键盘左右方向键可以在 A、B、C 之间切换。


## Ghostty baseline

原型按用户配置模拟：`Iosevka Term`、`Sarasa Term SC`、19px、`#292929` 背景、85% 不透明度、50px blur，以及当前 ANSI 16 色调色板。浏览器只能近似 Ghostty 的字体渲染、字重和真实背景模糊。

## Pi implementation boundary

点击 `Show Pi hooks` 可以检查实现路径。标记分为三类：

- `EXACT`：Pi 0.84.3 稳定公开 API 可以直接表达。
- `NATIVE`：使用 Pi 固定的内建 transcript geometry，仅通过 theme token 或 Markdown transformer 改变公开允许的部分。
- `DELEGATED`：按官方 example 同名注册 `read`/`edit` tool，并把 execution 委托给 `createReadTool()`/`createEditTool()`；renderer 可自绘，但 wrapper 需要随 Pi 版本维护。

原型已删除或降级稳定 API 无法表达的视觉：透明 user cell 改为预合成实色；assistant avatar 改为 Markdown `-` marker；每条 thinking 耗时改为全局静态 label；Hybrid side column 改为不重排 transcript 的 overlay；圆形 context ring 改为字符 meter；diff 背景只存在于 delegated `edit` renderer，不再归因于 built-in diff theme。Ghostty window blur、wallpaper 和网页切换器位于 Pi TUI 之外。浏览器中点击 tool row 只用于演示 `expanded` 状态，真实 Pi 交互使用现有 `Ctrl+O`/tools-expanded 机制，不依赖 mouse renderer。

详细证据：`.scratch/docs/research/pi-tui-prototype-transcript-feasibility.md` 与 `.scratch/docs/research/pi-tui-prototype-extension-feasibility.md`。
