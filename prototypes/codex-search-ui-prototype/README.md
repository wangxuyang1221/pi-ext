# Minimal Search Playback Prototype

## Question

收敛到方案 2：无底色搜索区域在搜索中、收尾和完成之间如何过渡？完成后的勾号用低饱和绿色还是灰色更合适？通过同一结果上的颜色切换和可重播动画判断。

## Run

在仓库根目录的交互终端执行：

```sh
pnpm run prototype:search-ui
```

启动后自动播放一次六秒搜索动画，默认保留原版 `minimal` 配色与绿色勾号。完成后停止刷新，不自动循环。

独立的 `accent` 变体整体提亮：`Web Search` 标题使用青色 `#A6DADC`，来源数量与 `sources` 使用淡蓝色 `#A8CCEC`；查询为 `#C1C7CE`，结果正文为 `#B9C2CB`，模式参数为 `#B8C0C8`，次级标点为 `#929DA8`。域名不单独着色，绿色勾号不变。原版 `minimal` 配色保持不变。

```sh
pnpm run prototype:search-ui --style accent
pnpm run prototype:search-ui --style accent --settled
```

运行中使用 `/search-style accent` 和 `/search-style minimal` 原地比较，切换不会重播或改变展开状态。

| Input | Action |
| --- | --- |
| `/search-style minimal` / `/search-style accent` | 原地切换原版和局部彩色变体 |
| `Alt+R` / `/search-replay` | 从头重播 |
| `Alt+P` / `/search-pause` | 暂停或继续，暂停时保留当前进度与旋转标记帧 |
| `Alt+G` | 原地切换灰色与绿色勾号，不重播 |
| `/search-check gray` / `/search-check green` | 指定完成勾号颜色 |
| `/search-finish` | 直接显示完成结果 |
| `/search-scene error` / `/search-scene success` | 重播失败或成功场景 |
| `Ctrl+O` | 展开或折叠结果，搜索期间不提前展示最终结果 |
| `Ctrl+D` | 空输入时退出，播放中的定时器同样清理 |

终端未传递 Alt 快捷键时，使用对应的斜杠命令。

直接查看静态完成状态，或从灰色勾号开始：

```sh
pnpm run prototype:search-ui --settled
pnpm run prototype:search-ui --check gray
pnpm run prototype:search-ui --scene error
```

旧的 `--variant 2` 参数仍可用，其他方案入口已移除。普通聊天输入被拦截，不请求模型。

## Landing Map

- Target：`extensions/codex-search/src/index.ts` 的调用、搜索进度和完成结果展示。
- Context：真实 Pi CLI 历史对话、终端滚动与展开操作，复用生产 `codex-ui` 的编辑器与 footer。
- Contract：真实 `ToolExecutionComponent`、局部 `renderShell: "self"`、`renderCall`、`renderResult`、`isPartial`、`expanded` 和 `context.invalidate()`。只在原型边界注入播放状态，不修改全局主题或生产插件。

## Sequence

| Time | Display |
| --- | --- |
| 0–2 秒 | 标题前旋转标记；`Searching 0/2` 与秒数 |
| 2–4.5 秒 | 旋转标记继续；`Searching 1/2` |
| 4.5–6 秒 | `Searching 2/2` 与 `finalizing`，仍无完成勾号 |
| 6 秒后 | 旋转标记恢复静态圆点；显示完成勾号、耗时、网页动作数与来源数，停止定时器 |

成功结果正文为次级灰，数字稍亮；只有 `✓` 可以用绿色。绿色采用提亮后的 `#78D99A`，灰色采用 `#A4ADB6`。标题灰白、状态标记低饱和青色，树形线弱化；无任何卡片底色。调用行保留一次模式参数。

失败保留警告色与错误文字，不出现绿色勾号。130 列折叠视图下，整个播放过程高度不变；窄终端按真实内容换行。

## Real and Fixture

