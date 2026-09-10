# Exception policy review

## Scope

本报告为 [Planning #15](https://github.com/wangxuyang1221/adventure/issues/15) 的通关核对。用户已确认全部取舍，最终规则移交 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12#behavior)。这里只记录场景推演、实现约束与证据边界，不代表产品代码已实现或新功能测试已通过。

项目源码基准为 `870cf4961436e8252a61c00d29a300a5a4b53760`。本次只修改冒险资料，产品源码仍是该基准。Pi 0.84.3、0.85.1 和 Codex 的固定版本证据沿用下列报告，不重复调查。

- [终止契约](./terminal-contract-review.md)：Pi 的最终 settled 边界与当前 scheduler 缺口。
- [Codex 输出上限](./codex-output-limit-review.md)：恢复耗尽后的最终状态和预算优先级。
- [剩余执行边界](./remaining-execution-boundaries.md)：deferred response 和工具不可见的区别。
- [纯文本续跑](./codex-text-loop-review.md)：用户明确排除新增保护的依据。

## Scenario review

以下为对已确认规则的静态场景核对，不是执行新增实现后的断言结果。

| 场景 | 核对结论 | 实施验证重点 |
| --- | --- | --- |
| 中途 error 或 length，Pi 恢复后正常 stop | 以最终结果为准可避免抢先停止 | 旧终止标记必须被后续成功结果清除，不能跨 run 泄漏 |
| Pi 最终 settled，仍为 length，目标仍 active | 可以复用现有 blocked 存储与手动恢复路径，补足 active 悬挂缺口 | 最终事件关联、提示和没有新自动请求 |
| 最终 deferred，没有正常取回结果 | 普通 Agent loop 不自动 fetch，选择明确停止无需添加新传输能力 | 不 poll、不重复提交；不把 deferred tool loading 当成此结果 |
| 最终普通错误或 length/deferred 前，usage 已使目标 budget_limited | 现有存储 control 会保留预算状态，规则一致 | 最终结算先完成，普通停止不得降级预算状态 |
| 明确账户额度错误，目标 active 或 budget_limited | 与既有 usage_limited 优先级相容 | 正例采用可核实的明确错误码或文案，保留大小写等窄归一化 |
| 仅有 429、超时、认证错误或含糊 billing 文本 | 无法据此证明账户额度耗尽；最终无法恢复时仍可 blocked | 重试成功不停止，失败时不误报 usage_limited |
| 必要 goal 工具被关闭 | 可读取 active tools 并门控新自动请求，无需强改 goal status | 提示实际缺失项，不重启用户关闭的工具 |
| 工具恢复，但用户没有 /goal resume | 一般用户输入会释放现有 continuationDeferral，不能直接复用它代表本规则 | 独立记录等待显式恢复的原因，模型切换和普通输入不能解除 |
| 工具关闭前请求已经发出，随后返回 usage | 工具门控只限制后续发起，不应切断已归属响应的结算 | 不将工具可见性混入共享计量 eligibility；仍可因真实结算达到预算 |
| 排队中的旧 continuation、替换目标后的迟到事件 | 现有 owner/generation/runGeneration fence 可作为基础 | 新门控不能误取消用户输入，也不能让旧事件改变新目标 |
| 连续非空纯文本响应，无工具调用 | 用户明确不新增计数停止策略，与已有空响应和重复工具保护不冲突 | 保留已有保护；不把此场景误放入空响应计数 |

## Source cross-check

已重新核对本仓库的以下实现，不依赖旧报告中的过时描述。

- [`scheduler.ts`](../../extensions/goal/src/scheduler.ts) 的 `agent_end` 当前只保存 error，`agent_settled` 才分类账户额度。length/deferred 的最终停止尚未实现。`valid` 和 ticket 已校验目标与运行归属。
- [`index.ts`](../../extensions/goal/src/index.ts) 的 `syncTools` 当前会在 session_start/model_select 重新加入 create_goal/update_goal。实现新规则时必须区分插件自己因不支持运行环境而隐藏工具，与用户或其他扩展主动禁用，不能保留无条件重加逻辑。
- 同一文件的 `input` 会释放继承目标的 continuationDeferral。它的语义是普通用户输入或 resume 即可释放，不满足本次工具恢复只认显式 resume 的约定。新门控的存储位置属于局部实现设计，不能因此重新询问已确认行为。
- [`accounting.ts`](../../extensions/goal/src/accounting.ts) 在请求时绑定 source，在 message_end 结算。它与 [`children.ts`](../../extensions/goal/src/children.ts) 都使用共享 capability。工具门控若直接加到该共享判断，会改变计量准入，需避免。
- [`storage.ts`](../../extensions/goal/src/storage.ts) 的 `control` 保留 budget_limited 对普通 pause/blocked 的优先级，允许明确 usage_limited 覆盖；resume 不增加已耗尽的预算。

## Result and deferred verification

用户决策之间没有发现阻碍方案成立的冲突。公开扩展接口和现有存储足以承载这些规则，Planning #15 可以通关。

仍未证明的是新增实现的运行正确性。上表场景须在切片审核时分配给负责的 Implementation，以离线事件测试和实际 Pi SDK fixture 验证。最终交付前覆盖两版 Pi 的恢复时序、工具门控与计量交叉、旧事件隔离以及额度分类反例。测试不能用伪造事件单独证明真实 SDK 时序，也不能宣称任意远端模型已验证。

usage 缺失时是否继续、token 公式和预算检查边界留给 [Planning #16](https://github.com/wangxuyang1221/adventure/issues/16)。本关没有为缺失 usage 添加停止策略，也没有强制预算或自定义错误配置。
