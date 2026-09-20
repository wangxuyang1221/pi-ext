# Skill queue and history implementation

## Scope

本报告对应 [Implementation #9](https://github.com/wangxuyang1221/pi-ext/issues/9)。唯一完整规格为 [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)。接手基准为 `9d5cce2`，产品基准为 `f600f08`。

本关新增公开 editor factory 适配，并把队列、磁盘持久化、runtime 切换和压缩纳入产品正式测试。#8 的消费和关联实现已满足这些测试，未另写一套恢复逻辑。没有补卡、重注入、改规格或新增产品提示文案。

## Implementation

- `extensions/skill-mentions/src/history-editor.ts` 通过公开 `getEditorComponent/setEditorComponent` 组合已有 factory。新建 Proxy 只在 `setText/addToHistory` 解码严格 v1 协议，其他方法绑定到底层 editor；callback、focus、属性赋值继续委托。没有替换已有实例的方法或原型。
- 安装放在 `resources_discover`。Pi 在所有 `session_start` handlers 之后发出该事件，因此 CodexEditor 的 session_start 安装不受扩展加载先后影响。没有 timer、微任务抢时序或私有宿主调用。
- 无自定义 factory 时创建公开 `CustomEditor`，保留默认的 `embedWorkingStatus: true`。padding 和 autocomplete 可见项数仍由宿主 setter 复制。
- 自有 factory 与返回的适配器带版本化 Symbol 标记，重复 discovery 不替换 editor，也不嵌套适配。方法绑定缓存按属性保存，不随按键次数增长。
- `index.ts` 原有请求 UUID、message 对象 start/end 关联、活动 leaf 索引继续负责展示。恢复不读取 skill 文件，不追加历史卡片，不处理模型 context。

## Versions and source verification

实际版本为 Node.js `22.22.2`、pnpm `11.9.0`、Pi `0.86.0`。Context7 `/earendil-works/pi` 只返回 main 文档，没有目标版本专属结果，因此版本行为以安装源码与真实执行为准。

本轮完整阅读 Pi 的 `extensions.md`、`tui.md`、`sdk.md`、`session-format.md`、`skills.md`、`sessions.md`、`compaction.md`、`keybindings.md`，以及 `modal-editor.ts`、SDK `06-extensions.ts` / `11-sessions.ts`、`custom-compaction.ts` 示例。核验公开 EditorComponent 类型、InteractiveMode setter、AgentSession 的 bind/reload/message 持久化顺序和 SessionManager 写盘实现。

固定来源为官方 commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`：

- [editor composition 文档](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/extensions.md)
- [AgentSession](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts)
- [InteractiveMode](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts)
- [SessionManager](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/session-manager.ts)
- [AgentSessionRuntime](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session-runtime.ts)

安装 source map 的原始源码 SHA-256：

| File | SHA-256 |
| --- | --- |
| agent-session.ts | `3ea88a751cd830db66ae9348be9f8dfbd5218a01e74b445f3aee9fb87ad3e865` |
| interactive-mode.ts | `01ebf39a2ce0b8939076fbd5cc78e9cad6f49f642a608cd3b2adb8d215e6c0f0` |
| session-manager.ts | `860b01d430633431591393e7d14c2cafff792c1c1c374ce18067e0a7e3f59357` |
| agent-session-runtime.ts | `5b348a4db837a2564367dd93b343c67f3b0c28a2f753ff71adcb48d08b5644e7` |

前两项与 #8 已核验值一致；后两项本轮用 `gh api repos/earendil-works/pi/contents/...?...ref=ecac0a9...` 获取官方原文，解码后散列与安装包完全一致。

## TDD and verification

[Red 日志](skill-history-editor-red.log)证明原生与 CodexEditor 的已有产品均把 v1 封装暴露在历史草稿中。加入适配后通过。随后安装顺序、重复 discovery、回调、原生历史和补全用例直接通过，没有为制造 Red 改坏既有行为。

新生命周期测试调用产品入口，不使用规划实验的解析器或 renderer。夹具使用真实 DefaultResourceLoader、AgentSession、AgentSessionRuntime、SessionManager、磁盘 JSONL、官方离线 faux provider，以及实际 InteractiveMode editor/transcript 方法。终端宿主和无关 footer 为替代对象，不是 PTY。

[正式测试日志](skill-history-tests.log)为 9 个文件、112 项通过，比 #8 新增 23 项：

| File | New tests | Coverage |
| --- | --- | --- |
| history-editor.test.ts | 6 | 原生/CodexEditor 的 setText、addToHistory、submit/change、Escape、Ctrl+D、paste callback、app action、extension shortcut、focus、美元与 slash 补全；普通 JSON、未知版本和原生 slash 历史不解码；两种安装顺序及重复 discovery |
| lifecycle.test.ts | 15 | 真实 steer/followUp、同文多条图片关联、消费时文件变化、队列清除、排队后删除文件、错误/中止响应、重复 reload、resume、新建与 fork/clone、tree 原文回填、压缩、JSONL 中断/写入失败及缺卡 |
| visibility.test.ts | 2 | 10/100 张卡片下的活动历史扫描次数、leaf 变更后隐藏孤立卡片、shutdown 清理 |

关键断言：

- 同一批两个完全相同的 `$alpha $beta $alpha` 请求，队列仍保存原文。文件在等待期间更新后，两条 user 都携带消费版本；UUID 不同、图片分别对应，live 顺序为 `D1 U1 D2 U2`，JSONL user 与模型实际请求逐项相同。
- 原生及 CodexEditor 两种安装顺序各做三次实际 `session.reload()`。草稿保留，autocomplete wrapper 数始终为 1，渲染已有快照不露封装。再经 runtime new/resume，真实 `renderInitialMessages()` 添加的历史项仍是原文。
- `session.navigateTree(userId)` 确实移到 user 的 parent，回填持久化封装通过产品 editor 还原。目标 user 尚不在活动分支时其卡片隐藏；替代分支请求不含旧分支快照。真实 runtime fork-before 与 clone-at 分别验证孤立卡片隐藏和已完成快照/图片保留。
- 两个压缩用例通过公开 `session_before_compact` 提供固定摘要，再实际调用 `session.compact()`。只截掉卡片时 user 快照仍到模型；user 被摘要覆盖时旧全文不再出现。reload 不补 entry，源文件删除不影响结果。

测试开发中还修正了两类夹具问题：ESM namespace 不能直接 spy，改为只代理 `fs/promises.readFile` 的测试 mock 并委托真实 I/O；缺失的宿主 footer plumbing 补为 inert fixture。它们不算行为 Red。tree 导航本身不写入磁盘位置，恢复目标以最后持久化 leaf 为准；测试在目标分支追加原生 label 后再验证 resume，不把它误判成产品串分支。

## Persistence failure boundaries

本功能不增加 Pi 之外的 WAL、事务或 JSONL 修复：

- 首条 assistant 前，Pi 只保存内存 entries，不创建 JSONL。正式测试确认这一边界，随后用 provider error/aborted 的终态 assistant 触发原生落盘，再 resume 验证快照。首次回复前进程直接退出不具备额外持久化保证。
- 中断测试在真实产品 `entry_appended` 事件读取已落盘前缀，将该前缀加一条截断 user 行写成独立 JSONL。runtime 恢复后只有孤立展示，没有有效 user，卡片隐藏，后续模型请求不包含其正文。这是可重复的中断文件模拟，没有强杀真实 Pi 进程。
- 写入失败测试临时把已存在 JSONL 路径替换成目录，使产品展示 entry 的实际 append 抛出 `EISDIR`，随后在 user 持久化前恢复文件。Pi 报一次 extension error；同一 user 快照仍送到模型并落盘。重新打开磁盘后没有展示卡片，也不补写。
- Pi 的 `_appendEntry` 在持久化前先推进内存 leaf。上述展示写入失败可留下磁盘 user 指向缺失 parent 的历史链，旧祖先不保证仍进入活动上下文；插件不篡改或修复 Pi 的存储。测试只证明该 user 快照保留和不补卡，不宣称通用文件系统故障后的完整历史恢复。

## Performance

- 队列测试断言消费前 skill 读取次数为 0，两个请求各两个不同 skill，总共读取 4 次。重复引用没有重复读取。
- reload/resume/fork/压缩测试删除源文件并监测真实读取调用，目标 skill 路径读取次数为 0。恢复前后 entries 数量或 JSONL 内容不变，不存在隐式补卡。
- 活动索引用 10/100 张卡片分别重复渲染三轮，同一 leaf 仅一次 `buildContextEntries`；branch 后只增加一次。避免为每张卡扫描整段历史。索引构建成本按活动历史总量增长，缓存仅存 requestId。
- 重复 discovery 十次不重建 editor，factory、实例与绑定方法引用保持不变。这里验证确定性成本，不以本机耗时设产品性能承诺。

## Repository checks

```bash
pnpm exec vitest run extensions/skill-mentions/__tests__
pnpm exec tsc -p extensions/skill-mentions/tsconfig.json --noEmit
pnpm exec tsc --noEmit --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node extensions/skill-mentions/__tests__/*.test.ts
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH -u PI_SUBAGENT -u PI_SUBAGENT_ID pnpm run check
pnpm run build
pnpm run package:check
```

| Check | Result |
| --- | --- |
| 本功能正式测试 | 112/112 通过，无 skip |
| 本功能源码与测试独立 tsc | 通过 |
| [全仓 check](skill-history-check.log) | typecheck 通过，2065 passed / 5 skipped；1 个既有 MCP suite 收集失败 |
| [build](skill-history-build.log) | 通过 |
| [package:check](skill-history-package-check.log) | 既有 `docs/goal-descendant-acceptance.md` 缺失，失败 |
| git diff --check | 通过 |

MCP 缺失仍为 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`。没有排除测试或补造文件，不能称全仓 check 或发布检查通过。全仓测试比 #8 的 2042 passed 增加 23 项，无新增失败。

## Cleanup and deferred verification

测试临时目录位于 worktree 的 `extensions/skill-mentions/__tests__/.lifecycle-*`，均已删除。初次夹具失败留下的两个目录也已清理。没有启动后台服务或监听端口，没有真实模型请求，没有修改全局 Pi。

#10 仍需验收真实 PTY、中文输入、自定义快捷键配置、完整 codex-ui 和仓库扩展组合、可安装产物与完整 Spec。本关使用真实 CodexEditor 及其 session_start factory 安装方式，但不冒充完整 codex-ui 启动验收。任意第三方在后续事件主动覆盖 editor factory 不在本次组合证据内；没有拦截或补丁化 setter 来争抢 editor。

本关没有规格偏离。文件系统失败边界如上，交协调者核对，不能据此承诺 Pi 本身没有的存储事务能力。