真实部分：上游 renderer 的冻结副本 `src/baseline.ts`、生产 Codex UI、Pi CLI、Text/Box 换行、历史恢复、工具展开和重绘路径。冻结副本保留最初原型，避免正式实现改动后破坏比较基准。

Fixture：两个固定查询、六秒时间线、5 个网页动作、3 个来源、精简正文和失败场景。不接入 OpenAI，不表示真实请求耗时。

Approximation：历史会话中保存的是完成结果，原型通过显式快照边界向生产 renderer 提供部分结果或完成结果。因此能判断动画与文本、背景、重绘效果，不能证明真实网络事件或 Agent 工具执行生命周期的集成正确。原型宿主是仓库锁定的 Pi `0.84.3`，而用户全局 Pi 为 `0.85.1`；字体、终端透明度和颜色管理沿用用户终端。

本轮仅验证深色终端中的方案 2，不验证浅色主题、256 色回退或独立网页工具。

## Isolation and Cost

每次启动在本目录 `.tmp/run-*` 内创建独立 workspace、HOME、agent 配置、缓存和 fixture 会话，退出时删除。不继承凭据、代理或现有 Pi 配置；使用 `--offline`，不注册上游设置命令。模型、搜索工具及用户 shell 执行均禁用，不启动网络服务。

播放只使用一个 100ms 定时器，每轮最多 60 次帧推进。重播先取消旧定时器；暂停、完成和退出均停止计时。每帧只请求搜索行重绘，操作提示不随动画每帧重建。不增加网络或磁盘 I/O，也不保存帧历史。

## Verification

```sh
pnpm run prototype:search-ui:check
pnpm run prototype:search-ui --pty-smoke
pnpm run check
```

组件测试覆盖单定时器、进度阶段、动画帧变化、暂停和恢复、最终正文不提前泄露、绿色仅限勾号、原地切灰、失败无勾号、展开折叠、全部 61 个快照的宽度及稳定高度、播放结束不再通知、退出清理和执行禁用。定时器和播放展示测试均先失败，再完成实现。

PTY smoke 使用 macOS `/usr/bin/expect` 启动真实 CLI，验证完整动画、收尾、灰绿切换、重播、暂停、展开、缩窄、失败和播放中退出。复用仓库原型环境的 `@xterm/headless` `5.5.0` 解码真实 ANSI 流，检查勾号单元格的颜色、默认背景，以及展开折叠、重播后不存在旧结果残留。该 smoke 使用默认成功场景和绿色初始状态。

接口依据为 Pi 官方 extensions/TUI 文档与本机 `0.84.3` 源码；Context7 未提供该 Pi 版本快照，以实际类型检查和 CLI 验证为准。xterm 接口通过 Context7 文档和仓库已有同版本验证代码核对。

## Production Verification

```sh
pnpm run prototype:search-ui --production
pnpm run prototype:search-ui --production --pty-smoke
```

此入口与六秒回放不同：加载正式搜索插件，通过真实 Agent 工具调用驱动进度与渲染，只替换认证和 HTTP 响应。启动即执行成功场景；通过 `/production-search success|partial|error` 重跑，`Esc` 取消，`Ctrl+O` 展开。使用正式 `accent` 配色，不受原型 `--style` 参数控制。

认证使用无效签名的本地 fixture token，HTTP 仅允许虚构的 `search-fixture.invalid` URL，返回延迟 SSE 或 503，不发起外部请求。配置、会话和缓存仍全部在仓库 `.tmp/run-*` 下，退出清理。PTY 验证真实进度、成功、展开、部分失败、全部失败、取消，以及完成勾号颜色与默认背景；不等同于 OpenAI 在线端到端验证。

## Handoff

最终选定提亮后的 `accent` 变体，已在正式源码中实现；原型仍保留 `minimal` / `accent` 比较。没有启用本地插件，也没有修改全局主题。

可转移配色和动画节奏的设计决定及验证断言。生产实现应直接处理渲染状态与文字层级，不搬入本原型按文字特征拦截 `Theme.fg()` 的代理，也不使用模拟的六秒时钟推进业务进度。
