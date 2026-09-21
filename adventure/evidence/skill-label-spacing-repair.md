# Skill label spacing repair

## Scope

用户实际验收指出cube紧贴名称。原型`adventure/experiments/skill-mention-ui/source-model-probe.ts:79`使用` ${icon} ${atom.name} `，正式`paintLabels/layoutLabels`遗漏了这三个显示空格。

本轮基准`9668f3d07bab6083b66270676743c9abd7b66893`，工作分支`adventure/skill-mentions`，接手时干净。只修问题1，输入和成功快照正文的cube/command恢复一个前导、图标名称间一个、尾随一个空格。源文本已有空格保留，样式仍为正常字重、#8DF9FD及继承背景。

问题2未解决：用户日常组合仍使用main旧Codex UI，其缺少`renderProjectedLines`。本轮没有修改codex-ui、安装、全局配置或main，不能将本worktree Codex宿主通过等同于日常旧宿主问题已修复。

## Implementation

- `src/labels.ts`：正文绘制恢复精确原型格式。布局每标签增加三个一列宽的显示单元，整块适配宽度也增加3；名称超宽仍逐grapheme完整换行，不截断、不向原生buffer写空格。
- 前导空格、图标和间隔映射到原文`$`，尾随空格映射到末尾名称grapheme。显示单元可共享原文区间，没有新的源光标停点。
- `src/editor-surface.ts`：旧光标算法选择最后一个起点不大于offset的行。当多个显示单元共享一个源grapheme并跨行时，它会把标签开始光标移到后行。现在从首个尚未越过的源单元定位，保留软换行、显式换行及空行边界。
- `src/label-editor.ts`：命中尾随空格时使用显式源末尾`hitTarget`。这避免单个补充平面字符名称如`$𠮷`按UTF-16中点吸附到标签开头。键盘动作、native删除和undo分组实现未改。
- 正式测试更新精确格式、行宽和坐标预期。原窄窗测试仍使用8列，明确断言拆行结果；原整块换行测试增加3列以容纳增加的显示留白，不取消窄窗覆盖。
- `__tests__/pty-driver.py`同步更新显示断言，并增加只跑受影响阶段的spacing范围。`spacing-acceptance.mjs`直接加载worktree编译入口，隔离HOME、agent和会话，无需安装包或修改日常配置。

本次只调整自有投影逻辑，没有新增第三方API依赖或私有Pi操作。沿用此前核验的本机Pi0.86.0公开Editor/Terminal接口；Context7本轮不可用，没有用main文档替代版本依据。

## Red and green

| Stage | Failure | Resolution |
| --- | --- | --- |
| 精确格式及源坐标 | [Red](skill-label-spacing-red.log)：两种图标都缺空格；原offset9投影列9，应为12，多标签偏移也不对 | [Format green](skill-label-spacing-format-green.log)：正文、布局和焦点标记列均符合精确格式 |
| 虚拟单元独占窄行 | [Wrap red](skill-label-spacing-wrap-red.log)：1/2列下标签开始光标落在后续同源起点行 | [Wrap green](skill-label-spacing-wrap-green.log)：首端、末端、软换行及空行全部通过 |
| 补充平面字符尾随空格 | [Suffix red](skill-label-spacing-suffix-red.log)：四种宿主/图标组合点击`$𠮷`尾随空格均吸附到开头 | 显式命中末尾后，四项进入[最终594项通过回归](skill-label-spacing-regression.log) |

[第一次](skill-label-spacing-regression-first.log)和[第二次](skill-label-spacing-regression-second.log)集成失败日志也保留。它们记录窄行测试对fixture默认padding的错误预期：实际CustomEditor为0列padding，8列窗口布局为7列。最终按真实帧断言`["abc  󰆧  ", "alpha   "]`，没有改产品去迎合错误预期，也没有用删除断言或skip换取通过。

## Coverage

| Area | Evidence |
| --- | --- |
| 原型三个空格及源文本原有空格 | 两种图标的正文/布局精确相等断言；重复标签前后原有双空格保留 |
| 光标及源坐标 | offset与焦点标记列同时断言；1/2/3/4/8/9/10列，显示单元独占行、源换行和空行 |
| 宽窄、完整长名称 | 64/256/1024名称，8/16/80/120列完整拼接及宽度；原1024名称分页、wheel、resize测试保留 |
| 鼠标、上下和整体编辑 | 两宿主两图标，8/16/80列三处空格命中，左右整块、两个删除方向、undo和原文恢复；补充平面字符末端另测 |
| 菜单、自定义键位和宿主操作 | 原有completion位置、连续undo、函数键、kill ring及同步回调测试仍通过 |
| 输入、成功正文及原文出口 | 成功快照/同文不同快照、reload、队列、history、tree/fork、compaction、模型及JSONL已有断言同步更新后通过；无显示空格写入源任务 |
| 折叠paste混排 | 原2048字符折叠paste正式回归和真实PTY，Delete/undo以及同次write的Delete→Enter保留展开原文 |

