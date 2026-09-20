# Codex compaction incident plugin history

## Resolution

后续已修复历史转换与用户消息布局，并完成全扩展兼容性审查。当前验收结果见 [Compatibility validation](pi-0.86.0-compatibility-validation.md)。下文为修复前的提交归属和测试缺口分析。

## Scope

本文核查仓库提交 `f9a4b8d`、`2b06fd6`、`74c26a1`、`1820623`、`6fe4b30`、`d5b057d` 及相关测试。`f9a4b8d` 不在最初指定的近期提交中，但 git blame 证明关键转换缺口和严格 prefix matching 都由它引入，不能省略。

本调查没有读取给定的仓库外会话文件。会话行号、Pi 0.86.0 文件信息和新旧 converter 对照结果来自主代理提供的离线复现。仓库提交归属、源码和测试由本调查独立核验。

仓库测试依赖固定为 Pi 0.84.3，见 `package.json:142-144` 和 `pnpm-lock.yaml:159-181`。全局 installed Pi 是 0.86.0，主代理记录其文件 mtime 为 2026-09-20 10:49:25。事故会话在 10:55:25 出现新格式，时间上与全局更新吻合。

## Confirmed reproduction

主代理使用全局 Pi 0.86.0 SDK 和真实 session branch 完成离线重放。脚本与结果分别位于 `.tmp/codex-compact-incident/replay.mjs` 和 `.tmp/codex-compact-incident/replay-result.json`，上游差异记录见 [Pi 0.86.0 Compaction Compatibility Incident](codex-compaction-incident-upstream.md)。

- 会话第 494 行新增 mid-conversation system sections 和 `toolsAdded`，第 495 行是 user。Pi 0.86.0 的 `convertResponsesMessages` 先经过 `resolveTranscript`，把 `toolsAdded` 转成 `additional_tools`，并把提示更新转成 Responses `role=developer`。
- 第 495 行准备请求时，新旧 converter 都成功。此时 system transcript 仍属于本轮 tail，插件不必从已落盘 history 重建它。
- 第 496 行 assistant、第 497 行 toolResult 之后再次准备请求时，该 transcript 已进入 history prefix。当前 `messagesToResponseItems` 没有 system 分支，因此插件候选 prefix 同时缺少其工具声明和提示更新语义。
- 第 497 行的首个结构差异位于输出索引 648：Pi 0.86.0 的实际项是包含 27 个工具的 `additional_tools`，下一项是 developer；插件预期项已经是 user。
- 第 497、499、502 行状态下，Pi 0.86.0 converter 均使 `prepareRequest` 抛出 `The Codex request changed before model-transition compaction completed.`，旧 converter 成功。第 493、495 行状态下新旧 converter 均成功。
- 删除整个 system message 的控制组成功，但这会同时删除由 `toolsAdded` 生成的 `additional_tools` 和由 sections 生成的 developer 项，不能据此单独排除其中任一因素。

因此，已确认的兼容缺口是插件没有回放 Pi 0.86.0 的 system transcript 及其工具声明语义。现有证据没有把 `additional_tools` 与 developer 更新的影响彼此分离，也不应把根因缩窄成只缺一个 developer item。

## Commit history

### Commit `f9a4b8d`

`f9a4b8d` 在 2026-08-28 首次加入 codex-compact。潜在兼容问题的两端都来自这个初始实现。

第一端是 history converter 的角色覆盖不完整。当前 `messagesToResponseItems` 的主循环只处理 `user`、`assistant` 和 `toolResult`，见 `extensions/codex-compact/src/native-compaction.ts:528-650`。不存在 `system` 或 `developer` message 分支。git blame 将 user/assistant/toolResult 分支和循环框架归到 `f9a4b8d`，仓库历史中也没有任何提交加入过 `message.role === "system"` 的处理。因此，Pi session history 中的中途 system transcript 整体从插件候选 prefix 消失，包括其 sections 和 `toolsAdded` 语义。

第二端是严格 prefix matching。`requestTail` 枚举六种 history prefix，并以 `isDeepStrictEqual` 从索引 0 开始逐项比较；全部不匹配就抛出本次复现中的错误，见 `extensions/codex-compact/src/session-coordinator.ts:317-330`。git blame 同样归到 `f9a4b8d`。

`f9a4b8d` 已支持从 tool result 的 `addedToolNames` 生成 `additional_tools` 或 tool-search items。当前路径见 `extensions/codex-compact/src/native-compaction.ts:618-648`。所以不能把 `additional_tools` 支持误归到 `74c26a1`，也不能仅凭事故轮次含 `toolsAdded` 就把根因归为 tool call ID。

