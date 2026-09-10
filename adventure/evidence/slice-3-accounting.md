# Slice 3 accounting verification

## Scope and result

本报告记录 [Implementation #19](https://github.com/wangxuyang1221/adventure/issues/19) 阶段 A 的 worker 验证。完整规格仅为 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12)，阶段 B 入口为 [Spec audit](slice-3-spec-audit.md)。接手提交 `46114b5da7556983ed67323ec8b1465d11c6c913`，保留已验收 #17/#18 产品和材料。

两版实际 SDK 的原生 usage 映射、受管直接子代理、软预算、冻结恢复和实际 TUI 断言通过。本关只补了子代理缺失 usage 的即时英文警告，没有修改公式、状态优先级或前两关业务。这里不写协调者 Acceptance 结论。

## TDD change

[`commands.test.ts`](../../extensions/goal/__tests__/commands.test.ts) 首先增加有预算和无预算的子代理缺失报告断言。生产订阅收到报告并持久化 `usageIncomplete`，但没有 warning，两个断言失败，见 [Red](slice-3-child-warning-red.log)。

[`index.ts`](../../extensions/goal/src/index.ts) 的子代理归集回调在原子提交之后比较前后快照。仅当目标首次从完整变为不完整时发警告，再沿用既有镜像刷新。没有增加另一条计费路径，冻结报告不使目标产生新缺口，因此也不误报警告。

定点 [Green](slice-3-child-warning-green.log) 和最终 [goal unit](slice-3-goal-unit.log) 通过。第三个新增测试补验 10→暂停→报告 50 missing→resume→报告 60→reload，目标分别计 10、20，恢复后的新增量保留缺口，只警告一次。最终 goal 为 13 个文件、228 项通过。

初稿 Green 曾把工具响应中的诊断字段误写为 `details.goal.usageIncomplete`，实际公开结果使用 `details.usageVisibility`。修正的是测试读取位置，磁盘缺口和后续 token 断言未削弱。原生摘要夹具的导航 entry、keepRecentTokens，以及证据输出参数也按实际 API 修正。这些夹具错误不作为产品 Red。

## Native adapters

[`accounting-fixtures.mjs`](../../extensions/goal/__tests__/accounting-fixtures.mjs) 构造原始 SSE/JSON，调用目标 SDK 相邻 `pi-ai/dist/api/*.js` 的真实 `stream`。Pi 自身解析和归一化 usage。自定义 provider 单列为合规 stream，不冒充原生 adapter。

所有请求使用无效离线凭据。Google 的 SDK 不接收同样的 fetch override，因此只拦截保留域名 `https://goal-google.invalid/`；其他家族使用 adapter 的 fetch override。未知 fetch 一律拒绝，记录的意外网络调用为 0。模型配置、function tool 序列化、响应解析、工具执行和终态均经实际 SDK，不手发正常生命周期事件。

| Family | 原始协议样本 | Pi 归一化及计量 |
| --- | --- | --- |
| OpenAI-compatible Completions | prompt 100，completion 10，cached 20，cache_write 30，reasoning 8 | input 50 + output 10 + cacheWrite 30 = 90 |
| OpenAI-compatible Responses | input_tokens 100，output_tokens 10，cached 20，cache_write 30，reasoning 8 | 同上，计 90 |
| Anthropic Messages | input 50，output 10，cache_creation 30，cache_read 20，thinking 8 | 同上，计 90 |
| Codex Responses | 同 Responses 的缓存与 reasoning 字段，实际 Codex SSE adapter | 同上，计 90，未走真实 OAuth/远端 |
| 合规 custom | 直接履行 Pi 归一化消息契约 | input 50、output 10、write 30、read 20、reasoning 8 计 90 |
| Google Generative AI | prompt 100，cached 20，candidates 2，thoughts 8 | input 80 + output 10 + cacheWrite 0 = 90 |

Google 两版原生 adapter 的 cacheWrite 恒为 0，不能伪造它支持 write 30。Google 样本证明减掉 cacheRead、将 thoughts 加入 output 后不重复计 reasoning；完全相同的 50/10/30/20/8 归一化样本由其他家族和正式公式测试证明。这与 Spec 使用 Pi 已暴露字段的规则一致，不需要改变预算政策。

固定源码验证见 [source hashes](slice-3-fixed-sources.json)。通过 `gh api` 读取两版固定 revision 的 Completions、Responses、Responses shared、Anthropic、Google、Codex 六份原始 TypeScript；12 份均与已安装包 source map 的 `sourcesContent` 逐字节一致。

## SDK matrix

正式入口 [`accounting-runtime.mjs`](../../extensions/goal/__tests__/accounting-runtime.mjs) 实际运行 ModelRuntime、AgentSessionRuntime、SessionManager、extension runner 和工具。每版 74 场景、288 个请求。

| 场景 | 断言 |
| --- | --- |
| 6 家族 × 5 usage 类型 × 有无预算，共 60 | cache/reasoning 90；cache-read-only 0 且无缺口；全零、缺失和负 output 不造数，继续到有效 3+4，只加 7；get_goal 和 update_goal 持续返回缺口；有预算为 1000，未强制无预算目标设置预算 |
| 6 家族 receipt 重放 | 同 responseId 两次实际回复，只加一份 7 |
| 6 家族软预算 | 当前运行 100 后收尾 10，保留 110/100，只一条预算提醒、2 请求；edit/resume/reload 不重置或另发请求 |
| 缺口 edit/resume/reload/inherit/replace | 同目标保留 7、1000 和缺口；继承复制快照，新目标清零，不清除旧目标的事实 |
| 根/压缩/分支摘要跨 provider | Completions 根 10、Anthropic 原生 compact 20、Google 原生 navigateTree summary 10，共 40，reload 不重收；摘要事件携带实际 Pi usage |

机器证据：[0.84.3](slice-3-sdk-0.84.3.json)、[0.85.1](slice-3-sdk-0.85.1.json)。JSON 包含请求的 API/provider/序列化工具、原始协议、Pi 归一化消息、工具结果、通知与生命周期快照。

非法 usage 的扩展边界由正式 `accounting.test.ts`、`subagent/usage.test.ts` 及 [Planning 的 47 场景](budget-policy-review.md) 补足，包含缺字段、负数、小数、字符串、NaN、Infinity、非法缓存和总和溢出。Planning 合成事件不替代上述实际原生映射与 SDK 时序。

## Managed direct children

[`accounting-child-runtime.mjs`](../../extensions/goal/__tests__/accounting-child-runtime.mjs) 每版启动 16 个真实 OS 子进程，实际执行生产 subagent manager、初始投递、原生 `subagent_delivery` entry、任务归属、子端报告文件和根端订阅。关闭使用实际 `subagent_close` 工具。传输层为测试 IPC，不能将这组说成 tmux 已测。

每版根端 67 请求、子端 25 请求，共 92。根与 child 使用不同 provider；所有子端退出码 0，使用的凭据无效，没有付费调用。

| 场景 | 结果 |
| --- | --- |
| 6 家族 child 90 | 根缓存读取不计，child 正确计 90，保存原生映射与实际投递记录 |
| child receipt 重放 | Anthropic 两回复同 receipt，报告与目标仍为 90 |
| 全零/缺失/非法 × 有无预算，共 6 | child 后续有效 7，根 query/get_goal 显示缺口、warning 一次，reload/继承仍保留 |
| Google 冻结恢复 | 同一实际任务三次报告累计 10、50、60；暂停后 50 只推进来源，resume 基线 50，最终目标计该来源 20 |
| Google cache-read-only | child 报告和目标均为 0，不误设 missing |
| 四种来源同一目标与预算 | Completions 根 10 + Responses child 30 + Anthropic compact 20 + Google branch summary 10 = 70；再由 Completions 30 命中 100，收尾 10 最终 110/100，仅一次软提醒 |

[0.84.3 完整记录](slice-3-child-sdk-0.84.3.json)、[0.85.1 完整记录](slice-3-child-sdk-0.85.1.json) 保存真实 child PID、exitCode、原生消息、wire、normalized、投递 entry、报告与父目标观察值。所有继承都先确认源目标存在 child 订阅，再断言新记录不继承订阅。

另外本关重新运行既有 [`child-tmux-runtime.mjs`](../../extensions/goal/__tests__/child-tmux-runtime.mjs)，两版各 `late` 和 `pending`。它实际启动隔离 tmux server、pane 和目标版本子端 Pi CLI，不采用 IPC 替代传输。

- `late`：根替换目标后，旧 child 的真实 100 报告存在，但新目标观察值为 0，之后只计自己的 10。
- `pending`：根已经结束，只剩自有排队续跑，child 100 使总量 120/100；没有为预算提示启动新回合。根请求仅 2，child 仍存活，由显式 close 关闭。
- 所有 socket、pane、server 均清理，见 [0843 late](slice-3-tmux-0.84.3-late/results.json)、[0843 pending](slice-3-tmux-0.84.3-pending/results.json)、[0851 late](slice-3-tmux-0.85.1-late/results.json)、[0851 pending](slice-3-tmux-0.85.1-pending/results.json) 及各目录 `cleanup.json`。

所有四种停止状态与预算收尾已结束后的冻结，由本次 check 重跑的 `child-budget.test.ts`、`commands.test.ts` 补充；不是用暂停一种状态概括所有停止状态。

## Actual TUI

[`accounting-tui.mjs`](../../extensions/goal/__tests__/accounting-tui.mjs) 启动目标版本真实 InteractiveMode，Python driver 在 PTY 输入命令并用 pyte 解析实际终端帧，不用 `uiContext.notify` 回调冒充视觉结果。

两版 × 根/child 缺口 × 无预算/1000，共 8 组全部通过。根用原生 Anthropic；child 用真实 Google 子进程、生产投递与报告。每组实际输入 `/goal`、`/goal edit`、`/reload`、`/goal resume`、`/goal`，然后干净退出。

终端帧同时证明即时 warning、7 tokens、查询的 `Usage is incomplete; tokens shown are observed usage only.`，以及 edit/reload/resume 后同一缺口仍在。两次实际 get_goal 返回 `usageVisibility`，update_goal 也返回诊断。没有只凭落盘 flag 判断可见。

| Version | Root | Child |
| --- | --- | --- |
| 0.84.3 | [unbounded](slice-3-tui-0.84.3-root-unbounded/screens.json)、[1000](slice-3-tui-0.84.3-root-1000/screens.json) | [unbounded](slice-3-tui-0.84.3-child-unbounded/screens.json)、[1000](slice-3-tui-0.84.3-child-1000/screens.json) |
| 0.85.1 | [unbounded](slice-3-tui-0.85.1-root-unbounded/screens.json)、[1000](slice-3-tui-0.85.1-root-1000/screens.json) | [unbounded](slice-3-tui-0.85.1-child-unbounded/screens.json)、[1000](slice-3-tui-0.85.1-child-1000/screens.json) |

每个目录还有原始 `terminal.ansi`、`events.jsonl`、`result.json` 与 `cleanup.json`。测试 driver 使用增量 UTF-8 解码，避免分块边界损坏终端字符。`.gitattributes` 仅将这些 PTY 原始流标为 binary，保留回车、控制码和屏幕填充，不做文本换行转换。其他 `.log` 归档只去除行尾空白和末尾多余空行，断言输出未改。这里检查警告可见性，不声明所有终端视觉布局完美。

## Cross-slice regressions and cost

本关重新运行两版 provider、terminal、execution 三组实际 SDK，每版仍分别 22/60、56/129、15/132。它们证明工具关闭后的最后 usage、软预算与最终异常优先级没有回退，包含恢复成功清除旧异常、旧目标隔离和自有排队取消不损坏用户输入。详细映射见 [Spec audit](slice-3-spec-audit.md)。

本次生产改动仅在已有成功子代理提交后做一次布尔比较，首次缺口才通知；没有新增 streaming delta 写入、轮询、并发请求或额外扫描。`children.test.ts` 重复检查点不重复调用 account，receipt/报告重复不重收，本次警告测试证明不变报告不重复通知。既有根端按登记来源数扫描、子端 receipt 集合随响应数增长的成本未改变；没有未经测量的耗时、吞吐量或无限历史常数内存承诺。

## Reproduction

环境为 Node 22.22.2、pnpm 11.9.0、conda `codex-py312`，PTY 需要 pyte 0.8.2。依赖安装使用 `pnpm install --frozen-lockfile --ignore-scripts`。所有实验目录放在 worktree，测试使用无效离线凭据。

```bash
SDK_0843="$(realpath node_modules/@earendil-works/pi-coding-agent)"
SDK_0851="/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.85.1/4011d0a1b084fee9580232c1f0d858a8429fe70851ed74fe182409e63aa52ab9/node_modules/@earendil-works/pi-coding-agent"
env -u PI_SUBAGENT_PARENT pnpm exec vitest run extensions/goal/__tests__
for sdk in "$SDK_0843" "$SDK_0851"; do
  version=$(node -p "require('$sdk/package.json').version")
  env -u PI_SUBAGENT_PARENT GOAL_ACCOUNTING_EVIDENCE="adventure/evidence/slice-3-sdk-$version.json" \
    pnpm exec node extensions/goal/__tests__/accounting-runtime.mjs "$sdk"
  env -u PI_SUBAGENT_PARENT GOAL_CHILD_ACCOUNTING_EVIDENCE="adventure/evidence/slice-3-child-sdk-$version.json" \
    pnpm exec node extensions/goal/__tests__/accounting-child-runtime.mjs "$sdk"
  for scenario in late pending; do
    env -u PI_SUBAGENT_PARENT GOAL_CHILD_SCENARIO="$scenario" GOAL_CHILD_EVIDENCE="$PWD/.s3t-${version//./}-$scenario" \
      pnpm exec node extensions/goal/__tests__/child-tmux-runtime.mjs "$sdk"
  done
  for source in root child; do
    for budget in unbounded 1000; do
      flag=""; if [ "$budget" = 1000 ]; then flag=1000; fi
      env -u PI_SUBAGENT_PARENT GOAL_USAGE_SOURCE="$source" GOAL_TUI_BUDGET="$flag" \
        conda run -n codex-py312 python extensions/goal/__tests__/accounting-tui-driver.py \
        "adventure/experiments/.slice-3-tui-$version-$source-$budget" "$sdk"
    done
  done
done
```

tmux 的 macOS Unix socket 路径有长度限制，所以使用 worktree 根部短目录。PTY 与 tmux 目录须为新目录，执行后归档结果并删除临时配置；各夹具负责关闭自己启动的进程。测试脚本不需要真实模型 key，不能用真实服务替换夹具冒充本轮结果。

## API sources and limits

Context7 选 `/earendil-works/pi`，只有 main，用来定位 API，不作为固定版本结论。行动前完整阅读目标相关 extensions、SDK、custom provider、models、session format、compaction、TUI、packages、sessions 文档及必要示例，具体版本依据已安装包与固定源码。

- [Pi 0.84.3 API source directory](https://github.com/earendil-works/pi/tree/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api)
- [Pi 0.85.1 API source directory](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/api)
- [0.84.3 compaction](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/compaction.md)
- [0.85.1 SDK](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/sdk.md)

没有真实远端 provider 端到端验收。样本证明被测版本的原生映射与 SDK 行为，不保证所有私有模型的工具质量、特殊错误文案或未暴露的服务端用量。也不保证断电、SIGKILL 前未报告用量可恢复。详细未执行范围、包证据和最终资源检查见 [Spec audit](slice-3-spec-audit.md)。