新增14项正式测试，原580项全部保留。本轮不重测原10MiB内存实验。布局的确定性成本测试表明，64/256/1024名称均只增加三个显示单元，没有新增源buffer、native动作或读取skill文件；光标定位仍扫描行及命中行内单元，不逐行重扫所有单元。用户已接受的原生同步删除快照成本保持，不新增内存门槛，不声明极端OOM安全。

## Real PTY

最终命令：

```bash
node extensions/skill-mentions/__tests__/spacing-acceptance.mjs skill-label-spacing-themed
```

[日志](skill-label-spacing-themed-pty.log)、[编译入口及fixture散列](skill-label-spacing-themed-artifact.json)、[native](skill-label-spacing-themed-pty-native-fullscreen.json)、[Codex](skill-label-spacing-themed-pty-codex-fullscreen.json)。

- 真正的Pi0.86.0 CLI，经OS PTY运行，使用本worktree的dist和离线faux provider。未执行pi install、依赖安装、远端模型、真实MCP或子代理调用。
- native-fullscreen和codex-fullscreen各7组检查、3次faux请求。每组都切cube/command，核对输入及成功正文的三个空格、RGB、正常字重、背景继承。
- 两种图标各点击前导、间隔、尾随空格，用实际插入位置与undo验证源坐标；同时验证Backspace/Delete、配置的F8 undo。
- 实际SIGWINCH从120→16→120列，245字符超视口名称翻页、上下事件、SGR鼠标和外部编辑器进程均保留源文本。2048字符paste混排及Delete→Enter检查通过。
- 只跑受影响阶段，未重跑八种扩展组合、完整安装或物理IME。两宿主都用fullscreen以覆盖Pi实际鼠标分发，regular本轮未另开PTY。

首轮[PTY](skill-label-spacing-pty.log)功能检查通过，但隔离fixture未显式加载codex-pi主题，出现theme unavailable提示。[原native](skill-label-spacing-pty-native-fullscreen.json)、[原Codex](skill-label-spacing-pty-codex-fullscreen.json)及[散列](skill-label-spacing-artifact.json)保留。随后仅给隔离Codex进程传入worktree已有`--theme`资源并复跑，两宿主通过且无该提示。没有改主题文件或日常配置。这不是对问题2的修复。超长/Unicode fixture沿用Pi资源发现的名称警告，实际目标标签仍完成上述操作。

## Checks

环境：Node.js22.22.2、pnpm11.9.0、TypeScript5.9.3、Vitest3.2.4、Pi0.86.0。

| Command | Result |
| --- | --- |
| `pnpm exec vitest run extensions/skill-mentions/__tests__ extensions/codex-ui/__tests__` | [44 files、594 passed](skill-label-spacing-regression.log)，含skill-mentions359项、Codex235项，无新增skip |
| 全部skill测试.ts独立tsc | [通过](skill-label-spacing-types.log)，18个.ts含两个fixture；ES2022、NodeNext、strict及仓库既有skipLibCheck不变 |
| `pnpm run check` | [typecheck通过，2312 passed/5 skipped](skill-label-spacing-check.log)，仍仅既有MCP suite缺`prototypes/mcp-status-ui-prototype/src/codex-startup.js`导致退出1 |
| 短路后`pnpm run build` | [退出0](skill-label-spacing-build.log)，dist只构建、不手改 |
| 独立`pnpm run package:check` | [退出1](skill-label-spacing-package-check.log)，仍缺旧`docs/goal-descendant-acceptance.md` |
| 新runner与PTY driver语法 | `node --check`及Python `compile`通过，无pycache写入 |
| `git diff --check` | 通过 |

没有修复无关缺文件或降低门槛，不称全仓check或package检查通过。

## Cleanup and continuation

[清理记录](skill-label-spacing-cleanup.json)：四个CLI PID25137、30819、53868、59560均已退出，无监听端口；进程扫描无本轮测试候选。两轮隔离PTY目录和`.tmp/skill-label-spacing-repair`已删除，仅删除本轮新增1个quality stderr，原38个保留。旧`.tmp/skill-ui-prototype-GG4yw8`仍不存在，保留此前更正。

本轮测试仅对子进程清四项PI_SUBAGENT标记；未改全局环境、日常安装、终端或字体。仅更新#15 Execution/Delivery/Verification，保留Acceptance及Map/Spec/progress/#16，返回协调者复验问题1。问题2仍待用户另行授权处理。
