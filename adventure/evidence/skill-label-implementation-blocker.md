# Skill label implementation blocker

## Status

[Implementation #15](https://github.com/wangxuyang1221/pi-ext/issues/15)未完成。本轮保存公开API核验、失败负载及正式边界测试，没有修改产品`src/`，没有交付标签或图标命令。完整要求仍以[Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)为准，未删减六字段切片。

接手HEAD为`0005bc8cedd3200de5b753b1385b4cdee2b5060d`，产品基准为`d8a6a40d05e7cf3db63b553520bb2717453c04a0`。工作分支为`adventure/skill-mentions`。新增产品文案英文的确认有效，不存在语言阻塞。

输入核心停在生产动作策略。现有已验证的逐字原生删除虽然能保留粘贴，但不满足本关成本约束；按词删除替代会改变kill ring；补全替代能低成本修改范围，但引入异步删除与提交竞态。需要协调者安排Planning继续收敛该策略，建议回到#12。以下证据不是“所有公开API组合绝对不可能”的证明，也不能据此直接放宽时序、kill ring或大粘贴要求。

## Changes

- `extensions/skill-mentions/__tests__/label-api-boundaries.test.ts`新增11项正式边界测试。测试断言候选策略的真实限制，不将限制当作标签功能验收通过。
- `extensions/skill-mentions/__tests__/label-editing-api-audit.mjs`新增独立成本审计。默认输出结果；`--assert-contract`保留失败退出，用于阻止把逐字删除迁为正式实现。未更改仓库vitest配置、原有测试、skip或检查门槛。
- 本报告及日志保存失败依据。执行计划仅在#15正文Execution，不另存计划文件。
- `dist/`仅由原有build生成；没有手改，也没有新的产品行为差异。未改Map、Spec、progress、Issue Acceptance或任何其他关卡。

## Public API audit

Pi 0.86.0公开`getText/getExpandedText/getCursor`、`setText`、`insertTextAtCursor`、`handleInput/handleMouse`、`render`和autocomplete provider安装。范围替换、游标setter、undo事务和kill ring读写未公开。`Editor`的相关状态及操作在声明中为private。

| Candidate | Actual result | Contract consequence |
| --- | --- | --- |
| 逐字Backspace/Delete，加包装层分组undo | 每字符调用`pushUndoSnapshot`，`UndoStack.push`使用`structuredClone`，拷贝整个paste注册表 | 包装层可合并用户的undo按键，但不能消除已经产生的正文副本；10 MiB/64字符负载超预算 |
| `setText`直接拼接删除范围 | 折叠标记留下，`getExpandedText`变为标记字面量；一次undo可恢复原状态 | 删除后的草稿已错误，不能靠之后undo修复其提交语义；此路线仍禁用 |
| 按词删除再删`$` | 两步能删除`$alpha`，但Ctrl+Y得到`alpha`，不是删除标签前保存的`keep` | Backspace被替换成kill动作，污染用户kill ring；没有公开ring读写入口用于直接恢复 |
| 临时autocomplete provider的单项强制补全 | 一次原生快照即可范围替换，paste、undo及原有kill ring保留 | 它不是同步编辑动作；Tab返回时原文和onChange都未变化，紧接Enter会提交未删标签的原文 |
| 仅插入、历史回填或提交重置 | 插入不能删除；回填/提交不提供保留现有paste、历史和undo的范围事务 | 不能直接替代原子删除 |

补全方案不是已证明不可用。正式测试证明它有一个有界替代能力，也证明不能直接充当同步Backspace。若继续此方案，须解决输入事件排队、宿主同步读取、回调时机、取消、旧补全请求及外部编辑器的组合；不能只等一个microtask后观察结果就称已满足原生契约。本轮没有把异步动作、shadow buffer或另建kill ring偷偷加入产品设计。

未把frame字符串识别搬入代码，也没有继续实现依赖未定动作策略的布局、鼠标或菜单适配。

## Cost evidence

测量前在#15 Execution约定：单次整体编辑不能按名称字符数深拷贝整个草稿/paste注册表；10 MiB折叠粘贴的额外heap/RSS预算128 MiB。依据是常数份10 MiB正文快照、临时字符串及布局副本应在该预算内，而不是根据首次结果倒推门槛。100 KiB草稿的既定100 ms同步预算保留。

运行环境为Apple M5、Node22.22.2、darwin arm64。审计使用真正的Pi Editor和#14构建解析器，未使用探针解析器、假undo栈、私有字段、实例/原型补丁。负载先经bracketed paste折叠，再通过公开插入在旁边添加`$`、名称和句点。解析器确认可见引用有效，然后逐字删除。

| Paste | Name length | Samples | Delete time | Extra peak heap | Extra peak RSS | Native undo steps |
| --- | --- | --- | --- | --- | --- | --- |
| 1 MiB | 16 | 5次预热，20次采样 | 中位1.77 ms，最大1.94 ms | 17.05 MiB | 17.36 MiB | 17 |
| 1 MiB | 64 | 5次预热，20次采样 | 中位8.27 ms，最大8.56 ms | 65.17 MiB | 66.05 MiB | 65 |
| 10 MiB | 64 | 首次即超预算，停止后续采样 | 单次70.81 ms | 650.18 MiB | 651.25 MiB | 65 |

10 MiB组进程峰值RSS约753.11 MiB。这里失败的是空间增长，不谎称70.81 ms超过100 ms。64字符名称已经足以复现，不需要把名称扩大到256/1024或分配数GiB来制造OOM。预算失败后，计划中的更大名称/多标签/完整布局性能矩阵未执行。

审计每次在删除前执行GC，逐动作观察heap/RSS，删除后用公开undo键逐次恢复，核对完整展开原文。GC及恢复操作不计入删除耗时。1 MiB组的增长与原生快照数一致；读取源码确认每步深拷贝而非仅保存差异。

[首次失败](skill-label-editing-api-red.log)和[最终失败](skill-label-editing-api-final-red.log)均保留。最终命令退出1，`contractSatisfied: false`。包装层将65次undo合成一次用户操作能修正交互步数，但不能修正650 MiB分配，因此不是Green。

## Body identity finding

正文当前在`message_start`用原文构造，`message_end`不会更新现有user组件；Markdown transformer参数也没有requestId。但不能据此断言正文方案不可行。

本机公开`registerMarkdownTransformer`允许替换本扩展的transformer，宿主为每个user组件捕获当时的函数数组。新增测试在每个`message_start`注册独立闭包，在`message_end`恢复普通transformer。两条完全相同的任务，等两个请求均结束后才渲染，仍分别显示各自标识；invalidate/宽度变化保持，历史重建不沿用旧live闭包。无按任务文本找消息，也没有积累无限注册列表。

这提供了后续按pending快照/requestId捕获live展示的实现依据，不改变现有v1协议。测试只是身份通道核验，未实现成功快照着色、图标偏好、分支/压缩的完整产品矩阵。当前不以正文参数缺字段为由要求重开#7。

## Verification

```bash
pnpm exec vitest run extensions/skill-mentions/__tests__/label-api-boundaries.test.ts
pnpm exec vitest run extensions/skill-mentions/__tests__
pnpm exec tsc --noEmit --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node extensions/skill-mentions/__tests__/*.ts
pnpm exec node extensions/skill-mentions/__tests__/label-editing-api-audit.mjs --assert-contract
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH -u PI_SUBAGENT -u PI_SUBAGENT_ID TMPDIR="$PWD/.tmp/skill-label-check" pnpm run check
pnpm run build
pnpm run package:check
```

复跑前创建本worktree内的临时目录，结束后删除。本轮四项PI_SUBAGENT标记只在全仓检查子进程中清除，没有修改全局环境。

| Check | Result |
| --- | --- |
| [边界测试](skill-label-api-boundaries-final.log) | 11/11通过，原生/Codex共10项输入候选限制，另1项真实SDK身份通道 |
| [本功能正式测试](skill-label-final-tests.log) | 11文件291/291通过；280项既有测试加11项边界核验；不代表标签验收通过 |
| [正式测试独立tsc](skill-label-test-types.log) | 退出0 |
| [全仓check](skill-label-final-check.log) | typecheck通过；2244 passed/5 skipped；一个既有MCP suite失败，后续build/package被短路 |
| [独立build](skill-label-build.log) | 退出0 |
| [独立package:check](skill-label-package-check.log) | 失败，仍缺`docs/goal-descendant-acceptance.md` |
| [构建入口import](skill-label-built-entry.log) | 成功，只验证构建入口可导入，不冒充安装或CLI验收 |
| 成本审计目标断言 | 退出1，未修复，见Cost evidence |
| `git diff --check` | 通过 |

MCP失败仍为`prototypes/mcp-status-ui-prototype/src/codex-startup.js`缺失，没有新增全仓功能失败。没有修复18个无关缺文件。初次新增测试的inert Theme类型断言缺少`unknown`中转导致独立tsc失败，已修复；[原始日志](skill-label-test-types-fixture-failure.log)保留，不计为产品行为Red。

本轮没有新PTY或物理IME验证。输入API测试使用实际Editor/CustomEditor/CodexEditor配inert TUI；身份测试使用真实AgentSession/runtime、公开扩展注册及实际user组件，终端是fixture。未把这些测试描述为实际CLI安装、真实resize或鼠标输入。

## Spec coverage

| #15 obligation | This delivery |
| --- | --- |
| 各来源成标、严格#14边界 | 产品未实现；反例引用由#14正式解析器核验有效 |
| 两宿主、两图标、颜色/正常字重/无背景 | 未实现、未验收 |
| 整体左右/删除/undo，连续undo及折叠粘贴 | 只完成候选动作边界及成本核验；生产策略受阻 |
| 跨行完整名、宽窄窗口、真实resize、上下/鼠标/视口/菜单 | 未实现、未验收 |
| 自定义按键、kill ring、外部编辑器、重复文本 | 只核验默认键下kill ring污染和补全删除的同步提交竞态；完整矩阵未执行 |
| 模型/历史/队列/外部编辑器无视觉污染 | 产品未改，旧280项回归通过；不等于新增视觉层已验收 |
| 成功快照正文、同文不同快照、队列/恢复/分支/压缩 | 只验证live函数身份通道；标签产品矩阵未实现 |
| 资源更新、重复安装/reload、原生/Codex回调、旧slash/卡片 | 既有回归通过；未运行新增标签层组合验收 |
| cube/command命令、持久偏好、非法参数、读写故障 | 未实现、未验收，英文产品文案授权保留 |
| 长名称/多标签/大粘贴的时间和内存 | 已测上述三组；更大矩阵因明确预算失败停止，不记完成 |

## Sources

Context7解析到`/earendil-works/pi`，查询CustomEditor、EditorComponent及公开动作组合，只返回main，没有0.86.0版本结果。版本依据使用本机0.86.0声明、源码及执行，再用GitHub固定commit核验。

完整读取本机`extensions.md`、`tui.md`、`keybindings.md`、`terminal-setup.md`、`session-format.md`、`sdk.md`、`skills.md`、`packages.md`、`environment-variables.md`，以及`modal-editor.ts`、`github-issue-autocomplete.ts`、SDK`06-extensions.ts`示例。核对Editor、UndoStack、loader/runner、InteractiveMode和user/Markdown组件实现。

[来源散列记录](skill-label-api-source-audit.json)包含6个文件。installed source map的源码与官方commit`ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`逐项SHA-256相同，包括：

- [Editor](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/components/editor.ts)
- [UndoStack](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/undo-stack.ts)
- [Extension loader](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/extensions/loader.ts)
- [User message](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/components/user-message.ts)

## Cleanup and continuation

成本审计通过同步spawn/wait回收子进程。最终PID22012、22112、22276均退出0，审计逐项检查`kill(pid, 0)`得到ESRCH；后续lsof未发现这些PID的TCP listener。未启动本任务持久服务，也没有新PTY进程。全仓检查使用原有离线测试fixture，不调用真实远端provider、真实MCP或子代理任务。

本轮`.tmp/skill-label-check`和测试临时目录已清理；保留`.tmp/skill-ui-prototype-GG4yw8`。未改全局Pi、终端、字体或安装配置，未删除worktree。没有创建PR、合并、部署或推进#16。

下一步由协调者核对反例，安排#12或相应Planning收敛同步、有界且不破坏native paste/undo/kill ring的编辑策略。若认为异步补全可通过另一层组合保持既有宿主时序，先证明即时提交/同步读取、取消、外部编辑器和补全共存，再继续本关。其余#15范围仍保留，不能把此次边界核验当作Implementation验收。
