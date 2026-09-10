# Pi goal retry cancellation observation

## Decision after research

用户在了解本报告提出的编辑器实例重建后回复“没必要”；主代理再次明确询问是否接受重试等待中 Esc 停止后记为 blocked、可用 `/goal resume` 恢复，用户回复“yep”。C12 因此确认：不采用编辑器接入，不改上游，仅接受该窄状态差异。以下研究结论与实验作为历史证据保留，不再作为待实施的编辑器方案。

## Conclusion

**不能再说 Esc→paused 必须修改上游 Pi。** 在 Pi 0.84.3 与 0.85.1，使用公开 editor factory 和 `CustomEditor.onEscape` 回调组合，已经能在真实 TUI 中观测主编辑器发起的中断，并证实原生重试确实取消。确认弹窗、选择器和自动补全的 Esc 不触发该回调。前提是允许重新实例化并组合编辑器，且编辑器遵循已核验的原生中断路由。[E1][S3a][S3b][S4a][S4b]

这不是一个通用的“重试已经取消”事件。原型实际证实两个反例：其他编辑器可以吞掉 `onEscape` 而不取消重试；后加载的编辑器可以覆盖观察器。因此，不能把任意编辑器回调调用直接当作取消成功。[E1]

若要求完全不接触编辑器、兼容任意其他编辑器，并直接得到有语义的取消原因，当前普通 ExtensionAPI 没有对应的公开通知。新增上游事件是这组严格条件下推荐的稳定方案；本研究没有证明所有公开接口组合在逻辑上都不可能。[S1a][S1b][S2a][S2b]

本轮只调研和隔离验证，没有修改 `extensions/goal` 产品源码或正式测试，没有修复其 Esc→blocked Red，也没有获得编辑器接入授权。前次失败结论仍适用于原产品实现，不能用本次观察原型的 Green 宣称 #6 已通过。[E0][E1]

## Scope and source pinning

| Item | Verified value |
| --- | --- |
| Pi 0.84.3 | 官方 tag `v0.84.3` → commit `4e58f324fae8ebfa98a3d45181fb248072a2afac` |
| Pi 0.85.1 | 官方 tag `v0.85.1` → commit `d981de1229ef899957bbe968bc8dcda02a21f477` |
| Runtime | Node.js 22.22.2，真实 `InteractiveMode` 与 PTY，免费 faux provider |
| Existing code | `f4a7e44` 加既有 #4/#5/#6 WIP，全部保留 |

先查询 Context7 `/earendil-works/pi`。返回的是 main 的官方 editor composition 文档，只用于定位 API，不充当固定版本依据。随后按两版本 tag 读取官方源码，并与已安装包的 source map `sourcesContent` 比较。`types.ts`、`runner.ts`、`agent-session.ts`、`interactive-mode.ts`、`custom-editor.ts`、`keybindings.ts` 共 12 份文件逐字一致，SHA256 保存在 `source-verification.json`。[S0a][S0b][E1]

沿用前轮全文阅读的相关 Pi extensions、SDK、TUI、compaction、sessions 文档，本轮补读完整 keybindings 文档并核验固定版本源码。下列 API 结论引用固定提交，而不是 main。[S5a][S5b][S6a][S6b]

## Observation without editor changes

### Ordinary extension events

两版本 `agent_end` 只有 messages；`agent_settled` 只有事件类型，没有 retry outcome。原生 `AgentSession` 确有 `auto_retry_start/end`，但它们不在这两版 ExtensionAPI 的可注册事件契约中。原生重试取消时发出的 `auto_retry_end` 含 `success:false`、`finalError:"Retry cancelled"`，耗尽则发最终模型错误；该区别在宿主 SDK 层存在，未公开给普通扩展。[S1a][S1b][S2a][S2b]

`ctx.signal` 是当前 agent run 的信号，不是 retry sleep 的 `_retryAbortController.signal`。前次双版本真实实验已证明：重试等待中，真实中断与关闭另一个扩展弹窗时，原始 Escape 前后均可能是 signal undefined、isIdle false。根据原始按键或即时 idle 值判断取消会误判。[E0][S2a][S2b][S7a][S7b]

`onTerminalInput` 是输入拦截器，不是按键经焦点组件处理后的语义结果。`registerShortcut` 也不能作为透明的原生 interrupt 观察器：`app.interrupt` 被列为受保护的内置冲突项，冲突扩展快捷键会被跳过。另设快捷键并主动 abort 会改变用户操作和取消来源，不是本题要求的观测。[S7a][S7b][S6a][S6b]

### Version-specific UI prompt events

0.85.1 新增 `ui_prompt_start/end`，0.84.3 没有。runner 为扩展的 `select/confirm/input/editor/custom` 包装提示生命周期，嵌套时报告最外层提示。本轮真实确认弹窗在 0.85.1 收到了 kind=confirm 的这两个事件。[S1b][S7b][E1]

