# Compaction journeys

从仓库根目录执行，先完成 [Launch 与 Doctor](SKILL.md#launch)。每次运行选一个尚不存在的 `.tmp` 证据目录，等待退出后再执行下一条。驱动独占共享验证锁，不能与其他共享 case 并行；所有状态和副作用均位于本仓库 `.tmp`。

## Commands

命令格式如下，将末尾参数替换为表中场景名。省略场景名等同于 `combination`。

```bash
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-compact/scripts/compact-pty.py .tmp/compact-combination combination
```

| Case | Observable result | IDs |
| --- | --- | --- |
| `combination` | 长文本与 PNG → `/compact` 原生卡片 → 新消息 → Esc 取消且 checkpoint 不变 → metadata 保存/reset 保留配置 → 重试生成新 checkpoint → `/new` → `/resume` 搜索原会话 → 工具执行、追加工具声明和系统提示更新 → `/quit` → `--session` 冷启动后请求仍含 checkpoint 和图片 | `compact-manual`, `compact-cancel`, `compact-resume`, `compact-tools`, `compact-system-updates`，以及 retention/media 的固定场景 |
| `threshold` | 宿主开启自动压缩，成功响应报告 710000 input tokens；宿主触发 reason=threshold，出现原生卡片与成功提示，后续请求含 checkpoint | `compact-threshold` |
| `overflow` | 首次普通请求返回 context_length_exceeded，宿主压缩后只重试一次；280000 字符 pending 输入完整且仅出现一次，压缩请求不包含该 pending 输入 | `compact-overflow`, `compact-pending-input` |
| `repeated-overflow` | 连续 overflow，界面显示 after one，实际只有两次普通请求和一次压缩 | `compact-overflow` 的重试上限 |
| `automatic` | 保留 checkpoint 和高 usage 尾部，降低扩展阈值；请求前出现动态 spinner，Esc 取消使 indicator 消失且原 checkpoint 不变；重试保留取消输入；随后注入 401，显示 invalid_api_key、旧 checkpoint 不变，恢复服务后可继续对话 | `compact-pre-request`, `compact-cancel`, `compact-failure`, `compact-pending-input` |
| `navigation` | 逐次打开 `/model` 选择器并搜索同 hash、不同 hash、较小窗口、非 Codex 模型；每次选择后发送新输入并核对实际请求。再通过 `/tree` 搜索根消息、选择 No summary，后续请求不含原分支的后代消息 | `compact-model-switch`, `compact-tree` |
| `model-boundaries` | 长文本 checkpoint 后经 `/model` 选择12000窗口的同 hash模型，原重放估算超过11400有效窗口，生产重新压缩后实际请求满足预算、pending恰好一次。再选不同 hash模型，注入错误请求前缀；真实TUI显示 history_prefix_mismatch、零服务请求且 checkpoint 不变，恢复投影后继续成功 | `compact-model-switch` 的容量转换和前缀拒绝 |
| `model-boundaries-tools` | 上述旅程保留活跃 fixture_read；最终完整请求包含重新附加的工具声明且满足11400预算，pending完整。压缩预算使用实际目标模型投影，不通过删除声明降低估算 | `compact-model-switch`, `compact-retention` 的工具声明预算组合 |
| `stale` | 已有 checkpoint 的模型转换请求等待服务时，再打开 `/model` 选择原模型；旧 transport 收到 abort、indicator 消失、checkpoint 不变，新模型仍能继续对话 | `compact-stale` 的模型变化分支 |
| `stale-session` | 模型转换等待时输入 `/new`，旧 transport 收到 abort，原会话 checkpoint 不变，新会话完成后续对话 | `compact-stale` 的会话变化分支 |
| `stale-tree` | 模型转换等待时打开 `/tree` 搜索旧根消息，选择 No summary；旧 transport 收到 abort，旧 checkpoint 不变，新分支完成后续请求 | `compact-stale` 的分支变化分支 |
| `stale-tools` | 模型转换等待时输入扩展命令 `/fixture-change-tools` 注册并激活新工具，再释放固定服务的迟到响应；生产声明校验拒绝提交旧结果，checkpoint 不变，后续请求仍可继续 | `compact-stale` 的工具声明变化分支 |
| `legacy-provable` | 用历史格式种入未含 preservedInputSources 的 marker，真实 CLI 冷启动 `/compact` 成功迁移来源，后续请求保留完整旧 pending 输入 | `compact-legacy` 的可证明来源 |
| `legacy-truncated` | 旧保留区只有裁剪文本，CLI `/compact` 显示 preserved_input_source_unproven，无压缩服务调用且旧 checkpoint 不变；后续输入结束后再次核对 marker 未改写 | `compact-legacy` 的来源拒绝 |
| `usage-invalid` | 固定长历史配合小的有效 usage 不触发压缩；usage=0 后下一请求按本地历史估算触发压缩 | `compact-usage` 的有效基线及非法基线回退 |
| `usage-failed` | 先证明有效小 usage 不触发压缩，再注入失败响应；后续按本地历史估算触发压缩 | `compact-usage` 的失败回退 |
| `usage-source` | 有效小 usage 下不触发压缩，更新系统提示后基线失效，后续按本地历史估算触发压缩 | `compact-usage` 的来源变化回退 |

## Evidence and limits

每条命令通过的条件为 summary 的 `passed: true`、`stopped` 全为 true、`cleanup: removed`，且共享锁释放。`actions` 记录真实按键和场景配置更新，`screens.json` 保存各等待点画面，`state/events.jsonl` 保存 adapter、目录、普通/压缩请求和工具事件，`state/sessions` 保存真实宿主历史。失败运行同样保留证据，用新目录重跑，保留原始失败。

这些场景检验本地客户端及真实 TUI。服务响应、usage、compHash 和 opaque 内容均为夹具，不证明远程模型质量。`model-boundaries*` 的前缀拒绝步骤另在 adapter onPayload 边界注入不匹配历史，再调用原生产 onPayload 链，模拟不兼容扩展修改请求投影。它记录注入前后 input、错误通知、服务请求计数及 checkpoint 字节；这是明确的请求边界故障注入，正常菜单本身不产生错误前缀。旧 marker 由 seed helper 创建，明确属于历史格式输入；新 checkpoint 则由生产扩展处理固定 SSE 响应后持久化。

`navigation` 的窗口缩小示例在当前历史可容纳时保留 checkpoint；`model-boundaries*` 补验必须重新压缩的缩窗及前缀拒绝。媒体格式与原子裁剪、历史消息分类及预算的其它组合仍需各 feature 列出的定向测试。Pi TUI 没有 inline audio 上传入口，音频解码通过媒体测试验收，不补造 TUI 动作。有效 usage 场景的固定 SSE 同时提供 input_tokens、output_tokens 和 total_tokens，才能从真实 adapter 得到有效 totalTokens 基线。

保留区预算通过不可变的目标模型重放投影计算，包含恢复的工具声明、移除提示、instructions 和原样 pending；只缩减可选历史。tool_search 恢复 ID 在纯预算预览中按编码长度上界计量，实际请求标识符保持宿主生成值。固定部分本身已超过预算时，仍完整保留 pending 和声明并让服务判断接受性；不能把这类例外写成所有最终请求硬性满足本地预算。

分别记录 `strictTuiStatus` 和 `layeredStatus`。前者沿用全必要用户分支的严格口径，未实跑的消息分类、预算其它组合或媒体裁剪分支继续 unverified；后者说明真实 TUI 配合生产算法/SDK 定向断言能证明的本地范围。两个口径都不包含远程认证、checkpoint 接受性和摘要质量。