这个提交埋下的是兼容性缺口，但在 Pi 0.84.3 converter 不把中途 system 保留到请求 prefix 时不会暴露。

### Commit `2b06fd6`

`2b06fd6` 决定了缺口如何表现为 `compaction_failed` 后 aborted。

该提交把 `before_provider_request` 改成单次 `prepareRequest`。准备抛错后，处理器调用 `ctx.abort()`，记录 failed-request marker，并返回 `undefined`。当前实现见 `extensions/codex-compact/src/index.ts:396-445`。这正是离线复现错误到会话 aborted 的直接路径。

它还新增有效 checkpoint 上的 fail-closed 分支。`requestTail` 不匹配时，如果 checkpoint 有效，代码直接重抛，不再用 request suffix 做 context recovery，见 `extensions/codex-compact/src/session-coordinator.ts:714-735`，关键是第 724 行。对应测试位于 `extensions/codex-compact/__tests__/session-coordinator.test.ts:514-536`。

所以根因应分两层表述：

1. `f9a4b8d` 的 converter 丢失 mid-conversation system，造成 prefix 内容不一致。
2. `2b06fd6` 的 fail-closed 和主动 abort 路径把不一致变成当前事故表现。

`2b06fd6` 没有把 prefix 比较从宽松改成严格。严格比较早在 `f9a4b8d` 已存在。

### Commit `74c26a1`

`74c26a1` 修改请求生命周期、工具 wire format 恢复和跨模型 Responses 重建，但没有补 system/developer message 分支。

生命周期方面，它给正在准备的 provider request 建立独立 `AbortController`，并在 session 或 model 变化时取消旧准备。当前入口见 `extensions/codex-compact/src/index.ts:407-416`，generation、model 和 signal 检查见 `extensions/codex-compact/src/session-coordinator.ts:643-654`。`extensions/codex-compact/__tests__/request-lifecycle.test.ts` 覆盖 stale preparation 和模型切换。

这条取消路径不是本次原因。当前 catch 在原 signal 已 aborted 时直接返回，不记录新的 compaction failure，见 `extensions/codex-compact/src/index.ts:423-425`。主代理复现得到的是确定的 prefix mismatch 异常，随后才由插件主动 abort。

历史重建方面，该提交加入 `toolsWithRequestFormats`，从实际 payload、`additional_tools` 和 `tool_search_output` 恢复工具 wire format，见 `extensions/codex-compact/src/native-compaction.ts:454-468` 和 `extensions/codex-compact/src/session-coordinator.ts:685`。它还扩展 grammar tool、namespace、跨模型 ID 规范化和 deferred tool 去重，见 `extensions/codex-compact/src/native-compaction.ts:499-620`。

这些改动能从 tool result 的 `addedToolNames` 重建工具项，却仍沿用 `f9a4b8d` 的三角色主循环，不能从 system transcript 的 `toolsAdded` 重建本次首个差异项。换言之，`74c26a1` 没有引入 system 丢失，但它是最近一次大改 history parity 时遗漏 system 回放及其工具声明语义的提交。现有 parity 测试覆盖 deferred tools 和工具 ID，没有覆盖 mid-conversation system message。

### Commit `1820623`

`1820623` 只修正 deferred tool-search 的 ID 对齐和测试临时目录初始化，没有改消息角色处理或 request failure 路径。

修复后，转换器保存完整规范化 tool call ID，并统一用于 tool result 的 `call_id` 和 synthetic tool-search ID 哈希，见 `extensions/codex-compact/src/native-compaction.ts:500`、`:591-614`、`:634-644`。跨 provider 和跨 model 测试见 `extensions/codex-compact/__tests__/responses-parity.test.ts:80-94`。

该提交不是本次首个差异的来源。严格重放显示实际 prefix 先出现 `additional_tools` 和 developer，而非 deferred tool-search call ID；`1820623` 修改的 ID 对齐路径没有触及 system transcript。它仍是附近历史重建代码的相关提交，但现有证据只能排除其 tool call ID 修复，不能排除 system `toolsAdded -> additional_tools` 在事故中的作用。

### Commits `6fe4b30` and `d5b057d`

这两个 codex-ui 提交没有注册或修改 `before_provider_request`，也不写回 session message 或 provider payload。

`6fe4b30` 修复 Read/Bash 配置继承和重复 Bash ID 的显示分组。`d5b057d` 把重复 ID 标为 ambiguous，避免后来的渲染组件占用旧组件，见 `extensions/codex-ui/src/bash-groups.ts:61-79`、`:109-121`。对应测试见 `extensions/codex-ui/__tests__/grouped-bash.test.ts:115-130`、`:133-170`、`:190-217`。这里的 `toolCallId` 只是 UI grouping key。