它们能帮助排除部分弹窗场景，但不是 retry cancel 通知，也没有为所有内置选择器、主编辑器自动补全提供统一结果。不能把“0.85.1 有提示事件”推导为双版本无需编辑器就已解决取消识别。[S3b][S7b]

## Public editor composition

### Tested mechanism

固定版本文档明确支持 `getEditorComponent()` 后组合 `setEditorComponent()`。前者返回 factory，不返回当前编辑器实例。后者同步调用 factory 创建组件，然后为符合 `CustomEditor` 形状且尚无 `onEscape` 的组件安装转发回调。该回调每次调用时访问宿主当前的 `defaultEditor.onEscape`，因此会跟随原生重试期间的临时处理器，而不是永远指向启动时的默认处理器。[S5a][S5b][S3a][S3b]

最小诊断采用普通公开属性赋值，不使用私有成员、属性描述符拦截或定时轮询：

```typescript
const previous = ctx.ui.getEditorComponent();
let editor;
ctx.ui.setEditorComponent((tui, theme, keys) => {
  editor = previous?.(tui, theme, keys) ?? new CustomEditor(tui, theme, keys);
  return editor;
});
const delegate = editor.onEscape;
editor.onEscape = () => {
  recordInterruptInvocation();
  delegate.call(editor);
};
```

代码仅说明观测机制，不是可直接接入的完整 goal 实现。它依赖两版已核验的同步 factory 安装行为；未来版本须重新核验。原型会记录 factory 返回前是否已有自定义 handler，用于展示自定义回调反例，而不是无条件保证所有返回组件均可信。[E1][S3a][S3b]

`CustomEditor.handleInput` 使用注入的 keybindings manager 匹配 `app.interrupt`。自动补全打开时先交给父编辑器关闭补全，不调用 onEscape。真正到达 onEscape 时，原生重试处理器调用 `session.abortRetry()`。扩展确认/选择器占有焦点时，主编辑器也不会收到这次输入。[S4a][S4b][S3a][S3b]

### Invocation versus cancellation

诊断分开记录两类证据：

1. 公开扩展侧的 `interrupt_callback` 与 `interrupt_delegated`。
2. 测试宿主通过公开 SDK `session.subscribe` 记录的原生 `auto_retry_end`，检查是否真有 `finalError:"Retry cancelled"`。

第二类只是实验的独立判据。普通产品扩展不能偷偷取得宿主 session 来使用这个 subscriber。原型既没有自行调用 abort，也没有把 goal 改为 paused；未修改的产品在取消后仍是 blocked。[E1]

在默认与当前 codex-ui 路由下，调用原回调与真实取消一致；在自定义 no-op onEscape 的反例中，callback=1 但 cancelled=0，原生重试继续成功。因此这是对已知路由的有效观测，不是能验证任意 callback 副作用的通用 API。[E1]

## Real TUI evidence

夹具在 `prototypes/goal-retry-cancel-probe/{probe.mjs,driver.py}`。没有改动已有 `execution-tui` 正式夹具。原始结果、ANSI、事件、真实会话与源码快照保存在 `.scratch/goal-retry-cancel-research/`。`results.json` 汇总全部进程；`direct-*` 为最终普通属性赋值方案的 22 项主矩阵。[E1]

下表每行在两个版本各执行一次，均按对应预期通过。次数是主矩阵每个场景的实际观测，不是产品状态验收。

| Scenario | Callback / real retry cancellation | Model calls | Result |
| --- | --- | --- | --- |
| 默认编辑器组合，重试等待中 Esc | 1 / 1 | 1 | 观测到并确实取消 |
| 默认组合，确认弹窗 Esc | 0 / 0 | 3 | 弹窗 false，继续重试并 complete |
| 先加载当前 codex-ui，再组合，重试 Esc | 1 / 1 | 1 | 保留 CodexEditor 类后观测成功 |
| codex-ui 组合，确认弹窗 Esc | 0 / 0 | 3 | 不误判为中断 |
| 自定义 onEscape 吞掉输入 | 1 / 0 | 3 | 证实调用不等于取消 |
| 观察器之后再加载 codex-ui | 0 / 1 | 1 | 证实后加载的未组合 factory 会覆盖观察器 |
| 原生扩展 select 选择器 Esc | 0 / 0 | 3 | 取消选择，不中断重试 |
| 主编辑器实际显示自动补全后 Esc | 0 / 0 | 3 | 关闭补全，不中断重试 |
| 仓库隔离 keybindings 将 interrupt 改为 Ctrl+X | 1 / 1 | 1 | 按 action 路由，不依赖字面 Escape |
| 空闲时 `/reload` 后创建 goal，再重试 Esc | 1 / 1 | 1 | 安装恢复，无重复 callback |
| 空闲时 `/new` 后创建 goal，再重试 Esc | 1 / 1 | 1 | 新会话安装恢复，无重复 callback |

