# Pi 0.86.0 Compaction Compatibility Incident

## Resolution

后续已实施 0.86.0 兼容性升级与修复，目标版本下五个事故分支均通过只读重放。实现、回归结果及基线缺口见 [Compatibility validation](pi-0.86.0-compatibility-validation.md)。下文保留修复前的调查记录。

## Conclusion

会话 `01a0ba78-1a61-7400-80fa-d8afcd44722e` 的最后连续中断，可由 Pi `0.86.0` 新增的会话中途 system 消息序列化与现有 `codex-compact` 历史转换器不兼容复现。不是依据 `compaction_failed` 分类猜测网络故障。

全局安装版本为 `0.86.0`；仓库 `node_modules` 中 Pi SDK / Pi AI 仍为 `0.84.3`。本次没有升级仓库依赖、修改生产代码或改写原始会话。

## Upstream Change

上游提交 [`9e05370b298d0a6b8d9bc2c02e4bfae189ef1616`](https://github.com/earendil-works/pi/commit/9e05370b298d0a6b8d9bc2c02e4bfae189ef1616)，`Mid conversation system messages (#9548)`，提交时间为 2026-09-16T13:54:07Z，包含在 `v0.86.0` 中。提交说明明确将 system prompt 与工具变更放入 transcript。

[`v0.86.0/packages/ai/src/api/openai-responses-shared.ts`](https://github.com/earendil-works/pi/blob/v0.86.0/packages/ai/src/api/openai-responses-shared.ts) 的 `convertResponsesMessages` 先调用 `resolveTranscript`，再处理 `role === "system"`：

- 会话中途的工具声明可生成 `additional_tools` 或 `tool_search` 项。
- 会话中途的提示更新通过 `renderSystemMessageUpdate` 生成 developer/system 消息。
- 消息位置也参与输出 ID 和工具加载 ID 计算。

Context7 未提供足够具体的版本迁移内容，因此本次以安装包 `0.84.3` / `0.86.0` 实际 JS 差异、上游固定 tag 源码及 GitHub 提交记录为依据。

## Incident Timeline

原始文件：`~/.pi/agent/sessions/--Users-wangxuyang-Code-t3code-pi-ext--/2026-09-19T16-20-28-389Z_01a0ba78-1a61-7400-80fa-d8afcd44722e.jsonl`。以下时间为北京时间 2026-09-20。

| Line | Time | Event |
| --- | --- | --- |
| 296 | 09:38:20 | 保存原生 Codex 压缩 checkpoint。 |
| 493 | 10:54:07 | 最后一个正常完成的旧轮次。 |
| 494 | 10:55:25 | 新增 `role: system`，含 sections 与 toolsAdded。 |
| 495 | 10:55:25 | 用户发送新方案。 |
| 496–497 | 10:55:33 | 模型成功调用 Bash，Bash 正常返回。 |
| 498 | 10:55:33 | 下一次模型请求中断。 |
| 499–501 | 10:56:01 | 用户发送 `？`，插件记录 `before_provider_request / compaction_failed`，随后 aborted。 |
| 502–504 | 10:56:43 | 用户发送 `go on`，重复相同失败。 |

安装包关键 JS 文件的 mtime 为 10:49:25，与本次升级时间顺序相符；mtime 不是完整安装日志，不能单独证明旧进程的重启时间。

## Offline Replay

本地复现脚本：`.tmp/codex-compact-incident/replay.mjs`；结果：`.tmp/codex-compact-incident/replay-result.json`。`.tmp` 为 git 忽略目录。

脚本按 parentId 重建真实会话分支；使用固定的 `0.86.0` 内建 GPT-6 Astra 模型描述，对比两个版本的 Responses 转换器；加载当前插件 coordinator，并将其主要模块的 SDK 导入绑定到全局 `0.86.0`，避免仅用旧 SDK 测试。禁止远程压缩和 checkpoint 写入，不读取认证信息。

这属于请求准备阶段的离线重放，不是服务端请求重放。没有保存当时完整 wire payload，因此工具元数据与 leading instructions 使用受控输入。该限制不影响复现会话中途 system 消息与历史前缀不一致这一失败条件。

| Branch ending at line | 0.84.3 converter | 0.86.0 converter | 0.86.0 with system messages removed as a control |
| --- | --- | --- | --- |
| 493 | 成功 | 成功 | 成功 |
| 495 | 成功 | 成功 | 成功 |
| 497 | 成功 | 失败 | 成功 |
| 499 | 成功 | 失败 | 成功 |
| 502 | 成功 | 失败 | 成功 |

所有失败均为：`The Codex request changed before model-transition compaction completed.`

第 497 行分支的首个结构差异在输出索引 648：插件历史重建预期为 user 项，新转换器实际为包含 27 个工具的 `additional_tools` 项，下一项是 developer 提示更新。

过滤 system 消息只用于因果对照，不是修复方案。生产中这么做会丢失提示和工具变更。

## Failure Mechanism

1. 插件 [`native-compaction.ts`](../extensions/codex-compact/src/native-compaction.ts) 的 `messagesToResponseItems` 只处理 user、assistant、toolResult，没有处理新 system transcript。
2. 新用户消息到达时，第 494 行 system 更新暂时落在本轮请求 tail，所以第一次模型请求成功。
3. Bash 返回后，system 更新成为下一次请求需要匹配的历史前缀。Pi `0.86.0` 请求包含它，插件重建的历史不包含它。
4. [`session-coordinator.ts`](../extensions/codex-compact/src/session-coordinator.ts) 的 `requestTail` 使用 `isDeepStrictEqual` 做逐项前缀匹配，所有候选均不匹配，抛出上述异常。分支已有有效 checkpoint，不能直接放行原始请求。
5. [`index.ts`](../extensions/codex-compact/src/index.ts) 的 `before_provider_request` catch 调用 `ctx.abort()`，并将异常归入兜底分类 `compaction_failed`。原始异常文本未持久化，最终表现为 `Operation aborted`。

## Recent Plugin Changes

详细提交分析见 [Plugin history audit](codex-compaction-incident-plugin-history.md)。核心判断是版本兼容缺口被此次升级触发，而非今天两个 codex-ui 修复提交直接改变了模型历史。现有严格前缀匹配和拒绝执行策略将这个缺口变成了可见中断；不能通过去掉保护或忽略 system 消息修复。

## Repair Scope

后续修复需要按 Pi `0.86.0` 更新历史回放语义，覆盖 system sections、工具声明与移除、工具声明位置及消息 ID。还需覆盖“旧 checkpoint 会话恢复后插入 system 更新，工具完成后继续请求”这一跨版本场景，并让测试版本与运行版本一致。

失败诊断应保留经过脱敏的原始错误类型、阶段及可定位信息，而不是仅保存 `compaction_failed`。诊断不得包含认证数据、encrypted_content 或完整私有提示。