执行配置是唯一间接变化。Read/Bash 在执行时读取配置快照，见 `extensions/codex-ui/src/tools.ts:171-172`、`:224-226`、`:340-342`；配置读取失败时阻止执行，见 `extensions/codex-ui/src/execution-settings.ts:16-30`、`:47-53`。离线复现无需配置错误或 UI 行为即可稳定触发和消除故障，因此这两个提交可排除。

## Prefix matching sequence

事故时的实际顺序如下：

1. Pi 0.86.0 把中途 system transcript 转成 provider request 中的 `additional_tools` 和 developer 项。
2. system 尚在 request tail 时，`requestTail` 可以从完整 request 切出 tail，准备成功。
3. assistant 和 tool result 落盘后，system 成为下一次请求的 history prefix。
4. 插件调用 `effectiveInputForBranch` 重建六个 prefix 候选。底层 `messagesToResponseItems` 跳过 system message及其 `toolsAdded`。
5. 真实 request prefix 在索引 648 有 `additional_tools`，随后有 developer；插件候选在该处已经是 user。`isDeepStrictEqual` 因此失败。
6. 有效 checkpoint 触发 `2b06fd6` 的 fail-closed 分支，错误上抛。
7. `before_provider_request` catch 记录 `compaction_failed`，保存 failed-request marker，调用 `ctx.abort()`。

这也解释了为何第 495 行成功，而第 497 和第 499 行失败。决定因素不是 system 首次出现，而是它从 tail 移入 history prefix。

## Failed request behavior

失败记录只保存 failed user 的 entry ID 和安全 diagnostics，不保存请求正文。下次准备时，插件从 branch 找到 marker，再从实际 user entry 恢复内容并过滤 stale failed request，见 `extensions/codex-compact/src/session-coordinator.ts:130-198`。过滤发生在 prefix matching 之前，见同文件 `:647-649`。

相关测试覆盖：

- 不持久化失败请求正文，见 `extensions/codex-compact/__tests__/session-coordinator.test.ts:142-166`。
- tool/assistant continuation 不创建 failed-user marker，见同文件 `:168-194`。
- legacy marker 继续参与过滤，见同文件 `:325-347`。
- 相同内容重复出现时删除最近的 stale occurrence，见同文件 `:367-390`。

failed-request marker 可以改变第二次 input，但本次错误不依赖 marker 才成立。第 497 行第一次失败前已经能用真实 branch 复现同一个 prefix mismatch。第 499 行重复失败说明 marker 没有补回缺失的 system item。

## Evidence and exclusions

已确认的证据：

1. 新 converter 加入的 mid-conversation system transcript 是新旧请求的决定性来源，具体输出同时包含 `additional_tools` 和 developer。
2. 第 497 行首个差异是索引 648 的 27-tool `additional_tools`，其下一项才是 developer；插件在该处预期 user。
3. 当前插件 `messagesToResponseItems` 从 `f9a4b8d` 起一直没有 system/developer 分支，也没有 system `toolsAdded` 的转换路径。
4. `requestTail` 的严格比较从 `f9a4b8d` 起存在。
5. `2b06fd6` 加入有效 checkpoint fail-closed，并让准备异常进入主动 abort 路径。
6. 旧 converter 成功，新 converter 失败；删除整个 system message 后成功。该控制同时删除两种输出，不能分离其影响。
7. 第 493、495 行均成功，第 497、499、502 行均失败，与 system 从 tail 进入 prefix 的时点一致。
8. 仓库相关测试仍运行在 Pi 0.84.3。定向执行的 6 个 test files 共 180 项全部通过：`session-coordinator`、`index`、`request-lifecycle`、`responses-parity`、`grouped-bash`、`execution-settings`。

可排除项：

- `1820623` 的 deferred tool-search ID 修复，但不能据此排除 system 工具声明。
- `6fe4b30`、`d5b057d` 的 UI tool call ID 分组。
- `74c26a1` 的 stale-request cancellation。
- failed-request marker 作为第一次失败的起因。

`pnpm run check` 中 typecheck 通过，但全量测试在未涉及本次文档改动的 goal suites 失败，结果为 132 个 test files 通过、4 个失败、3 个跳过；共 1792 项通过、133 项失败、5 项跳过。测试阶段失败后，build 和 package check 未执行。

## Test gap

当前测试分别覆盖 system prompt prefix、deferred tools、tool call IDs 和有效 checkpoint 的 unmatched history，但没有组合以下场景：

