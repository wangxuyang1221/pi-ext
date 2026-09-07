# Title Spinner Prototype

## Question

80ms、时间驱动、固定标题的转圈，能否改善旧版 500ms 转圈加动态省略号在 Ghostty 顶部的观感？用户已确认单色新版，现已接入正式 `codex-ui`。原型保留直接观察终端顶部及旧版对照，不模拟网页标题栏。

## Run

```sh
pnpm run prototype:title-spinner
```

默认自动播放新版动画，无需模型、认证或执行命令。控制说明沿用已确认的中文。

| Command | Behavior |
| --- | --- |
| `/title-motion smooth` | 固定 `π · pi-ext`，80ms 一帧，以单调时钟计算帧位置 |
| `/title-motion legacy` | 旧版对照：500ms 一帧，`Thinking.` / `Thinking..` / `Thinking...` 同步变化 |
| `/title-motion off` | 取消定时器，恢复静态标题 |
| `/title-stats` | 显示最近最多 256 次标题写入间隔的中位数、P95 和最大值 |
| `/title-stall` | 明确注入一次 240ms 同步阻塞，观察恢复时跳到当前帧、不补播 |
| `/bash-scene long` | 切到现有长日志 fixture，可用 `Ctrl+O` 展开、`Alt+R` 重播 |
| `Ctrl+D` | 输入框为空时退出；清理定时器和本次隔离目录 |

可以追加 `--fullscreen`。默认项目名来自真实仓库，临时 workspace 不冒充项目名。新版跟随会话改名保留名称；旧版对照故意保留过去的固定 Thinking 标题。重启或 `/reload` 后回到默认 smooth 模式。

## Landing Map

- `Target`：终端窗口或标签页标题，正式 `extensions/codex-ui/src/terminal-title.ts` 已接入 agent、compaction、会话改名和 shutdown 生命周期。
- `Context`：复用现有 Bash 原型的真实 Pi 0.84.3 CLI、生产 Codex UI、主题、Bash 正式渲染器、编辑器和页脚；不重画周边。
- `Contract`：仅在 `--title-spinner` 隔离入口注册实验控制区；smooth 直接复用正式 `TerminalTitleSpinner`。帧通过公开 `ctx.ui.setTitle()` 写入，计时器不调用 `requestRender()`、不更新正文 widget、不解析历史输出；session shutdown 清理。旧版对照和写入统计只留在原型。

## Real and Approximate

真实部分是 Pi 到终端的 OSC 标题写入路径，以及用户所在 Ghostty 窗口的标题显示。帧序列和 80ms 周期依据本地锁定 Pi 0.84.3 的 `Loader` 源码，与自动 compact 相同。Context7 的 [Pi 扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)确认公开 `setTitle()` 接口；具体间隔以安装版本源码为准。

Fixture 部分是持续运行状态、Bash 日志及手工注入的 240ms 阻塞。原型中的持续动画不代表模型正在工作，不触发真实 compact。正式代码已接入运行与结束、重试期间保持、手动/自动 compact、取消完成及会话替换；这些分支使用事件 fixture 验证，原型的持续运行不是实际模型端到端验证。隔离环境不加载用户扩展或 tmux 标题配置，因此不能验证其他标题写入者的冲突。

`/title-stats` 测量的是应用写入时刻，不是 Ghostty 实际绘制帧率。PTY 验证不会绘制操作系统标题栏，不替代用户的视觉判断；本次也没有量化真实长回复负载的 CPU 或窗口绘制间隔。

## Checks

```sh
pnpm run prototype:bash-ui:check
pnpm run prototype:title-spinner --pty-smoke
pnpm run prototype:title-spinner --pty-smoke --fullscreen
pnpm run check
```

- 20 项原型测试通过，包括 80ms 调度、按实际时间跳帧、只保留一个待执行计时器、256 个间隔样本上限、旧版切换、停止及重复清理。
- 普通和 fullscreen 真实 CLI smoke 均通过：2 秒稳定采样各写入 25 次标题；该采样仅有 OSC 标题控制序列，没有正文重绘字节。旧版对照、阻塞注入、统计命令、停止后零标题写入及正常退出均通过。
- 正式接入后的 `pnpm run check` 通过：697 项测试通过、1 项已有集成测试跳过；类型检查、构建和发布包校验通过。新增 4 项正式标题测试覆盖延迟跳帧、非 TUI、settlement 和 compaction/改名/重装生命周期。运行动画、compaction 生命周期及正式静态正文/动画标题共存测试均先失败，再实现通过。
- 正式 reasoning pipeline 验证：标题计时器运行及 low-power 切换期间，正文状态缓存保持不变，TUI 刷新请求数不增加。未量化 Ghostty 实际绘制帧率或 CPU 改善，不宣称消除所有卡顿。
- 本次测试启动的 CLI/expect 与隔离目录已清理，未启动监听服务。不清理用户自行运行的实例。

## Handoff

正式 `TerminalTitleSpinner` 已实现帧计算、单定时器与重复标题去重；正式生命周期在 `agent_start` 启动，在 `agent_settled` 停止，不因 `agent_end` 提前停止重试/自动 compact 期间的动画。手动 compact 完成或失败时回到静态标题；忙碌状态重新安装时恢复动画，shutdown 后旧实例不再写标题。会话名中的控制字符会在写入标题前清理。

持续运行 fixture、故意阻塞命令、间隔采样和实验控制区未迁入生产。原型不承诺已经解决 Ghostty 标题栏自身的刷新限制。