此外进行了两次精简后的 smoke 和两次 UI prompt 版本对照。最早的 22 次属性描述符探索也保留为历史，但推荐的最终方案不需要属性描述符。48 个 PTY 子进程均退出 0；所有实际场景 networkAttempts=0。[E1]

复现示例，输出目录必须是尚未使用的新目录：

```bash
conda run -n codex-py312 python prototypes/goal-retry-cancel-probe/driver.py .scratch/retry-observe-fresh node_modules/@earendil-works/pi-coding-agent
GOAL_TUI_SCENARIO=retry-dialog conda run -n codex-py312 python prototypes/goal-retry-cancel-probe/driver.py .scratch/retry-dialog-fresh node_modules/@earendil-works/pi-coding-agent
GOAL_PROBE_EDITOR=codex-ui conda run -n codex-py312 python prototypes/goal-retry-cancel-probe/driver.py .scratch/retry-codex-fresh node_modules/@earendil-works/pi-coding-agent
```

0.85.1 将最后参数换成已安装 0.85.1 包路径。fixture 中 goal/codex-ui 是当前仓库编译产物，codex-ui 的静态依赖仍按仓库 Node resolution 解析；真实宿主及默认 CustomEditor 取自传入版本。这验证的是现有代码与两版宿主的中断路由，不是所有安装布局或视觉兼容性。[E1]

## Editor and lifecycle boundaries

### Default editor

此方案会创建新实例，不是在原默认实例上无损添加一个监听器。宿主复制文本、部分外观设置和 autocomplete provider，但没有通用接口迁移任意编辑器的全部内部状态。不能宣称 undo、光标、粘贴扩展状态和其他自定义状态都零影响。仅在明确安全的安装时机应用，并把实例重建作为待批准动作。[S3a][S3b]

0.85.1 的默认编辑器还新增 `embedWorkingStatus:true`，而直接 `new CustomEditor(...)` 的选项默认是 false。该差异会影响 working status 的呈现位置。观察原型没有修复这个视觉差异，因此不能宣称其默认编辑器完全保真；产品若获准接入，必须按版本保持原生行为。[S4b][S3b]

### Current codex-ui and other editors

当前仓库 `CodexEditor` 继承 `CustomEditor`，只定制 render，没有自有 onEscape 或 handleInput，所以先取得它的 factory 再重建同类组件可以保留其输入路由。当前 codex-ui 的 `session_start` 则直接设置 factory，不自动组合更早的 factory，加载顺序反例与源码一致。[L1][L2][E1]

不能泛化到任意其他编辑器。它们可能拥有自有 onEscape、覆写 handleInput、不继承 CustomEditor、保留不能复制的状态，或后来再次替换 factory。产品需要明确的兼容契约与失配反馈，不能静默把所有 callback 视为真实中断。[E1][S3a][S4a]

### Prompts, keybindings, and session lifetime

主矩阵已验证确认、扩展 select、真实自动补全，以及自定义 `app.interrupt` 绑定。没有覆盖所有内置选择器、任意 custom overlay、嵌套弹窗或其他扩展覆写输入路由。不能用这几个 Green 声称全部焦点场景通过。[E1]

两版本会在 extension UI reset 时恢复默认 editor factory，原型的 session_start 安装可在空闲 reload/new 后恢复。测试没有覆盖重试进行中 reload、切换已有会话、过期 callback 延迟写 goal，或失效自有续跑内部取消与真实用户中断的竞态。未来产品仍必须先按 ownerSessionId/goalId/generation 检查身份，并在 authoritative commit 中暂停，不可把本原型的全局计数器直接移植。[S3a][S3b][E1]

## Alternatives and classification

| Approach | Classification | Assessment |
| --- | --- | --- |
| 公开 factory + 公开 onEscape 组合 | 纯公开扩展接口，对固定版本同步安装行为有源码依据 | 已证支持限定编辑器；要用户批准实例重建和兼容边界 |
| 原始按键 + signal/idle/延迟计时推断 | 公开 API，但只是间接推断 | 前次反例已证不足；增加时间阈值不能证明取消原因 |
| 0.85.1 UI prompt 事件辅助 | 公开版本特定接口 | 可识别部分提示生命周期；不能替代取消语义，0.84.3 无此项 |
| `session.subscribe(auto_retry_end)` | 公开 SDK 宿主 API，不是普通扩展 API | 可以在自定义宿主实现，但不满足本项目标准扩展约束 |
| 读取 private session/defaultEditor/retry controller、替换宿主方法 | 私有成员或宿主运行时补丁 | 未使用，不推荐 |
| 解析终端错误文字、在 provider 层猜测取消 | 取巧或不相关层级 | retry sleep 没有新 provider 请求；不能当取消契约 |

