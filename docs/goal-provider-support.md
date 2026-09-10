# Goal provider support

## Supported sessions and models

goal 复用 Pi 当前已选模型及其配置，不按 provider 名称设白名单。支持 Pi 内置 provider、`models.json` 私有模型，以及其他扩展注册的合规 provider。模型必须支持普通 function tools，adapter 必须履行 Pi 消息和终止事件契约。goal 不提供任意私有协议适配，也不保存 base URL、API key 或独立模型凭据。

执行仍限于持久化交互 TUI 的 root 会话，不扩展 print、JSON、RPC、临时会话或子会话 goal 循环。工具是否启用不能证明模型一定会调用工具或完成任务。

Pi 0.84.3 和 0.85.1 的离线验证覆盖原生 OpenAI-compatible Completions/Responses、Anthropic、Google、Codex adapter，以及扩展注册的合规自定义 stream。测试实际运行 SDK、工具与生命周期；协议数据为构造样本，不是所有远端 provider、模型或私有服务均已实测。

## Tool recovery and final outcomes

必要工具为 `create_goal`、`get_goal`、`update_goal`。发现工具禁用时，goal 显示实际缺失项，保留当前状态，不擅自重新启用工具，也不再发起新自动续跑。恢复工具后必须显式 `/goal resume`。普通输入、编辑、模型切换与 reload 都不解除该限制。已归属响应仍结算 usage、预算和最终错误。

Pi 先完成适用的重试与压缩恢复。最终 `agent_settled` 仍为未恢复 length、deferred 或普通错误时，仍 active 的目标转为 blocked，保留目标供恢复。后续成功会消除中途异常。goal 不复制网络重试、不提高输出上限，也不增加 deferred 等待或结果取回流程。

明确账户余额、订阅或用量额度耗尽的最终错误可以转为 usage_limited。裸 429、含糊 billing、认证或网络错误不证明账户额度耗尽。识别只用保守内置规则，不支持自定义 matcher，不保证覆盖所有私有服务文案。普通错误和 length/deferred 不覆盖 budget_limited；明确账户额度错误保留较高优先级。

非空纯文本回复不新增续跑次数限制。已有空响应、重复工具调用、连续执行失败和预算保护保留。

## Observed token accounting

根响应和受管直接子代理采用相同公式：

```text
countedTokens = usage.input + usage.output + usage.cacheWrite
```

这些字段已经过 Pi 归一化。排除 cacheRead；reasoning 是 output 的子集，不能再加一次。例如 input 50、output 10、cacheWrite 30、cacheRead 20、reasoning 8，计 90。只有 cacheRead 20、其余为零时计 0。Google 在这两个 SDK 版本归一化的 cacheWrite 恒为 0，不能凭空恢复其未暴露的字段。

只累计有效、已观察且归属当前目标的用量，包括根响应、Pi 提供 usage 的压缩和分支摘要、明确归属的受管直接子代理。任意工具内部模型调用、第三方代理和孙代理账单不在范围内。流式 delta、context tokensBefore、footer totalTokens 都不是该预算的计量来源。

缺失、非法或未经证实的全零 usage 会发出计量不完整警告，有预算和无预算均继续。后续有效 3+4 只追加 7，不填补历史缺口。目标查询及工具结果持续说明 tokens 只包含已观察用量。此标记不会因 edit、resume 或 reload 自动清除。

provider 未暴露的失败请求或服务端消耗无法还原；磁盘故障或报告前进程被强杀也不能保证零丢失。公式不是全部处理 token 总量，更不是费用。

## Soft budget and frozen reports

收到最终 usage 或来源检查点后，已知累计达到预算才记为 budget_limited。当前仍可收尾的运行只收到一次提示，要求停止新实质工作并总结。goal 不强制中断当前模型、工具或子代理。收尾依赖模型遵守提示，仍可能调用模型和工具。

实际 110/100 保存为 110，不截断到 100，不再启动后续 goal 自动续跑。根回合已经结束、只剩排队续跑时，迟到子代理报告命中预算不会为提示另开回合。确实完成可以标 complete，不因预算耗尽假称完成。

目标 paused、blocked、usage_limited、complete，或预算收尾已经结束后，新收到的子代理报告只推进检查点，不追加目标统计。恢复前刷新报告基线。例如来源已计 10，停止后报告 50，目标仍计该来源 10；恢复时基线为 50，恢复后报告 60，只追加 10，总贡献为 20。

这是报告观测边界，不是实际发生时间的精确切分。尚未报告的用量不能据发生时间拆开。工具关闭但状态仍 active 不属于冻结，已经归属的最后响应仍须结算。停止或替换之前已观察到的相关用量先结算，旧目标迟到事件不进入新目标。

同一目标 edit/resume/reload 保留预算、实际累计和缺口。耗尽的 110/100 不会靠 edit/resume 重置，不提供旧目标追加预算入口。新目标重新计量。显式继承复制累计快照及缺口，但不复制活动子代理订阅。

可选 `getAgentDir()/goal.json` 的 `maxGoalTokenBudget` 仍沿用既有配置方式。它同时是创建时默认预算与可接受显式预算上限；未配置且未显式指定则无上限，不新增强制预算。详细命令见 [README](../README.md#goal-extension)。

## Verification entry points

完整规格为 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12)。实现与双版本复现入口：

- [Provider admission and tool recovery](https://github.com/wangxuyang1221/pi-ext/blob/adventure/goal-all-providers/adventure/evidence/slice-1-provider-admission.md)
- [Final outcomes](https://github.com/wangxuyang1221/pi-ext/blob/adventure/goal-all-providers/adventure/evidence/slice-2-final-outcomes.md)
- [Accounting and delivery audit](https://github.com/wangxuyang1221/pi-ext/blob/adventure/goal-all-providers/adventure/evidence/slice-3-spec-audit.md)

验收材料区分原生协议映射、实际 SDK 时序、真实受管进程、实际 TUI 和未调用的远端服务。是否通关由协调者独立核验，Map 和 Spec 留待用户确认交付。
