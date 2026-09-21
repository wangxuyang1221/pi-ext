# Skill label delivery acceptance

## Result

本轮完成 #16 可自主执行的安装、组合与完整 Spec 核对。没有发现新的产品正确性回归，没有修改产品 `src/`。**#16 仍应保持 open**，物理 IME 候选窗口和实际终端字体尚未人工验收，不能用 PTY 结果代替。

接手 `71ade67d8c5f76642806b75dfb7df37ec47e2a03`，产品基准 `184a7e79c4dfadcec1f5f75e8ab0b5808411b065`。两者之间只有 progress 资料变化；本轮再次核对 `extensions/*/src/` 无差异。完整规格只在 [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)，本报告是证据矩阵，不另建规格。

- 正式 skill-mentions + codex-ui 测试 **580/580**，其中 skill-mentions 345 项。
- 六组实际 tarball 隔离安装 PTY 通过；另两组验证八个默认扩展加未发布的 codex-search 源码共同运行。每组均真实退出并重启。
- 原生/Codex、regular/fullscreen 的人工验收 launcher 已通过八次 CLI 启停 smoke。这只是 launcher 可用性验证，人工观察仍未执行。
- 全仓 check 失败，2298 passed / 5 skipped，仍缺旧 MCP prototype。独立 build 和八入口 import 通过，package:check 仍缺旧文档。
- 额外全功能测试文件独立 tsc 发现两处已有 fixture 类型错误，详见 Checks。新 PTY fixture 独立类型检查通过；没有修原 #15 测试或降低检查门槛。

## Delivery

- 使用入口：[docs/skill-mentions.md](../../docs/skill-mentions.md)，README 同步修正旧的“全部标点拒绝”描述，补齐标签/字体命令和八扩展构建说明。
- [acceptance.mjs](../../extensions/skill-mentions/__tests__/acceptance.mjs) 核验所有八个扩展 dist 文件与 tarball 安装内容逐字节相同，记录实际 Pi 版本、运行时提交与 fixture 散列。
- [pty-driver.py](../../extensions/skill-mentions/__tests__/pty-driver.py) 补充折叠草稿连续 reload、同文不同成功集、实际本地 MCP 调用与第九个源码扩展组合。没有增加 skip，没有改变已有断言。
- [pty-mcp-fixture.mjs](../../extensions/skill-mentions/__tests__/pty-mcp-fixture.mjs) 只提供本地 stdio echo，记录 PID、调用和退出，不开监听端口。
- [manual-terminal.mjs](../../extensions/skill-mentions/__tests__/manual-terminal.mjs) 提供隔离、离线、两次启动的人工观察入口。非 TTY 提前退出 2，不创建配置；正常结束清理 worktree 内的临时目录。

实际构建、打包、安装命令均运行过。没有安装到用户日常 Pi，没有修改全局配置、字体、终端或输入法；没有 PR、合并或部署。dist 仅构建生成。

## Evidence provenance

