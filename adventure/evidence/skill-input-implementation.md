# Skill input implementation

## Scope

本报告对应 [Implementation #8](https://github.com/wangxuyang1221/pi-ext/issues/8)，规格以 [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2) 正文为准。

开发入口为 `extensions/skill-mentions/src/index.ts`。本关完成补全、引用识别、消费时读取、同一 user 快照和原生卡片展示。没有加入 `package.json` 的 `pi.extensions` 或发布 `files`；只把新源码接入 typecheck、build 和 clean。

队列、JSONL、历史 editor 适配、分支与压缩的完整验收归 #9。安装、真实 PTY、输入法、快捷键和现有扩展组合归 #10。当前代码不是完整可安装交付。

## Environment and sources

- 接手基准 `b6c75eb93321f42e6d73abe73b5119fee761799f`，分支 `adventure/skill-mentions`，初始工作区干净。
- 实际版本为 Node.js `22.22.2`、pnpm `11.9.0`、Pi coding-agent / tui `0.86.0`，Pi 自带 Marked `18.0.11`。
- 完整阅读安装包的 `extensions.md`、`tui.md`、`skills.md`、`sdk.md`、`session-format.md`，以及 `github-issue-autocomplete.ts`、`input-transform.ts`、SDK `06-extensions.ts` 示例。
- Context7 `/earendil-works/pi` 和 `/markedjs/marked` 返回 main/master 文档，没有目标版本 ID。版本行为以安装包类型、源码及真实执行核验。
- 本次重新计算 Pi source map 内原始源码 SHA-256，三项与[已核验的官方 0.86.0 源码](skill-input-api-audit.md#version-and-sources)完全一致：

| Source | SHA-256 |
| --- | --- |
| agent-session.ts | `3ea88a751cd830db66ae9348be9f8dfbd5218a01e74b445f3aee9fb87ad3e865` |
| interactive-mode.ts | `01ebf39a2ce0b8939076fbd5cc78e9cad6f49f642a608cd3b2adb8d215e6c0f0` |
| editor.ts | `241695859d48f49c6aaba9b9cfc14c6cd28639c6c247adb4fe2c202a9e2c6e20` |

采用的公开入口为 `getCommands`、`addAutocompleteProvider`、`message_start/end`、`appendEntry`、`registerEntryRenderer`、`registerMarkdownTransformer`、`SkillInvocationMessageComponent`，以及 pi-tui 公开导出的 `Marked` / `Token`。没有修改已有实例方法、原型或全局 Pi。

Marked 的 lexer 和 token 字段以安装的 `marked.d.ts` 核验；遍历成本以 source map 内 `src/Instance.ts` 核验。官方 [v18.0.11 tag](https://github.com/markedjs/marked/tree/v18.0.11) 已用 GitHub API 核验，其对象为 `53cb13f13fc13d433269248c5caa255ffa1361ee`。Context7 的[通用 lexer 文档](https://github.com/markedjs/marked/blob/master/docs/USING_PRO.md)仅用于查找 API，不代替版本核验。

## Implementation

- `references.ts` 先扫描满足双侧空格、换行、Tab 或输入边界的候选，再用 Pi 的 Markdown lexer 排除代码。临时唯一标记将嵌套 token 关联回原文坐标，不改变用户文本。覆盖行内代码、不同长度 backtick、tilde 围栏、列表与引用块中的围栏、表格和链接中的行内代码。未闭合的普通 backtick 按 Markdown 的普通文本语义处理，补全和激活不使用两套代码判断。
- `autocomplete.ts` 叠加现有 provider，只按已发现 skill 的名称过滤。名称、描述取自现有元数据，不新增提示文案。Tab/Enter 使用原编辑器菜单；选择仅替换当前引用，不加空格、不改其他行。slash 和其他 provider 行为继续委托。
- `loading.ts` 用一次 `getCommands` 清单构建 Map，引用按首次出现顺序去重。逐个读取已发现 skill 的来源路径，去 frontmatter，并沿用 Pi 原有 `References are relative to ...` 说明。未知或读取失败项不生成卡片，原任务不变。失败项也不会因重复引用而反复读取。
- `index.ts` 在 user `message_start` 读取并追加展示，在 `message_end` 返回同 role user，将完整封装与图片一起保存。开始/结束之间按 message 对象关联，不靠文本匹配。展示 entry 不进入模型上下文。所有加载入口仅处理 TUI 的 user。
- renderer 只使用原生 skill 组件；Markdown transformer 只还原严格识别的 user 封装。原生 slash 展开及已有快照不会进入引用激活流程。

## Protocol

完整文本形式为固定开头 `<pi-ext-skill-mentions version="1">`、一行 JSON、固定结尾 `</pi-ext-skill-mentions>`，两处分隔为换行。JSON 内部换行由 JSON 序列化转义，正文中出现相同结尾字符串也不会提前终止解码。

字段如下，所有层级均拒绝额外或缺失字段：

- `namespace` 必须为 `pi-ext/skill-mentions`，`version` 必须为数字 `1`。
- `requestId` 为小写 UUID v4；每次新加载独立生成。
- `task` 保存原始文本，包含未识别和失败的引用。
- `skills` 是非空列表，name 唯一。每项包含 `name`、绝对 `location`、与 `dirname(location)` 相同的 `baseDir` 和字符串 `body`。
- `body` 包含 Pi 原有相对目录说明及完整去 frontmatter 正文，与原生 slash 一样 trim 两端空白。

`decodeSnapshot` 不解码普通 JSON、普通文本、原生 `<skill>`、未知版本、截断封装、字段类型错误、相对路径和重复 skill。激活入口对本命名空间的封装前缀保守透传，未知版本不会递归扫描正文。该协议用于识别自身数据，不是签名或鉴权机制。

#9 可复用 `decodeSnapshot(...).task` 实现公开 editor 回填适配。当前 `displayType` 为 `pi-ext/skill-mentions/display-v1`，展示 entry 保存同一完整快照。恢复显示按 active entries 中的 requestId 关联；本关只做了同 session 重建验证，不能据此宣称跨会话恢复通过。

## TDD record

各轮完成当前测试失败与通过后，再推进下一项。首次建立模块时先运行对应测试，确认缺少实现入口；随后补充行为反例，以下差距均实际运行过 Red → Green：

| Behavior | Observed red | Green |
| --- | --- | --- |
| 代码排除 | 普通 token 扫描误收集 inline / fenced 引用 | Markdown 代码区域被排除 |
| 严格协议 | 简单 JSON.parse 接受 null、错误版本、错误路径、重复 skill 等 16 种非法结构 | 完整 schema 校验拒绝非法封装 |
| 静默失败 | 注入 EACCES 后整次加载抛错 | 仅略过失败项，其他 skill 与任务保留 |
| 原生 slash 隔离 | 原生 skill 正文中的 `$beta` 被重新加载 | 原生展开与 slash 输入透传 |
| 嵌套围栏 | 手写扫描把列表内 `$alpha` 当正文，并错误遮蔽列表后的 `$beta` | 改用公开 Markdown lexer 后只保留 `$beta` |
| 补全/激活一致 | 最初额外抑制未闭合 backtick 草稿，导致补全与提交识别不一致 | 删除这条额外规则，统一使用 Markdown 语义 |
| 补全成本 | 100 KiB 草稿中位耗时 145.25 ms，超过事先设定的 100 ms 预算 | 去掉无用回调结果的重复拼接，最终 7.30 ms |

原生卡片展开时 Markdown 会解释路径内的下划线并按宽度折行。曾有测试错误地把屏幕文本当作未经 Markdown 处理的完整路径；修正为分别断言原生展开正文和快照内精确路径，没有更改产品 renderer。

## Functional verification

[正式测试日志](skill-input-tests.log)为 6 个文件、87 项通过，没有新增 skip：

- `references.test.ts` 19 项，输入边界、光标、Markdown 嵌套与源坐标。
- `autocomplete.test.ts` 19 项，实际 Editor 与 CodexEditor 的 Tab/Enter、取消、两侧正文/多行、代码排除及原生 slash 补全。
- `protocol.test.ts` 18 项，协议 round-trip、非法字段、普通 JSON 和原生历史隔离。
- `loading.test.ts` 13 项，去重、稳定顺序、部分名/未知名、失败、正文不递归、10/100 个 skill 的清单访问及读取次数。
- `registration.test.ts` 8 项，TUI 补全注册、其他模式和 assistant/tool/custom/system 排除。
- `flow.test.ts` 10 项，真实 DefaultResourceLoader、extension runner、AgentSession、内存 session 与官方 faux provider。实际文件 loader 能加载开发入口；模型请求与持久化 user 保存同一快照和图片，普通插件 user 可以加载，原生 slash 保持原样。

transcript 测试使用真实 InteractiveMode 方法和原生组件，但 terminal/editor 宿主为 inert fixture，不是 PTY。provider 离线，未请求真实模型。图片为受控 ImageContent fixture，验证的是消息保留，不是终端图像显示质量。

复现命令：

```bash
pnpm exec vitest run extensions/skill-mentions/__tests__
pnpm exec tsc -p extensions/skill-mentions/tsconfig.json --noEmit
pnpm exec tsc --noEmit --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node extensions/skill-mentions/__tests__/*.test.ts
```

## Performance verification

候选扫描、临时标记、token 遍历均按输入或 token 数增长。每次补全只读取一次清单，不读取 skill 文件。加载使用 Map + Set，每个不同有效 skill 最多一次文件读取，逐项 await，不创建无界并发读取。

100 KiB 混合 Markdown 草稿的单次同步补全 CPU 预算定为中位耗时低于 100 ms，用于检出明显阻塞输入的实现，不以首次测量反推门槛。测试先热身 5 次，再采样 20 次；同时用正确性断言核对围栏内引用未泄漏。

[首次失败记录](skill-input-performance-red.log)为 145.25 ms。拆分 lexer 和 walkTokens 计时后，约 2000 段输入的 lexer 为 12.39 ms，walkTokens 为 140.02 ms。安装源码显示 walkTokens 会反复 concat 累积回调结果；本任务只需访问 token，不需要这些结果。改为迭代遍历公开 token 字段，没有改 lexer、实例或原型。

[最终结果](skill-input-performance.log)，Apple M5 / Node 22.22.2：

| Input bytes | Outside-code candidates | Median ms | Maximum ms |
| --- | --- | --- | --- |
| 1,063 | 41 | 0.18 | 0.42 |
| 10,285 | 389 | 0.78 | 0.91 |
| 102,452 | 3,867 | 7.30 | 8.19 |

```bash
pnpm run build
node extensions/skill-mentions/__tests__/benchmark.mjs
```

这些数字只代表本机的固定 Markdown 负载，不承诺所有终端或任意对抗输入的耗时。

## Repository checks

本 worker 继承了 subagent 启动环境。直接运行基准会使已有 goal 测试把 fixture 误判为子会话。仅清除 parent 又会让已有 subagent loader 检测到不完整启动元数据。最终基准和最终 check 都在测试子进程中同时清除四项标记，未修改工作进程或全局环境，也未排除测试：

```bash
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH -u PI_SUBAGENT -u PI_SUBAGENT_ID pnpm run check
```

| Check | Result |
| --- | --- |
| [基准 check](skill-input-baseline-check.log) | typecheck 通过；1953 passed、5 skipped；1 个既有 MCP suite 收集失败 |
| [最终 check](skill-input-final-check.log) | 包含新增源码的 typecheck 通过；2040 passed、5 skipped；同一个 MCP suite 收集失败，无新增失败 |
| [单独 build](skill-input-build.log) | 通过，包含 skill-mentions |
| [单独 package:check](skill-input-package-check.log) | 既有 `docs/goal-descendant-acceptance.md` 缺失，失败 |
| 新扩展测试独立 tsc | 通过 |
| `git diff --check` | 通过 |

MCP 缺失路径为 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`。全仓 check 因测试失败不会继续 build/package:check，因此本次另外执行两步，未跳过失败或补造文件。不能声称全仓 check 或发布包检查通过。

## Cleanup and remaining work

本次没有后台服务、监听端口或真实模型请求。测试目录全部位于 worktree 的 `extensions/skill-mentions/__tests__/.flow-*`，afterEach 已清理；临时 Marked 源码核验文件也已删除。未修改全局 Pi。

本关没有规格偏离。以下尚未验证，按已审核切片移交：

- #9 实际 steer/followUp、多条队列顺序、消费时版本变化、JSONL 中断/失败、reload/resume/tree/fork、公开 editor 回填适配、安装顺序、重复 reload 和压缩边界。
- #10 真正 TUI 启动与 PTY、中文输入、自定义快捷键、全部现有扩展共同加载、安装产物及完整 Spec 验收。
- 与其他 extension 的 message_end/Markdown transformer/editor factory 组合仍需后续集成证据。当前闭环不声称覆盖所有第三方改写行为。