1. session history 中间出现带 sections 和 `toolsAdded` 的 system message。
2. host converter 把它展开成 `additional_tools` 和 developer response items。
3. 后续 assistant/toolResult 使它从 request tail 移入 history prefix。
4. branch 中已有有效 checkpoint。

这正是 Pi 0.86.0 暴露的兼容场景。现有 Pi 0.84.3 fixtures 不会生成该输入，因此 180 项相关测试全部通过仍无法发现问题。

## Conclusion

事故根因已经离线复现确认。`f9a4b8d` 引入的 `messagesToResponseItems` 忽略中途 system transcript，而 Pi 0.86.0 的新 converter 通过 `resolveTranscript` 将其展开为 `additional_tools` 和 developer 项。该 transcript 从 tail 移入 history prefix 后，插件重建的 prefix 缺少整组语义，严格匹配抛出 `The Codex request changed before model-transition compaction completed.`。

`2b06fd6` 不是内容差异的来源，但它引入的有效 checkpoint fail-closed 和主动 abort 路径决定了最终表现为 `before_provider_request` 的 `compaction_failed` 后 aborted。`74c26a1` 扩展了工具历史兼容，却遗漏了 system transcript 回放。`1820623` 的 tool call ID 修复以及两个 codex-ui 提交的 UI grouping 与这次请求失败无关；system `toolsAdded` 不能排除，反而是首个已观测差异的一部分。

## Issue 2: User message layout regression

### Confirmed cause

截图中的 `›` 独占一行、正文前多一行空白，可直接归因于 codex-ui 提交 `6fe4b30`，不是 Pi 0.86.0 的 `UserMessageComponent` 改动。

`git blame` 将 `extensions/codex-ui/src/index.ts:87-91` 归到 `6fe4b30`。该提交把用户消息 transformer 从 `` return `› ${markdown}` `` 改成 `` return `›\n\n${markdown}` ``，并注明要让原始首个 block 保持 Markdown boundary。结果是 `›` 和正文成为两个 Markdown 段落，段落之间必然渲染一条空行。`d5b057d` 没有修改 `index.ts` 或用户 Markdown 测试，可排除。

旧 Pi 0.84.3 与新 Pi 0.86.0 的以下安装文件逐字节一致：

- `pi-coding-agent/dist/modes/interactive/components/user-message.js`，SHA-256 均为 `398a34b8a979daea5614be4cbbe6ff66e7eca97e9fd855508791dcddce994bc8`。
- `pi-tui/dist/components/markdown.js`，SHA-256 均为 `0c91b9ded6938d836dfd850590bc5a8bf656a6aeb74f470882e96135207e0820`。

`UserMessageComponent` 两版都在 `user-message.js:29-36` 创建上下各一行 padding 的 `Box`，再把 transformer 输出交给 `Markdown`。这里没有 0.84.3 到 0.86.0 的版本分支。灰色区域最上和最下的一行是原有 box padding；截图中 `›` 与正文之间的新空行来自 transformer 注入的段落边界。

### Offline render comparison

对同一个 `` Normal `inline` text. `` 分别用旧、新 SDK 渲染，去除 ANSI 后，两版输出完全相同：

```text
0.84.3, `› ${text}`       -> [blank, " › Normal inline text.", blank]
0.84.3, `›\n\n${text}`   -> [blank, " ›", blank, " Normal inline text.", blank]
0.86.0, `› ${text}`       -> [blank, " › Normal inline text.", blank]
0.86.0, `›\n\n${text}`   -> [blank, " ›", blank, " Normal inline text.", blank]
```

这既复现截图，也证明升级后的上游组件不是必要条件。时间上的升级关联更可能来自升级或重启时重新加载了同日 09:42 提交的插件代码，不能仅凭截图确认具体 reload 时点。

### Test gap and assumption

`6fe4b30` 同时新增 `extensions/codex-ui/__tests__/user-markdown.test.ts`。测试第 40-41 行明确要求 transformer 返回 `›\n\n${source}`，但第 14 行的 `contentLines` 先过滤所有空行，第 37 行又过滤只含 `›` 的行后再与 baseline 比较。因此测试验证了标题、列表、表格和 fenced code 等首块内容不会被 marker 改写，但过滤步骤使测试无法发现用户实际报告的垂直空白。

错误假设不是 Pi 0.86.0 改变了 layout，而是插件认为独立 marker 段落可以同时保持首块 Markdown 语义和紧凑单行布局。前者得到修复，后者必然被破坏。后续修复需要在不把 marker 拼入原始 Markdown 首块的前提下单独渲染前缀，或明确接受独占行但去掉段落间距；仅恢复空格拼接会重新引入 `6fe4b30` 所修复的块级 Markdown 边界问题。