| Evidence | Version and use |
| --- | --- |
| [#14 标点报告](skill-punctuation-implementation.md) | 已关闭前置关卡；当前正式 parser 未变。本轮重跑正式测试与产物标点矩阵，不用旧 280 项结果替代当前 345 项 |
| [#15 标签报告](skill-label-product-implementation.md) | 产品基准184a7e7；正式布局、回调重入、grapheme、kill ring、安装顺序、偏好故障、分支和压缩测试本轮在同源码上重跑 |
| [原生 undo 收尾](skill-label-native-undo-closeout.md) | 复用 Pi0.86.0 源码和容量边界，不重跑大分配/OOM；没有恢复旧128 MiB代理门槛 |
| [旧 #10 安装报告](skill-install-acceptance.md) | 仅作 fixture 和历史实现定位，不能证明新增标签或本轮扩展组合 |
| [本轮环境及来源](skill-final-environment.json) | Node22.22.2、pnpm11.9.0、Pi coding-agent/tui/ai0.86.0；三份固定官方源码与安装 source map 全文散列相同 |

Context7 `/earendil-works/pi` 返回 main，只用于定位。目标版本以安装包0.86.0及固定官方 commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc` 为依据。本轮在线复核 [package-manager.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/package-manager.ts)、[interactive-mode.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts)、[faux.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/ai/src/providers/faux.ts)。本地完整读取的16份相关 Pi 文档及散列列于环境记录，并读取 reload-runtime、github-issue-autocomplete、SDK06 示例。

MCP fixture 复用本仓库1.29.0 SDK，查阅 Context7 精确 `/modelcontextprotocol/typescript-sdk/v1.29.0` 的 [stdio 文档](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/docs/server.md)，没有依据结果中混入的 main 片段声明版本行为。Python3.12.13、pyte0.8.2。

## Artifact and terminal matrix

```bash
TMPDIR="$PWD/.tmp/skill-final" pnpm run skill-mentions:acceptance \
  --evidence-prefix=skill-final \
  native codex native-fullscreen codex-fullscreen combined combined-fullscreen
TMPDIR="$PWD/.tmp/skill-final" pnpm run skill-mentions:acceptance \
  --evidence-prefix=skill-final-extra combined-search combined-search-fullscreen
```

第一组 [运行日志](skill-final-cli.log) / [产物清单及散列](skill-final-artifact.json)，第二组 [运行日志](skill-final-extra-cli.log) / [产物清单及散列](skill-final-extra-artifact.json)。产物实际经过 prepack/build、tarball 安全路径检查、独立 pnpm consumer 安装、所有 dist 字节比对、八入口 import 和逐模式 `pi install`。两轮之间只增加可选 codex-search 模式与文档修正，产品源码相同。运行时 fixture 散列见各产物 JSON；收尾仅移除脚本内固定的产品基准字段，避免未来运行继续错误标注184a7e7，不影响验收路径。

| Mode | Checks | Faux requests | Evidence |
| --- | ---: | ---: | --- |
| native regular | 25 | 33 | [PTY](skill-final-pty-native.json) |
| Codex regular | 25 | 33 | [PTY](skill-final-pty-codex.json) |
| native fullscreen | 26 | 33 | [PTY](skill-final-pty-native-fullscreen.json) |
| Codex fullscreen | 26 | 33 | [PTY](skill-final-pty-codex-fullscreen.json) |
| eight default extensions, regular | 26 | 35 | [PTY](skill-final-pty-combined.json) |
| eight default extensions, fullscreen | 27 | 35 | [PTY](skill-final-pty-combined-fullscreen.json) |
| eight default extensions + codex-search source, regular | 27 | 35 | [PTY](skill-final-extra-pty-combined-search.json) |
| eight default extensions + codex-search source, fullscreen | 28 | 35 | [PTY](skill-final-extra-pty-combined-search-fullscreen.json) |

默认八项为 codex-ui、codex-compact、openai-fast-mode、permissions、mcp、subagent、goal、skill-mentions。combined 不过滤 package 扩展；记录各注册命令/工具来源，所有 handler 随真实会话运行，连续七次 reload 及重启没有加载错误、重复发送或包装造成的正文污染。它不是“八入口能 import”冒充共同运行。

仓库还有 codex-search，但它不在当前 build/files/pi.extensions 发布清单。本轮额外显式加载该源码，验证工具注册、reload 和相同链路；不把它说成 tarball 第九入口，也不擅自扩大发布清单。faux 不调用搜索，不读取日常凭据。

组合范围有明确边界：本地 MCP echo 实际执行一次，tool 内容中的 `$alpha` 保持原文；permissions 的默认 Full access handler 参与该调用。goal/subagent 已加载但没有创建目标或子代理，Fast Mode/Codex remote compaction 的远端路径未执行。此次验收覆盖与 skill-mentions 的共同加载、消息、渲染、reload 与清理，不声称重新验收其他扩展的全部业务或任意第三方 editor 覆盖。

## New risk checks

1. 折叠草稿连续 reload：真实 PTY 粘贴含内部 `$alpha` 的2048字节以上文本，加可见 `$beta`；F7 通过公开命令 ctx.reload 保留草稿。两轮分别核对原生折叠仍在、完整 expanded 原文相等、当前 command 偏好保持，随后 Backspace/F8 undo 及实际提交正确，没有额外 provider 请求。
2. 成功快照关联：先提交 `同文 $alpha $beta`，删除已发现 beta 文件，再提交完全相同正文。两个 requestId 不同，前一条两标签、后一条仅 alpha 标签而 `$beta` 保持普通文本。实际 `/reload` 重建后同样成立，不借相同正文查找快照、不因文件删除改写旧成功状态。
3. 原文出口：每次普通提交核对 provider user 的 task、去重顺序、图片和快照；所有 user 检查没有 cube/command/ANSI，最终 JSONL user 与实际 provider user 全量相等。外部编辑器收到 `$` 原文。排队仍显示原文，消费时才采用新文件版本。
4. 本地 MCP 与全部扩展：faux 只返回固定 echo tool call，实际 stdio 服务器返回 `Tool literal $alpha`。同一普通 user 的 skill 快照仍正确，tool 引用不激活；每轮 reload 旧服务器退出，新服务器重新注册。退出时所有 fixture PID 不存在。

这些新增断言首跑即通过，属于已有行为的验收覆盖，没有伪造产品 Red→Green。没有发现需退回 #15 修复的行为反例。源码独立核对 `index.ts` 的消息对象 WeakMap/requestId、逐消息 transformer、严格协议、history factory、`label-editor.ts` 原生 getExpandedText 出口和同步动作记账，以及 source-only reload WeakMap 的释放。没有 pending/native 异步双状态、显示字符串反解原文或 setText 整块删除路径。

## Complete Spec verification

“通过”只涵盖本行注明的证据层级。formal 指 [当前580项正式执行](skill-final-formal.log)，文件位于 `extensions/skill-mentions/__tests__/`；SDK 行使用真实 Pi Session/Runtime、离线 faux 和替代 terminal，不冒充真实终端。

| Spec contract | Evidence | Status and boundary |
| --- | --- | --- |
| 任意行、句中 `$ad` 候选；保留两侧及其他行 | autocomplete、八组安装 PTY 中文多行 Tab/Enter | 通过 |
| 候选两侧仅空白/边界，名称中间不显示 | references/autocomplete、PTY光标及右侧逗号反例 | 通过 |
| 提交右侧29符号、左侧不放宽 | references/loading/flow、PTY全符号及左侧反例 | 通过 |
| ASCII句点直接后邻Unicode字母/数字/下划线/连字符例外 | parser全BMP/非BMP矩阵、PTY `中文/𐐀/𝟠/_/-` | 通过 |
| 不从长名称截取前缀；不扩大到路径/运算符/开括号 | references、loading、PTY research-long/research_other | 通过 |
| Markdown inline/fenced/缩进代码及转义排除 | references/autocomplete/flow、PTY inline/fenced/escape | 通过 |
| 完整手写/粘贴/菜单等价；部分名称不激活 | autocomplete、四种来源同任务PTY | 通过 |
| Tab/Enter有当前项只选择，随后Enter才发送 | autocomplete、每次选择检查请求数不变 | 通过 |
| Escape只取消，保留完整引用仍激活 | autocomplete、PTY取消后提交 | 通过 |
| 多skill同一逻辑user，首次顺序、去重与图片 | loading/flow/protocol、PTY插件user和图片 | 通过；不承诺模型执行顺序或图片视觉质量 |
| 未知/不可读静默，其他有效项正常 | loading/flow、PTY删beta且无错误；同文不同成功集 | 通过 |
| 其他扩展普通user处理，assistant/tool/custom/RPC/print/json排除 | registration/flow、PTY插件user、真实MCP tool | 通过；非TUI是排除范围而非支持模式 |
| 原生slash候选/调用/旧历史、原生skill卡片 | flow/history-editor/protocol、八组PTY slash/F3展开 | 通过；卡片美化仍延期 |
| 两处cube/command统一青色正常字重、无新增背景 | labels/label-surface/label-body、PTY按屏幕单元核对RGB/非bold/邻接背景 | 自动化通过；实际字体/颜色观察待人工 |
| 命令参数、保存/读取故障、重启/reload偏好 | label-preference/label-body、PTY cube→command及进程重启 | 通过；命令不写任务/skill快照 |
| 手写分隔后成标，不提前锁定；菜单/完整粘贴/历史末尾成标 | label-editor/label-surface/autocomplete/history、PTY手写确认undo | 通过 |
| 未知/代码/转义/无效边界不成标 | labels、parser、label-editor | 通过 |
| 输入标签只表示识别；正文仅成功快照 | label-body、PTY同文删文件前后及reload | 通过 |
| 左右整块跨越，Backspace/Delete整体，undo原文/标签恢复 | label-editor/label-surface、PTY两个图标双向删除F8 | 通过 |
| 纯视觉不增加undo；连续同文/grapheme/no-op/补全拦截/回调重入 | label-editor正式测试；PTY同名Tab一次undo | 通过；原生容量与成本复用已验收证据 |
| 自定义键位、kill ring、按词删除、外部编辑器和callbacks | label-editor/history-editor/Codex测试、PTY F3/F4/F8和Ctrl+G真实子进程 | 通过；不覆盖全世界终端键盘协议 |
| 上下、鼠标、视口、菜单取消及迟到provider | label-surface/label-editor、fullscreen SGR点击和真实resize | 通过；regular本就由终端管理鼠标选区 |
| 能整行容纳则整体换行，超长不省略且可查看全部行 | labels/surface各列宽及1024名称逐行，PTY245名称120→16→120和分页 | 通过 |
| 大粘贴折叠内部不画标签，但展开激活 | editor/surface、PTY内部alpha与外部beta | 通过 |
| 折叠块混排删除/undo/同write即时发送、reload和移除扩展 | label-body/editor、PTY两次保留草稿reload及Delete+Enter | 通过；跨editor旧undo不承诺保存 |
| 原文出口无图标/ANSI/投影标记 | protocol/flow/lifecycle及源码、provider/JSONL相等、外部编辑器PTY | 通过；屏幕选区复制仍是显示文字 |
| idle/steer/followUp、多条同文队列消费才读取 | lifecycle四组合带图片及读取spy、PTY真实followUp和文件更新 | 通过；多条steer证据为SDK，不伪称PTY |
| 多条卡片在任务前，关联不串位 | lifecycle sequence/requestId、PTY live同文成功集 | 通过 |
| 已完成请求不重读；历史原文编辑 | lifecycle读取spy、PTY删除源文件后重启与Ctrl+P | 通过 |
| reload/resume/tree/fork/clone活动分支，孤立隐藏、缺卡不补 | lifecycle/visibility，实际runtime分支/恢复、PTY reload/restart | 通过；tree/fork/clone为SDK |
| compaction保留user时仍有快照，摘要替代后不重新注入 | lifecycle两个真实session.compact用例、固定离线summary | 通过；未发远端压缩请求 |
| Pi发现资源，不自行扫描清单；真实路径和相对目录 | registration/loading/protocol及源码pi.getCommands，PTY路径核对 | 通过 |
| 严格版本化协议，不误识别普通JSON/原生skill，不递归激活body | protocol/loading/flow | 通过 |
| editor安装顺序、重复reload、回调不覆盖/不重复包装 | history-editor/label-body/lifecycle，native/Codex前后顺序，八组PTY七次reload | 通过 |
| retired editor释放、原生undo无上限/setText不清栈/RSS边界 | #15九个真实SDK WeakRef、原生undo收尾，版本未变 | 复用已验收证据，不把退出PID等同heap回收测量 |
| 可安装产物、文档命令、当前扩展组合 | 本轮两份tarball证据、八组PTY、manual launcher smoke | 通过已列组合和命令；无日常全局安装 |
| 真实终端输入与中文 | OS PTY、UTF-8、bracketed paste、SGR鼠标、SIGWINCH | 通过这些输入层；不是物理键盘/IME候选窗口 |
| 物理IME候选位置、组合态不误提交 | 当前无桌面终端输入与观察能力，入口不是TTY | **未执行，人工缺口；#16不满足全部通关条件** |
| 终端当前字体实际cube/command字形 | 未操作用户终端，不从TERM或已装字体推断实际字形 | **未执行，人工缺口** |

## Deferred responsibility closeout

| Owner | Requirement | Disposition |
| --- | --- | --- |
| 旧#8/#9/#10 | 输入、生命周期、历史与旧安装 | 仅保留来源；当前源码的正式测试重新执行，不直接沿用旧规格的通过结论 |
| #14 | 右侧标点及所有激活入口 | 当前正式+PTY通过，已关闭前置有效 |
| #15 | 成标来源、动作/键位、坐标布局/resize、上下鼠标、undo/kill ring/外部编辑器、折叠粘贴、历史队列、成功正文/分支、偏好故障 | 当前正式重跑通过；本轮新增产物组合断言通过。长输入时间/内存与九个retired editor测量复用同产品基准证据，不机械重跑历史探针 |
| #16 | 实际产物/文档/扩展组合/完整矩阵/清理 | 自动化完成，见本报告 |
| #16 | 实际终端/IME及物理字体 | PTY部分完成，物理部分未执行。交协调者组织人工观察；不能将责任删除或宣告整关通过 |
| 既有全仓缺文件 | MCP prototype及旧发布文档 | 原样保留失败；不恢复18份无关文件，不删测试/清单，不降低门槛 |
| 公开API正确性反例回流 | 发生则退回所属关卡/Planning | 本轮未发现新的产品行为反例，无产品修复 |

## Checks

| Command | Result |
| --- | --- |
| `pnpm run check` | [失败日志](skill-final-check.log)，typecheck通过；155 files通过、1 suite失败、3 files跳过，2298 passed / 5 skipped。缺`prototypes/mcp-status-ui-prototype/src/codex-startup.js`，随后build/package短路 |
| `pnpm exec vitest run extensions/skill-mentions/__tests__ extensions/codex-ui/__tests__` | [580 passed](skill-final-formal.log)，无新增skip |
| `pnpm run build` | [独立通过](skill-final-build.log) |
| 八个生成入口动态import | [通过](skill-final-built-entries.log)；仅作入口检查，共同运行另有PTY |
| `pnpm run package:check` | [失败](skill-final-package-check.log)，既有`docs/goal-descendant-acceptance.md`缺失 |
| `pnpm exec tsc ... extensions/skill-mentions/__tests__/*.ts` | [额外检查失败](skill-final-test-types.log)，`label-surface.test.ts:14`不充分Theme断言、`:26`写只读columns。该文件本轮未改；此检查不在项目check内，不能因此隐瞒失败，也未把产品类型检查说成测试文件全通过 |
| 同参数单独检查`pty-fixture.ts` | [退出0](skill-final-fixture-types.log)，新增公开ctx.reload/本地tool fixture无类型错误 |
| `node --check`三个mjs入口 | 退出0 |
| manual launcher四模式 | [smoke JSON](skill-final-manual-smoke.json) / [日志](skill-final-manual-smoke.log)，八个CLI正常退出，偏好与会话恢复，临时目录删除 |
| manual launcher非TTY | [日志](skill-final-manual-nontty.log)，按预期退出2，不伪造交互能力 |
| `git diff --check` | 收尾通过 |

仅测试子进程移除四项 `PI_SUBAGENT_PARENT/PI_SUBAGENT_LAUNCH/PI_SUBAGENT/PI_SUBAGENT_ID`，未改全局环境。完整测试文件tsc失败交协调者知悉，不属于新产品正确性回归；若需要修复，交原#15 worker，不与其并行修改。

## Manual acceptance gap

本环境可以创建和读写 OS PTY、读取ANSI单元与硬件光标定位；当前工具入口 `tty` 返回 `not a tty`。没有可用于专用本机终端的桌面键盘、输入法组合态控制或字形观察工具。浏览器页面自动化不能代替这些能力。本轮没有操作用户日常终端、全局字体或输入法。

最小人工步骤已写入 [Manual terminal verification](../../docs/skill-mentions.md#manual-terminal-verification)。协调者可在专用终端分别运行：

```bash
pnpm exec node extensions/skill-mentions/__tests__/manual-terminal.mjs native regular
pnpm exec node extensions/skill-mentions/__tests__/manual-terminal.mjs codex regular
pnpm exec node extensions/skill-mentions/__tests__/manual-terminal.mjs native fullscreen
pnpm exec node extensions/skill-mentions/__tests__/manual-terminal.mjs codex fullscreen
```

每组观察中文组合态候选位置、选词只提交一次、标签两侧/换行/resize后输入；核对cube实际字形、两处青色正常字重和背景、切换command后reload/真实重启保持。记录终端版本、字体、输入法和结果，可附截图。launcher使用当前构建，不是安装产物复验；tarball链路已由本轮独立验证。缺字应如实记录，不能替用户改字体后宣称原配置通过。

## Accepted cost and other limits

用户接受原生同步逐字符动作的大粘贴undo成本，10 MiB/64名称约650 MiB额外heap仍是已知限制。分组undo不减少原生快照；正常提交清栈，setText不清栈，GC只释放不可达对象，RSS不保证立即返还。极端OOM、10 MiB×1024及无限次连续编辑未测试，也不承诺安全。没有引入异步pending/native双状态，没有拿性能理由放宽原文、同步发送、undo或kill ring契约。

原生首条assistant前不落盘、写盘失败可能破坏parent链仍是Pi边界；本扩展没有WAL或损坏JSONL修复。压缩可以移除卡片和摘要替代全文，不重新注入旧skill。屏幕复制显示字形，不提供新原文复制命令。

## Cleanup and handoff

[清理记录](skill-final-cleanup.json)核对本轮全部PTY、manual launcher、CLI和本地MCP PID，不存在存活子进程或其监听端口。安装consumer、tarball、隔离HOME/agent/session/cache、manual目录、编译缓存及本轮新增quality stderr已清理。实际tarball不长期保留，清单和SHA-256已归档，可用脚本重建。

保留已有其他临时资料和worktree。旧`.tmp/skill-ui-prototype-GG4yw8`仍不存在，本轮未删除、未重建，也不声称保留。未执行任何实际远端provider、外部MCP服务或子代理请求。

交付后由协调者核对证据、处理人工缺口和额外fixture类型问题，再填写Acceptance。本worker仅更新#16 Execution/Delivery/Verification，不填写Acceptance、不关闭Issue、不改Map/Spec/progress。
