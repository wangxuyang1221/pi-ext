# Skill mentions install acceptance

## Result

[Implementation #10](https://github.com/wangxuyang1221/pi-ext/issues/10) 的本功能交付与整体验证已完成，交协调者验收。唯一完整规格仍为 [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)。本报告不替代协调者 Acceptance，也不宣称全仓 check 或 package:check 通过。

实际 tarball 可以生成、通过 pnpm 安装、被 Pi 本地 package 安装加载。五组真实 CLI PTY 均通过，每组 15 类断言、19 次离线 provider 消费，包含一次退出后恢复，共 10 个真实 Pi 进程。正式测试 117/117 通过。全仓 check 仍有一个既有 MCP suite 收集失败，package:check 仍有既有缺失文档错误。

接续基准 `46bb422`，此前产品基准 `c3f2284`。用户已明确不恢复无关资料。本轮没有恢复或删除旧文档/prototype，没有排除旧测试，没有移除清单引用或降低旧校验门槛。[上轮阻塞调查](skill-install-blocker.md)保留为历史记录，其中必须先恢复文件的建议不再适用。

## Delivery

- `package.json` 将 `extensions/skill-mentions/dist/index.js` 加入默认 Pi 清单，将编译目录和 `docs/skill-mentions.md` 加入发布清单。`scripts/check-package.mjs` 同步增加对应必需项，保留所有旧项。
- `docs/skill-mentions.md` 与 README 说明安装、输入边界、取消、队列、历史、压缩及原生持久化限制。没有新增产品提示文案。
- `extensions/skill-mentions/__tests__/acceptance.mjs` 执行实际 prepack/build、tarball 内容核验、独立 pnpm 安装、全部八个安装入口 import，然后运行真实 Pi CLI PTY。入口命令为 `pnpm run skill-mentions:acceptance`。
- `pty-driver.py` 使用 OS PTY 和 pyte 解码真实终端输出。`pty-fixture.ts` 只通过公开 API 注册官方 faux provider、观察快捷键和普通 user 发送命令，不替换 editor、terminal、消息持久化或产品解析器。
- 产品修复两处真实 `/reload` 集成遗漏，详见下一节。全部 dist 由构建生成，没有手改。

## Reload findings and TDD

真实 CLI `/reload` 与此前替代宿主有两个重要差别：

1. `handleReloadCommand` 的 `beforeSessionStart` 回调先重建 transcript，之后才执行新扩展 `session_start`。原 renderer 在尚未取得 context 时返回 undefined，Pi 的 `hasContent()` 随即把已有卡片排除，后续普通重绘不会补回。
2. Pi 重建 editor factory 时只复制草稿、callbacks、appearance、autocomplete 和 app handlers，不复制历史。reload 的 transcript rebuild 也不请求 `populateHistory`。此前测试在 bind 完成后主动重建或调用 `renderInitialMessages`，没有覆盖真实顺序。

本轮先增加失败测试，再修复：

| Behavior | Red evidence | Fix and green |
| --- | --- | --- |
| 包默认发现与发布 | [package red](skill-install-package-red.log)，缺少 dist 清单项 | 接入 files/pi.extensions，产物实测加载 |
| 原生/Codex reload 后回填历史 | [history red](skill-install-history-red.log)，两个用例得到空输入 | 仅在 `resources_discover.reason === reload` 的 factory 初始化中，从 active context 通过公开 `addToHistory` 填充原文 |
| reload 在 session_start 前重建卡片 | [reload red](skill-install-reload-red.log)，有效卡片消失 | renderer 返回延迟渲染组件，在 render 时按当前关联判断可见性；实际内容仍为公开原生 skill 组件 |
| 首次启动历史不能重复 | [startup history red](skill-install-startup-history-red.log)，第三次上翻又出现重复 task | 限制额外历史填充只用于 reload，startup/resume 的历史仍由原生宿主填充 |

回归还验证了 pre-start 构建时孤立卡片不显示、文件已删除时不重读、不改 JSONL、不补 entry，以及重复 discovery 只扫描一次历史、不重复安装 factory。总共新增 5 项正式测试，从 112 项增至 117 项。

这些修复仍在公开组件和 editor factory 组合范围内。不修改已有实例方法或原型，不调用产品中的私有宿主方法，不改变 Spec 契约。测试夹具使用宿主原有方法复现时序，不是产品补丁。

## Artifact verification

运行命令：

```bash
pnpm run skill-mentions:acceptance
```

[完整运行日志](skill-install-acceptance.log)和[产物清单、SHA-256、入口及场景记录](skill-install-artifact.json)。归档测试日志只清理行尾空格和末尾空行，没有删改错误或断言。

验证路径：

1. `pnpm pack --pack-destination <worktree temporary directory>`，保持 prepack 开启，因此实际执行原有全仓 build。
2. `tar -tzf` 列出实际产物，共 493 项。核对本功能入口和使用文档存在，并用仓库原有 `assertSafePublishedPath` 检查全部内容，禁止测试、fixture、日志载荷。
3. 在 worktree 下独立 pnpm consumer 中安装该 tarball，`--ignore-scripts`，Pi peers 固定 0.86.0。consumer 自带独立 workspace 边界并沿用仓库已核验的 release-age 精确例外，不降低全局依赖策略。
4. 检查安装后的 manifest 与仓库 Pi 清单一致、本功能每个编译文件与本次 build 逐字节相同，以及全部八个安装入口可 import。没有把源码 symlink 当作已安装产物。
5. 每个 PTY 场景实际执行隔离的 `pi install <installed package path>`，核验写入的相对路径解析到该产物。原生与 Codex-only 场景再使用 Pi 公开 package resource filters；combined 场景保持安装命令写出的完整 package 清单，不过滤扩展。
6. 从 consumer 安装的 Pi 0.86.0 CLI 启动，不使用替代 InteractiveMode。结束时删除 tarball、consumer、依赖缓存、HOME、agent 目录与 sessions。

旧 `package:check` 因清单中已删除的资料失败，但这不是 pack 的前置脚本。上述实际运行纠正了上轮将包校验失败直接视为安装无法继续的判断。旧缺失资料仍然是全仓发布检查缺口，本功能产物检查不把它们标成通过。

## Real PTY matrix

终端为 120 列、50 行，`TERM=xterm-256color`，硬件光标开启。每项结果保留终端屏幕、输入事件、原文 editor 观察、实际 provider 最后 user、磁盘 user、安装结果、PID 和退出状态。

| Mode | Loaded package resources | Result |
| --- | --- | --- |
| [native](skill-install-pty-native.json) | skill-mentions，原生 editor | 15 类断言，19 次 faux 消费，首次及恢复进程均 exit 0 |
| [native fullscreen](skill-install-pty-native-fullscreen.json) | skill-mentions，原生 editor/fullscreen | 同上 |
| [codex](skill-install-pty-codex.json) | 完整 codex-ui + skill-mentions，非单独 CodexEditor 类探针 | 同上 |
| [combined](skill-install-pty-combined.json) | 八个默认扩展与主题 | 同上 |
| [combined fullscreen](skill-install-pty-combined-fullscreen.json) | 八个默认扩展与主题/fullscreen | 同上 |

每组实际执行以下操作：

- 中文多行草稿中移动光标，在两侧正文之间逐字输入 `$al` / `$be`；Tab 和第一次 Enter 只选择，provider 消费数不变；第二次 Enter 消费一次，任务、多行和两侧正文精确保留。
- 真实原生 skill 卡片与展开正文；把 `app.tools.expand` 配置为 F3，实际按键展开。
- Esc 只取消候选，保留完整引用仍激活。名称中间编辑、文字/标点紧邻、Markdown 代码、转义、未知名称和普通美元文本不误激活。
- 重复 `$alpha` 去重，多 skill 按出现顺序进入同一 user；记录真实文件路径。
- 三次真实 `/reload` 后，自定义 Ctrl+P 历史键回填原文，已有卡片仍在，不露封装。修改 keybindings.json 后第四次 `/reload`，新 F4 行首键生效并正确编辑中文。
- fixture 扩展发送普通 user，包含重复引用及一张受控 PNG；模型请求保留一张图片和两项快照。删除已发现 beta 文件后，它和未知名称静默回退，alpha 继续加载。
- 逐字输入原生 `/skill:al`，Tab 补全，调用仍得到原生 `<skill>` 内容，不变成本插件协议。
- 官方 faux provider 暂停受控响应时，用真实 Alt+Enter 排 followUp。队列显示 `排队 $alpha`；消费前改文件，模型收到 `ALPHA_VERSION_TWO`。磁盘 user 与最后实际 provider 请求的全部 user 逐项相同。
- 正常 `/quit` 后删除剩余 skill 源文件，再以 `--session` 启动真实 CLI。Ctrl+P 回填原文，F3 展开已保存版本，后续普通请求仍带历史快照，证明恢复不依赖源文件存在。

combined 用例检查了 goal、mcp、permissions、codex-ui、openai-fast-mode 的命令来源和 subagent 的工具来源，同时保留完整包加载设置。codex-compact 没有独立命令，因此不虚构其命令证据；它在默认清单中加载，八个入口 import 均通过，启动与 reload 无扩展加载错误。faux 请求不触发真实 Codex 远端压缩，也不执行子代理或连接外部 MCP 服务器。

## Complete Spec matrix

本表按 Spec Acceptance 顺序逐项核对，不另行复制完整规格。正式测试均为本轮重跑；历史与压缩的证据类型仍按 [#8](skill-input-implementation.md)、[#9](skill-history-implementation.md) 报告界定。

| Acceptance | Evidence and result |
| --- | --- |
| 原生/Codex 句中、后续行候选；Tab/Enter 首次只选择；保留两侧正文 | 五组实际安装 PTY 通过；autocomplete/history-editor 正式测试通过 |
| 相邻文字/标点、名称中间、代码、转义不误触发；普通美元不阻断 | PTY 反例通过；references/autocomplete/loading 全部通过，含嵌套 Markdown 及光标边界 |
| 完整引用手写、粘贴、菜单等效；去重与首次顺序 | PTY 三类输入和重复项断言通过；autocomplete/loading 用例通过 |
| 多 skill 同一 user、任务与图片；未知/不可读静默回退 | 实际 provider 请求与 JSONL 比对通过；PTY 删文件混合引用与插件图片通过；flow/loading/protocol 通过 |
| 插件普通 user 可触发；其他 role 及 RPC/print 排除 | PTY 插件发送通过；registration/flow 来源与模式边界测试通过。RPC/print 不在交付功能范围，不将其声明为支持模式 |
| 原生 slash 补全/调用/旧历史保持；原生 skill 外观，无内部补丁 | 五组 PTY slash 与原生卡片通过；history-editor/protocol/flow 旧历史隔离通过 |
| idle、steer、followUp、多条队列，消费版本、图片和关联不串位 | PTY idle/followUp 与文件更新通过；lifecycle 真 AgentSession/runtime 的 steer/followUp 同文多条图片、UUID 和顺序用例通过。多条 steer 的证据是 SDK，不冒充 PTY |
| reload/resume/tree/fork 已有快照不重读、原文编辑、孤立隐藏、不补卡、不串分支 | 五组真实 CLI reload/restart/resume 通过；新增 pre-session_start 回归通过；lifecycle/visibility 的真实 runtime tree/fork/clone、活动分支和缺卡用例通过 |
| compaction 卡片消失但 user 保留时快照仍在；摘要覆盖后不重注入 | lifecycle 两个真实 session.compact 用例通过，离线固定摘要。未调用付费压缩模型 |
| 实际加载、重复 reload、callbacks/快捷键、真实终端与安装产物 | 实际 tarball、pnpm 安装、pi install、10 个 CLI 进程、五组 PTY 通过；editor callbacks 与两种安装顺序的正式测试通过 |

## Checks and performance

```bash
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH -u PI_SUBAGENT -u PI_SUBAGENT_ID pnpm run check
pnpm exec vitest run extensions/skill-mentions/__tests__
pnpm exec tsc --noEmit --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node extensions/skill-mentions/__tests__/*.ts
pnpm run package:check
node extensions/skill-mentions/__tests__/benchmark.mjs
```

| Check | Result |
| --- | --- |
| [正式测试](skill-install-tests.log) | 10 文件，117 passed，无 skip |
| 本功能测试/fixture 独立 tsc | 通过 |
| [全仓 check](skill-install-final-check.log) | typecheck 通过；2070 passed、5 skipped，1 个既有 MCP suite 收集失败。check 失败，没有进入其后续 build/package:check |
| 实际 prepack/build | 在 [acceptance 日志](skill-install-acceptance.log) 中通过 |
| [全仓 package:check](skill-install-final-package-check.log) | 失败，首个错误仍为既有 `docs/goal-descendant-acceptance.md` 缺失 |
| [本功能实际产物与 PTY](skill-install-artifact.json) | 通过，独立于旧全仓失败 |
| git diff --check | 通过 |

沿用既有单次清单读取、不同 skill 一次文件读取、恢复零读取和按 leaf 建索引的确定性约束。新 renderer 在首次可见 render 构造原生卡片后复用，不在每帧重复创建。reload 历史只在 factory 初始化时扫描 active context，不读文件；重复 discovery 不重扫，保留原生 addToHistory 的 100 条上限。

[补全性能](skill-install-performance.log)在 Apple M5 / Node 22.22.2 上，1 KiB / 10 KiB / 100 KiB 草稿中位耗时分别为 0.18 / 0.90 / 8.38 ms。100 KiB 最高 10.20 ms，满足此前制定的 100 ms 中位预算。这不是所有机器或任意 Markdown 的耗时保证。

## Environment and sources

实际版本为 Node.js 22.22.2、pnpm 11.9.0、Pi 0.86.0、Python 3.12.13、pyte 0.8.2。安装脚本固定 Pi peers；registry 提示存在 0.86.1 不代表本次采用了该版本。

完整阅读目标安装包的 extensions、tui、custom-provider、keybindings、environment-variables、packages、quickstart、settings、terminal-setup、session-format 文档，以及 modal-editor/github-issue-autocomplete 示例。Context7 的 Pi、pnpm、pyte 结果没有对应全部精确版本，具体行为以目标安装源码、pnpm 11.9.0 CLI help 和执行结果核验。

固定官方 Pi 来源为 `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`：

- [package-manager.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/package-manager.ts)，官方内容与安装 source map 完全一致，SHA-256 `e2fdd18093dc69cb8fe82bb6bef674f20f8a5093d0d13fd1b7180f49dbe751fd`。
- [faux.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/ai/src/providers/faux.ts)，官方内容与安装 source map 完全一致，SHA-256 `b0f0f8b2335150cf6be34260885eca8b901cdbf64de852d6fccc50b06875b1e6`。
- [interactive-mode.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts)，复核 `handleReloadCommand`、`setCustomEditorComponent`、`renderInitialMessages`、`addCustomEntryToChat`；source map SHA-256 仍为 `01ebf39a2ce0b8939076fbd5cc78e9cad6f49f642a608cd3b2adb8d215e6c0f0`，与此前官方审计一致。
- AgentSession 与 SessionManager 的 source map hash 也与 #9 官方核验值一致。pyte 的 `Screen`、`Stream.feed` 和 display API 以当前 0.8.2 安装源码核验，Context7 master 示例仅用于定位。

## Evidence limits and cleanup

- 中文验证是向真实 PTY 输入已提交的 UTF-8 汉字和 bracketed paste，并核对光标编辑、原文和实际消费结果。没有操纵 macOS 输入法候选窗口，不声称已人工验收某个终端模拟器的 IME 候选定位、字体、图片显示质量或 Kitty 全部键盘协议。
- 图片验证的是 user 内容保留，不是终端图像显示质量。压缩、tree/fork、多条 steer 仍使用正式 SDK/runtime 离线测试，不替换成未经执行的 PTY 声明。
- 全扩展组合验证的是当前八个默认扩展的加载、reload 和本功能链路。没有测试真实 MCP 服务、子代理任务、远端 provider 或任意第三方主动覆盖 factory 的行为。
- 保留首条 assistant 前不落盘、写盘失败可能破坏原生 parent 链的既有 Pi 边界。本轮没有新增存储事务保证。发送后卡片美化继续延期。
- 验证夹具开发中修正了 pnpm 向父 workspace 安装、Pi local path 保存为相对路径、package filter 不带 `./`、粘贴 slash 与逐字自然触发不同、队列期间 Esc 会中止响应、message_end observer 先于 package handlers 等夹具假设。这些不是产品 TDD Red。pnpm 父 workspace 误安装后已按原锁文件重建依赖，根 lockfile 未改，store 路径已恢复。
- 所有安装、配置、session、dependency cache 都放在本 worktree 临时目录。每轮 finally 删除本轮目录；测试 afterEach 清理 `.flow-*` / `.lifecycle-*`。最终无 `skill-install-*` 临时目录。
- 10 个最终 PTY Pi PID 都已正常退出并 waitpid 回收，另行检查 `kill(pid, 0)` 均不存在。没有启动本任务监听服务器或模型服务，无遗留监听端口；失败试跑也在 finally 停止 PTY。未修改全局 Pi，未发真实模型请求。外网操作限于依赖安装、文档/源码核验及获准的 GitHub 维护。

本功能无待修复的已知验收失败；上述未执行范围保留为证据边界，不改称通过。旧全仓缺文件问题按用户指示保持原样，由协调者分别核对本功能验收与全仓失败记录。
