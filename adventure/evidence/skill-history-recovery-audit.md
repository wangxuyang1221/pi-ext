# Skill history and recovery audit

## Result

#7 的加载时点已由用户选择 A：实际消费排队消息时读取 skill，随后固定本次快照。本轮新增测试证明排队期间修改的正文进入本次请求，交付后再修改文件不会改写历史快照。

后续用户接受压缩后的 UI 卡片消失，并选择 skill 正文遵循 Pi 正常压缩，不额外固定或重新注入。无需增加历史卡片修复机制。历史编辑的公开适配和完整组合仍待最终方案确认，没有修改产品。

首轮实验合计 45/45。后续按压缩决定新增两项，现为 47/47：输入 15、原生组件 5、生命周期 23、编辑器适配 4。生命周期实验独立 TypeScript 检查再次通过。

## Version and sources

仍为 Pi 0.86.0、Node.js 22.22.2、pnpm 11.9.0。Context7 返回 main 的 editor composition 文档；本轮以安装包的文档、类型和实现核验版本行为。

- [Extension editor composition](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/extensions.md)：公开 `getEditorComponent()` 配合 `setEditorComponent()` 包装已有 editor factory。
- [EditorComponent contract](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/editor-component.ts)：公开 `setText`、`addToHistory`、callbacks、autocomplete 方法。
- [InteractiveMode](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts)：`setCustomEditorComponent` 保留草稿，连接 submit/change、app handlers 和 autocomplete；历史与 tree/fork 回填经 editor 接口。
- [AgentSession](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts)：compaction 后 active context entries 可能截掉前置展示 entry，`appendEntry` 只在当前 leaf 追加。
- [前轮生命周期审计](multi-skill-lifecycle-audit.md)：实际 queue、普通恢复、tree 原始回填与提前展示顺序的已有证据。

## Snapshot timing

新增测试用真实 AgentSession 和官方 faux provider：

1. 阻塞第一条任务的离线 provider，使第二条带两个 skill 的任务进入 followUp 队列。
2. 入队后修改 alpha 的真实文件，确认队列仍显示原始输入。
3. 解除阻塞后，第二条请求包含修改后的 alpha 正文。
4. 请求结束后再次修改文件并 reload，持久化 user 仍保存第二步的快照。

这支持用户已选的消费时读取语义，不表示自动 reload skill 清单。文件内容可以在真实来源路径下更新；新出现或改名的 skill 仍受 Pi 资源发现生命周期约束。

## Clean history editing candidate

此前已实测 tree 返回的 user 文本是包含快照的完整封装。单纯 Markdown transformer 只改变 transcript 显示，不会清理 editor 回填或历史缓存。

公开 API 允许组合已有 editor factory。本轮构造一个只拦截 `setText` 和 `addToHistory` 的 EditorComponent 适配器：识别本插件完整封装后还原其中的原始任务，其余编辑方法、callbacks、focus 和属性仍交给原 editor。实验用 Proxy 返回新包装对象，没有改已有实例方法或原型。

4 项探针覆盖 native CustomEditor 与现有 CodexEditor：

- 通过实际 `InteractiveMode.setCustomEditorComponent` 宿主连接适配器，草稿从封装还原为原文。
- 历史项经 `addToHistory` 还原，按上键取回的是 `$skill` 原文。
- 原 editor 的 `setText` 函数没有被改写；同一底层 editor 通过包装对象 render 得到相同输出。
- submit/change、Escape 和 extension shortcut callback 可继续工作。
- `$` 候选 Enter 只补全，slash Tab 补全仍可用，普通文本和真正 slash 输入不会被解码。

候选的限制：

- 这比“只叠加 autocomplete provider”多一层公开 editor factory 适配。不会主动替换 CodexEditor 的样式，但需处理安装顺序与 reload，避免被后装 editor 覆盖或重复包裹。
- 测试使用实际宿主方法但替代 terminal，没有完整装载 codex-ui 与全部其他 extensions；不代表真实 PTY、输入法或所有个性化快捷键已验收。
- 测试解码器只处理固定 JSON 夹具，不是批准的产品协议；正式实现需严格识别 schema，不能随意改写用户普通 JSON。
- 实际 fork/runtime 切换、resume 历史填充、带已有草稿的 tree 回填、其他插件换 editor 的先后顺序，留待选定方案的集成验收。

## Compaction boundary

当前提前展示候选的持久化顺序是展示 entry 在 user 前：

```text
Display → User with snapshots → Assistant
```

当 compaction 的 `firstKeptEntryId` 指向这个 User 时，Display 被移出 active context，User 和快照仍保留。新增两项测试覆盖同一边界：

- 不修复：重建 transcript 后卡片消失，但 user 中两份 skill 快照仍在。
- 在公开 `session_compact` 事件里修复：可以幂等追加一个关联展示 entry，卡片重新出现；然而只能追加在当前 leaf，位于原任务正文和已保留 assistant 后面，不能还原到 user 前。

在本轮测试里，修复后的顺序是：

```text
Compaction summary → User with snapshots → Assistant → Repaired display
```

没有再次加载 skill 文件，没有新增模型消息，没有丢失 user 的快照。这里只验证当前候选的显示取舍，不声称所有纯公开 API 方案都不可能恢复原位。

## Confirmed compaction policy

用户不要求保住历史卡片，随后明确选择正文遵循 Pi 正常压缩。完整快照仍在历史记录中，不等于每次模型请求都能看到全文。此决定在 #7 维护，通关后移交 Spec。

两项追加探针验证：

- 只裁掉 Display、保留 User：禁用缺失卡片补写，删除源文件后 reload 并继续请求。卡片不再出现，模型仍得到 User 内完整的两份快照。此测试先因既有 reconcile 自动补卡而失败，增加实验开关后通过。
- User 也被摘要覆盖：reload 并继续请求后，模型拿到压缩摘要，不再拿到旧 skill 全文；历史 entries 仍保存原始快照，插件不重注入。此场景直接通过，支持候选原本即可遵循 Pi 压缩。

两项均使用离线 faux provider，摘要由夹具固定，不验证真实模型摘要质量。测试里的可选卡片修复仅用于对比旧候选，最终候选不启用此机制。编辑器适配与完整组合仍须在 #7 确认。

## Verification

- [生命周期实验](../experiments/multi-skill-lifecycle.test.ts) 23/23。
- [编辑器适配实验](../experiments/skill-history-editor.test.ts) 4/4。
- [首轮组合日志](skill-history-recovery-tests.log) 45/45；[最新组合日志](skill-compaction-policy-tests.log) 47/47。
- 上述两份实验的独立 `tsc --noEmit --target ESNext --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --skipLibCheck --esModuleInterop --types node` 检查通过。
- [最新全仓 check](skill-compaction-policy-check.log) 仍因既有 MCP prototype 文件缺失失败；类型检查与 1953 项测试通过，5 项跳过。build/package:check 未执行，不声称全仓验收通过。
- 模型、凭证与 session 均使用隔离的内存或离线 fixture；临时 skill 文件位于 worktree 并由测试清理，没有启动常驻服务。
