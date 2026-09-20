# Skill punctuation implementation

## Result

[Implementation #14](https://github.com/wangxuyang1221/pi-ext/issues/14) 已完成本关代码与验证，等待协调者验收。完整规格以 [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2#references-and-boundaries) 为准。本关没有实现 #15 标签，没有规格偏离。

接手提交 `b58d714`，分支 `adventure/skill-mentions`，工作区起初干净。产品行为基准为 `0b9231d`。本次只修改 skill-mentions 的解析器、正式测试、验收夹具、使用说明及本报告证据；没有修改 Map、Spec、progress 或 Issue Acceptance。

## Implementation

`extensions/skill-mentions/src/references.ts` 是唯一改动的产品源码：

- 提交识别使用独立的右侧 `activationBoundary`，明确的 29 个句读/闭合符号使用固定 Set，不采用整个 Unicode 标点类别。
- ASCII 句点例外仅检查直接相邻的一个 Unicode code point。最多截取两个 UTF-16 code units，支持非 BMP 字母/数字，不扫描剩余后缀、不维护文件扩展名清单。
- `completionReference` 继续要求右侧为空格、换行、Tab 或输入边界。左侧、名称扫描、Markdown 代码排除和原文坐标算法不变。

未修改加载、协议、message 生命周期、历史 editor 或原生卡片实现。实际任务与图片仍走原来的消费时快照路径。没有新增产品提示文案。

正式 CLI 验收继续使用原有 `acceptance.mjs`、`pty-driver.py` 和离线 `pty-fixture.ts`。新增 `--evidence-prefix` 让本轮结果另存，不覆盖旧版验收。语法说明更新在 `docs/skill-mentions.md`。

## TDD record

1. 先把旧测试中本轮明确变更的标点拒绝要求移到新预期，新增每个允许标点的解析与候选断言。运行正式源码测试得到 [29 failed / 16 passed](skill-punctuation-delimiters-red.log)，失败均因解析器仍返回空引用列表。
2. 只增加提交右边界判断与候选严格过滤。既有 `$5.00` 反例同时约束句点例外。旧 `$alpha!` 加载拒绝用例改为明确断言成功加载且任务不变。随后本功能全部 [143/143 通过](skill-punctuation-delimiters-green.log)。
3. 逐项补齐 Unicode、完整名称、标点后的正文、禁止边界、代码、输入来源、真实普通 user、队列与图片回归，均在产品源码上运行，没有使用 Planning 的临时解析器副本。相关行为已由最小实现满足，没有为制造 Red 改坏实现。
4. 一次 [fixture 失败](skill-punctuation-fixture-failure.log)来自测试把行首 Tab 当普通分隔。Markdown 将它解析为缩进代码，原行为正确。将正例改成正文后的 Tab，并保留缩进代码排除断言；没有修改产品来规避代码规则。后续全部通过。

## Formal verification

[最终正式测试](skill-punctuation-tests.log)共 10 个文件、280 项通过，无新增 skip。比基准 117 项增加 163 项。

| File | Tests | Evidence |
| --- | --- | --- |
| references.test.ts | 170 | 全部允许标点及闭合符号；非句点后紧接正文；句点末尾/空白/非名称字符与 BMP、非 BMP 字母数字、下划线、连字符的相反预期；禁止边界、严格左侧、Unicode 名称与原文范围、嵌套 Markdown 代码、严格候选和名称中间光标 |
| autocomplete.test.ts | 25 | 实际 Editor 与 CodexEditor 的手写、bracketed paste、Tab/Enter 菜单生成相同标点任务；第一次选择不发送，之后提交一次；两侧文本、多行、取消、slash 和无效候选回归 |
| loading.test.ts | 15 | 完整 Unicode/连字符/下划线名称，不从未知长名称取库存前缀；失败/未知静默；顺序及去重；10/100 项库存的读取次数约束 |
| flow.test.ts | 14 | 正式源码入口经真实 DefaultResourceLoader、AgentSession、extension API 处理 prompt、插件字符串与 text/image blocks；未知和实际删除文件回退；RPC/print/json 不处理标点任务；原生 slash 与协议隔离 |
| registration.test.ts | 8 | assistant、toolResult、custom、system 包含空白及标点引用时，均不查 skill 清单、不追加展示；补全只在 TUI 注册 |
| lifecycle.test.ts | 18 | 空白及标点两种任务的同文多条 steer/followUp，消费前零读取、消费时版本、独立 UUID、图片和展示顺序；原有 reload/resume/tree/fork/压缩/失败恢复回归 |
| history-editor.test.ts | 9 | 原生/Codex 历史回填、安装顺序、重复 discovery、callbacks、快捷键与原生历史隔离 |
| protocol.test.ts / visibility.test.ts / package.test.ts | 18 / 2 / 1 | 严格协议、活动分支显示与默认发布入口回归 |

SDK/runtime 测试使用真实消息和持久化代码，但无关终端宿主是 fixture，不冒充 PTY。图片断言证明消息保留，不证明图片显示质量。

## Real entry verification

```bash
pnpm run skill-mentions:acceptance --evidence-prefix=skill-punctuation native codex
```

[执行日志](skill-punctuation-acceptance.log)、[实际产物清单与 SHA-256](skill-punctuation-artifact.json)。实际运行 prepack/build，打 tarball、隔离 pnpm 安装，核对安装后的本扩展编译文件逐字节相等，全部八个安装入口可 import。每种模式都实际执行隔离 `pi install`，随后从 consumer 安装的 Pi 0.86.0 启动真实 OS PTY。

| Mode | Result | Processes |
| --- | --- | --- |
| [native](skill-punctuation-pty-native.json) | 18 类检查、27 次 faux 消费通过，含重启恢复 | PID 45077、54736，均 exit 0 |
| [codex](skill-punctuation-pty-codex.json) | 完整 codex-ui 与 skill-mentions 组合，同上 | PID 55617、61936，均 exit 0 |

两组实际执行了：

- 原生候选在中文多行中 Tab/Enter 选择，保留两侧正文，provider 请求数不变；第二次 Enter 才提交。
- 同一 `用 $alpha，继续 $beta.` 经逐字输入、粘贴、Tab 菜单、Enter 菜单生成，提交后均是同一原任务与两个快照。
- 29 个允许标点在同一真实请求内去重；句点扩展名、中文及非 BMP 后缀、未知长名称拒绝；Unicode 名称成功；右侧标点和名称中间不误弹菜单。
- 代码、转义、左侧正文/括号、普通美元/未知名称回退；插件普通 user 的标点引用与图片一起保留；删除已发现文件后静默回退，其余项继续加载。
- 原生 slash 补全/调用、原生卡片、自定义快捷键、四次 reload、原文历史回填继续工作。
- 真实 followUp 队列保存 `排队 $alpha，继续`，消费前修改源文件，实际 provider 收到新版本；JSONL user 与实际 provider user 一致。
- 退出后删除源文件并以 session 文件重启，仍能回填原文、展开已保存快照并向后续请求提供原有历史。

这不是本轮完整 Spec 整体验收。fullscreen、全部扩展的运行组合、物理 IME 和标签视觉由 #15/#16 负责；本关不以旧报告代替这些要求。这里验证的是已提交的 UTF-8 输入和 PTY，未操作 macOS 输入法候选窗口。

## Cost verification

右侧判断每个候选只执行一次固定 Set 查询及最多两个 code units 的句点检查。没有新增 I/O、逐 skill 全文扫描或无界并发。既有加载 Map/Set 保留；正式测试证明 10/100 个不同 skill 即使各重复十次，也只读取对应的 10/100 次。失败重复项只尝试一次。

[性能日志](skill-punctuation-performance.log)在 Apple M5 / Node 22.22.2 上复测原空白负载，并新增标点、Unicode 句点反例和代码混合负载。每组预热 5 次、采样 20 次，沿用既定 100 KiB 中位 CPU 小于 100 ms 的预算，不根据本次结果反推门槛。

| Draft | 1 KiB median | 10 KiB median | 100 KiB median / maximum |
| --- | --- | --- | --- |
| 原空白负载 | 0.18 ms | 0.70 ms | 7.32 / 8.04 ms |
| 标点混合负载 | 0.08 ms | 0.59 ms | 6.12 / 6.58 ms |

这些是固定本机负载，不承诺任意 Markdown 或所有终端的耗时。

## Repository checks

直接 `pnpm run check` 首次继承 worker 的子会话标记，goal fixture 被误判为子会话，出现 134 项失败。这与旧报告记录的环境问题相同。随后仅对测试子进程清除四项标记，未修改全局环境、测试用例、skip 或门槛：

```bash
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH -u PI_SUBAGENT -u PI_SUBAGENT_ID pnpm run check
pnpm exec vitest run extensions/skill-mentions/__tests__
pnpm exec tsc -p extensions/skill-mentions/tsconfig.json --noEmit
pnpm exec tsc --noEmit --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node extensions/skill-mentions/__tests__/*.ts
pnpm run build
pnpm run package:check
node extensions/skill-mentions/__tests__/benchmark.mjs
```

| Check | Result |
| --- | --- |
| [开工基准 check](skill-punctuation-baseline-check.log) | typecheck 通过；2070 passed / 5 skipped；一个既有 MCP suite 收集失败 |
| [最终 check](skill-punctuation-final-check.log) | typecheck 通过；2233 passed / 5 skipped；仍同一个 MCP suite 失败，无新增失败 |
| 本功能正式测试与源码/测试独立 tsc | 280/280 通过；tsc 退出 0 |
| [独立 build](skill-punctuation-build.log) | 通过；dist 只由构建生成 |
| [独立 package:check](skill-punctuation-package-check.log) | 失败，首个错误仍是缺少 docs/goal-descendant-acceptance.md |
| 真实 tarball 安装、入口、两组 PTY | 通过，详见本报告 Real entry verification |
| git diff --check | 通过 |

归档日志只清理行尾空白和末尾空行，未删改错误或断言。

MCP suite 缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`。check 在该测试失败后短路，故单独运行 build/package:check。没有修复无关旧缺文件，不能称全仓 check 或 package:check 通过。

## Versions and sources

实际版本为 Node 22.22.2、pnpm 11.9.0、Pi coding-agent/tui/ai 0.86.0、Python 3.12.13、pyte 0.8.2。Context7 `/earendil-works/pi` 返回 main 文档，未提供精确 0.86.0 版本；版本依据采用安装包、源码和实际执行，不把 main 当作目标版本证据。

完整读取安装包 `extensions.md`、`tui.md`、`skills.md`、`sdk.md`、`session-format.md`、`packages.md`、`custom-provider.md`、`keybindings.md`、`environment-variables.md`、`terminal-setup.md` 及 `github-issue-autocomplete.ts`、SDK `06-extensions.ts` 示例。核对安装包 CustomEditor 实现、AutocompleteProvider 声明和 faux 实现。未引入新的 Pi 产品 API 调用。

本轮重新计算 installed source map 的源码散列，均与此前固定官方 commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc` 审计一致，来源核验过程见[旧输入实施](skill-input-implementation.md#environment-and-sources)、[旧安装验收](skill-install-acceptance.md#environment-and-sources)：

| Source | SHA-256 |
| --- | --- |
| [editor.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/components/editor.ts) | `241695859d48f49c6aaba9b9cfc14c6cd28639c6c247adb4fe2c202a9e2c6e20` |
| [agent-session.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts) | `3ea88a751cd830db66ae9348be9f8dfbd5218a01e74b445f3aee9fb87ad3e865` |
| [interactive-mode.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts) | `01ebf39a2ce0b8939076fbd5cc78e9cad6f49f642a608cd3b2adb8d215e6c0f0` |
| [faux.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/ai/src/providers/faux.ts) | `b0f0f8b2335150cf6be34260885eca8b901cdbf64de852d6fccc50b06875b1e6` |

## Cleanup and handoff

四个 PTY 子进程均正常退出并 waitpid 回收，结束后再次 `kill(pid, 0)` 均为 ESRCH，按这四个 PID 查询 lsof 没有 TCP listener。本任务没有创建监听服务，也没有遗留端口。SDK fixture 的 abort/dispose 和目录清理正常完成。

本次 `.tmp/skill-install-*` 安装目录、隔离 HOME/agent/sessions、缓存和 tarball 均已删除；没有残留 `.flow-*` / `.lifecycle-*` 目录。保留旧 `.tmp/skill-ui-prototype-GG4yw8` 及其他无关文件，没有修改全局 Pi、字体或终端，也没有删除日常 Pi 依赖的 worktree。

只使用官方离线 faux provider，无真实 MCP、远端模型或子代理调用。外网操作限于依赖安装、文档查询和已批准的 GitHub 操作。

交协调者核对本关证据、填写 Acceptance。#14 保持 open；后续是否进入 #15 由协调者决定。