还存在一个应诚实列出的研究方向：公开 TUI 有 `getFocusedComponent()`，而 `ctx.ui.custom` factory 能取得 TUI。理论上可通过一个临时 UI 获取当前焦点组件，再修改其公开输入方法，避免重建 editor 实例。可是焦点组件不保证就是主 editor，临时 UI 会改变焦点/容器，默认 editor 的 onEscape 又会被原生重试处理器动态重设。这属于通过通用 UI 入口取得组件后做运行时方法补丁，不是已有专用只读中断监听接口。本轮未验证，不推荐将其当成“无需边界批准”的绕行，也不据此作不可能证明。[S8a][S8b][S3a][S3b]

## Recommended decision

优先请用户确认以下最小边界，而不是先要求修改 Pi：

1. 允许在安全的 session_start 安装时机，通过公开 factory 重建并组合当前受支持编辑器；不更换其 render 类，不修改 footer；默认编辑器需保持对应版本配置。
2. 初始保证范围为原生 CustomEditor 和当前 codex-ui 这类遵循原生中断委托的编辑器。存在自有 handler、未知组件或后续覆盖时，不得静默声称支持，应提供明确失配行为并安排适配。
3. 认可这次只是“能观察原生中断”的路线验证。产品仍需把中断与 goal 身份、权威 paused 提交、内部取消区分和完整 #6 验收接起来。

如果用户不允许上述动作，或者要求不依赖编辑器实现和加载顺序，那么建议上游新增一个扩展可订阅的取消结果通知。最小起点是把已有原生 retry start/end 生命周期公开给 ExtensionAPI，并用结构化 outcome 区分 success、exhausted、cancelled，而非让插件比较英文 `finalError`。为防止旧会话或旧轮次污染，还应有稳定 run/session 标识；若要严格区分用户主动中断与系统/扩展主动 abort，则应补 origin，或提供统一的原生 interrupt 通知。这些是建议新增能力，不是现有字段。[S1a][S1b][S2a][S2b]

最终结论是有条件的：接受受控公开编辑器组合，就不必为了这一点先改上游；要求完全无编辑器接入且获得稳定语义通知，则当前公开接口缺少该通知，上游扩展 API 是更稳妥的路径。未验证的通用 UI 取巧方案不能替代这项判断。[E1][S1a][S1b]

## Validation and cleanup

- 仅新增本篇研究报告和隔离 `prototypes/goal-retry-cancel-probe/`；prototype 与 scratch 按既有 ignore 规则保持本地，不擅改 `.gitignore`。未改 Issues、产品源码或正式测试。[E1]
- `goal-before.sha256` 与 `goal-after.sha256` 相同，覆盖 goal 全部 source 和正式 tests。所有原有 WIP 和原材料保留。[E1]
- 48 个 PTY 进程全部 waitpid 回收。PID 清单在 `pids.txt`，ps/lsof 核对无残留进程或监听。未写用户全局目录、未安装依赖、未委派、未付费、未 commit/push/deploy。[E1]
- `pnpm run check` 通过，847 passed、1 既有 skipped，类型/构建/发布包校验通过；`git diff --check` 通过。日志为本轮 `check.out`。本检查不含 PTY 研究断言，也不代表未完成的 #6 验收。[E1]

## Sources

[E0]: ../goal-execution-report.md
[E1]: ../../.scratch/goal-retry-cancel-research/
[L1]: ../../extensions/codex-ui/src/components.ts
[L2]: ../../extensions/codex-ui/src/index.ts
[S0a]: https://api.github.com/repos/earendil-works/pi/git/ref/tags/v0.84.3
[S0b]: https://api.github.com/repos/earendil-works/pi/git/ref/tags/v0.85.1
[S1a]: https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/extensions/types.ts#L729-L743
[S1b]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts#L729-L761
[S2a]: https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/agent-session.ts#L2815-L2874
[S2b]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts#L2898-L2957
[S3a]: https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/modes/interactive/interactive-mode.ts
[S3b]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/interactive-mode.ts
[S4a]: https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/modes/interactive/components/custom-editor.ts
[S4b]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/components/custom-editor.ts
[S5a]: https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/extensions.md#custom-editor
[S5b]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#custom-editor
[S6a]: https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/keybindings.ts
[S6b]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/keybindings.ts
[S7a]: https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/extensions/runner.ts
[S7b]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/runner.ts
[S8a]: https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/tui/src/tui.ts
[S8b]: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/tui/src/tui.ts
