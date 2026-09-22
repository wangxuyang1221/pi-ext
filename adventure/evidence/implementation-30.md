# Implementation 30

## Scope

关卡 [#30](https://github.com/wangxuyang1221/pi-ext/issues/30)，规格 [#25](https://github.com/wangxuyang1221/pi-ext/issues/25)。基准为 19e82a1010a249976b769fa3015c4fb26fae7bc2，工作分支 adventure/subagent-ui-consistency。

生产 renderer 已落实六类工具的 /after 视觉：标题使用 ⏺ 和调用状态色，名称使用 accent 且不额外加粗，任务与活动使用正文色，统计弱化，多行结果使用竖线与末行转角。成功结果文字固定为 #46E87C，标题圆点继续使用主题 success。调用状态不依据子代理任务是否完成推断。未修改工具字段、文案、顺序或折叠归属；英雄名属于 #31。

各 extension 独立 TypeScript rootDir 和发布目录保持不变。subagent 使用与 codex-ui 相同的标记及主题语义，没有引入跨 extension 源码或构建产物依赖。固定成功文字色由局部函数输出，不修改全局主题。

## Red and green

按 develop-with-tdd 顺序实施，每轮先确认对应断言失败，再修改生产代码并运行相关测试。

| Round | Red | Green |
| --- | --- | --- |
| Call status | spawn/pending 仍使用 dim 的 •，不能满足 warning 的 ⏺ | 六类 pending/success/error 与 wait timeout/interrupted 全部通过，running 子代理不影响调用成功色 |
| Text and lines | read 展开仍为 muted 统计、toolOutput 正文、首行转角与后续空白 | dim 统计、text 正文、竖线及末行转角通过，折叠保持单行与组件复用 |
| Success text | wait 结果仍调用主题 success，缺少 #46E87C | wait/close/list/spawn 展开中的成功状态通过，标题仍使用主题 success |

另加入长名称及 0/1/2/12/40/80/120 列边界回归，原有截断行为已满足，未为此改变实现。renderer 与 tools 定向测试共 24 项通过。

## Verification

实际版本为 Node.js v22.22.2、pnpm 11.9.0、Pi 0.86.0。packageManager 为 pnpm@11.9.0。

| Command | Result |
| --- | --- |
| pnpm exec vitest run extensions/subagent/__tests__/renderers.test.ts extensions/subagent/__tests__/tools.test.ts | 24 passed |
| pnpm exec node adventure/prototypes/subagent-ui/check.mjs | 40 组文字信息与基准一致；7 个宽度边界通过 |
| conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --production | 普通模式 15 个场景通过 |
| conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --production --fullscreen | 全屏模式 15 个场景通过 |
| pnpm run check | 类型检查通过；159 files passed、3 skipped；2380 tests passed、11 skipped；构建和发布包校验通过 |

40 组对照在 400 列比较去掉 ANSI、状态标记与连接线后的全部文字，涵盖六类成功、失败、进行中，wait 超时/中断，以及各自折叠/展开。原基准从 Git 19e82a1 读取，仅用于离线对照。

渲染路径没有新增 I/O、计时器、网络或状态扫描。仍按展示行数线性处理，沿用响应式组件与截断方法。没有新增全量中间缓存。原有列表按固定 7 类状态统计，本关未扩大其成本。

## Host evidence

正式模式直接导入 extensions/subagent/dist/tools.js 的 registerSubagentTools 和 codex-ui 构建产物，保留生产参数 schema、renderShell、renderCall 与 renderResult，仅替换 execute 为固定返回值。prepare 在正式模式只复制主题文件，不转译或替换 renderer。

宿主是 Pi 0.86.0 InteractiveMode，模型使用官方 fauxProvider。两种模式都验证：

- 六类成功、进行中、失败，wait 超时与中断，工具从进行中转为完成。
- 原生 Ctrl+O 折叠/展开，长名称及 80→40→120 列 resize。
- /history 调用真实 ctx.switchSession，重新打开已写入磁盘的会话，宿主重建历史工具组件；验证六类标题及颜色仍正确。
- 历史重建后通过 119→120 列 resize 触发真实 TUI 刷新，内容和状态色保持。
- /palette 切换真实宿主 light、dark、codex-pi 主题，成功圆点随主题变化，Settled 与 Process stopped 始终为 #46E87C。

调试过程中发现 fixture 缺少 wait 必填参数 afterSettled，已修正。Pi 会话替换后拒绝旧 context，历史核验改用 withSession 提供的新 context。Ctrl+L 在此版本用于模型选择，最终刷新证据使用 resize，不将模型选择截图算作刷新通过。

### Screenshots

PNG 来自真实 PTY 单元格，字体回退、行高和终端默认背景属于重绘近似。light 图按浅色终端默认背景重绘，其余按深色终端默认背景重绘；ANSI 指定的颜色及位置保持捕获值。精确 #46E87C 依赖终端支持 truecolor，本次设置 COLORTERM=truecolor。未验证不支持 truecolor 的终端。

| Scenario | Regular | Fullscreen |
| --- | --- | --- |
| Success | [截图](implementation-30/regular/success.png) | [截图](implementation-30/fullscreen/success.png) |
| Expanded | [截图](implementation-30/regular/expanded.png) | [截图](implementation-30/fullscreen/expanded.png) |
| Running | [截图](implementation-30/regular/running.png) | [截图](implementation-30/fullscreen/running.png) |
| Error | [截图](implementation-30/regular/error.png) | [截图](implementation-30/fullscreen/error.png) |
| Timeout | [截图](implementation-30/regular/timeout.png) | [截图](implementation-30/fullscreen/timeout.png) |
| Interrupted | [截图](implementation-30/regular/interrupted.png) | [截图](implementation-30/fullscreen/interrupted.png) |
| History | [截图](implementation-30/regular/history.png) | [截图](implementation-30/fullscreen/history.png) |
| Refresh | [截图](implementation-30/regular/refresh.png) | [截图](implementation-30/fullscreen/refresh.png) |
| Light theme | [截图](implementation-30/regular/theme-light.png) | [截图](implementation-30/fullscreen/theme-light.png) |
| Dark theme | [截图](implementation-30/regular/theme-dark.png) | [截图](implementation-30/fullscreen/theme-dark.png) |
| Codex theme | [截图](implementation-30/regular/theme-codex-pi.png) | [截图](implementation-30/fullscreen/theme-codex-pi.png) |
| 40 columns | [截图](implementation-30/regular/width-40.png) | [截图](implementation-30/fullscreen/width-40.png) |
| 80 columns | [截图](implementation-30/regular/width-80.png) | [截图](implementation-30/fullscreen/width-80.png) |
| 120 columns | [截图](implementation-30/regular/width-120.png) | [截图](implementation-30/fullscreen/width-120.png) |
| Palette detail | [截图](implementation-30/regular/palette.png) | [截图](implementation-30/fullscreen/palette.png) |

固定 execute 不能证明真实子代理的认证、调度、tmux 生命周期或耗时。历史、主题、刷新与展开由真实宿主执行，并非仅比较固定图片。全程禁用网络并断言 fetch 调用数为零。

## API verification

Context7 的 /earendil-works/pi 仅覆盖 main，未提供 0.86.0 专属文档。本次结合安装的同版本源码核验：core/extensions/types.d.ts 的 render context、switchSession/withSession 和 setTheme；modes/interactive/components/tool-execution.js 的共享 state、updateResult、invalidate 和主题渲染；core/keybindings.js 的快捷键定义。

官方参考：[extension rendering](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[themes](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/themes.md)。实现以本地 0.86.0 接口为准。

## Cleanup

验证子进程已退出，隔离会话目录由 demo 的 finally 删除。本关不启动服务或监听端口。正式证据只保存 PNG 和本说明，不提交会话文件、ANSI 日志、screens.json 或隔离缓存。保留用户原有原型及其材料。
