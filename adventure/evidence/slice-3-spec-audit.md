# Goal multi-provider specification audit

## Delivery boundary

这是 [Implementation #19](https://github.com/wangxuyang1221/adventure/issues/19) worker 的整体验证记录，不是协调者 Acceptance 结论。唯一完整规格为 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12)，入口 [Map #11](https://github.com/wangxuyang1221/adventure/issues/11)。本 worker 完成阶段 A 后继续阶段 B，没有再次委派。

接手 `46114b5da7556983ed67323ec8b1465d11c6c913`，保留 #17 产品 `50ff3b0de1071acec8bd3a85acf9f9b6b431cdd7`、#18 产品 `b5ef6cd717621d132398a6a446ee11d02a2aa594` 和既有独立验收。当前分支 `adventure/goal-all-providers`。本关产品差异只有受管 child 首次缺失 usage 的英文 warning；计量公式、预算规则和前两关实现没有改写。

worker 检查未发现 Spec 必需项的未验证缺口。所有适用的 Deferred verification 都能对应到下表的前序独立证据和本轮重跑或补验。真实远端 provider、全部模型、跨操作系统和断电可靠性不在本轮结论内。最终通关、Issue 关闭和 Map/Spec 交付确认仍由协调者及用户处理。

## Verification inventory

执行环境 Node 22.22.2、pnpm 11.9.0，开发 Pi 0.84.3、宿主 Pi 0.85.1，原生请求的 pi-ai/pi-agent-core 与被测 SDK 同版。依赖按 `pnpm install --frozen-lockfile --ignore-scripts` 安装，见 [install log](slice-3-install.log)。PTY 使用 conda `codex-py312` 和新增必要测试依赖 pyte 0.8.2。

| 验证层 | 每版范围 | 本关证据 |
| --- | --- | --- |
| 原生计量 SDK | 74 场景、288 请求 | [0843](slice-3-sdk-0.84.3.json)、[0851](slice-3-sdk-0.85.1.json) |
| 真实受管 IPC 进程 | 16 场景、16 child，根 67 + child 25 请求 | [0843](slice-3-child-sdk-0.84.3.json)、[0851](slice-3-child-sdk-0.85.1.json) |
| 真实 tmux 与 Pi CLI | late/pending 各 1；迟到替换隔离与根结束后预算 | [0843 late](slice-3-tmux-0.84.3-late/results.json)、[pending](slice-3-tmux-0.84.3-pending/results.json)，[0851 late](slice-3-tmux-0.85.1-late/results.json)、[pending](slice-3-tmux-0.85.1-pending/results.json) |
| 实际 InteractiveMode PTY | 根/child × 无预算/1000，各版 4，共 8 组 | [屏幕与事件索引](slice-3-accounting.md#actual-tui) |
| #17 provider 回归 | 22 场景、60 请求 | [0843](slice-3-provider-0.84.3.json)、[0851](slice-3-provider-0.85.1.json) |
| #18 terminal 回归 | 56 场景、129 请求 | [0843](slice-3-terminal-0.84.3.json)、[0851](slice-3-terminal-0.85.1.json) |
| 既有 execution 回归 | 15 场景、132 请求 | [0843](slice-3-execution-0.84.3.json)、[0851](slice-3-execution-0.85.1.json) |
| 实际包原生正常流程 | 7 入口、4 非 Codex 家族、20 请求 | [0843](slice-3-package-sdk-0.84.3.json)、[0851](slice-3-package-sdk-0.85.1.json) |
| 实际包完整根计量矩阵 | 从解压 dist 各重跑 74 场景、288 请求 | [0843](slice-3-package-accounting-0.84.3.json)、[0851](slice-3-package-accounting-0.85.1.json) |
| 仓库 check | 81 文件、1067 测试通过，2 文件/2 测试默认跳过；类型、构建、包校验通过 | [check log](slice-3-check.log) |
| 默认关闭的隔离 subagent integration | 另开隔离开关，1 项真实 tmux/Pi CLI 通过；不计入上述 1067 | [isolated log](slice-3-isolated-subagent.log) |

前序证据的独立性保留：[Slice 1 coordinator](slice-1-coordinator-acceptance.md)、[Slice 2 coordinator](slice-2-coordinator-acceptance.md)。本轮新报告没有替它们改写验收结论，也没有把前序绿灯替代本轮检查。

## Complete specification trace

以下逐项覆盖 Spec 正文及 Acceptance。表中的场景名可以在对应 JSON 的 `results` 中检索；root/child accounting 的实现方法详见 [Accounting report](slice-3-accounting.md)。

| Spec 部分 | 核对结果与证据 |
| --- | --- |
| Goal / Starting point | #17 已移除原 openai-codex 名称条件；起点与三关代码差异可追溯。现有配置和凭据仍由 Pi 负责，未创建 goal HTTP 接入层 |
| Scope：所有合规 provider | provider 的 `normal-function-tools-*` 覆盖 catalogue 风格、实际 models.json 私有模型、扩展注册 custom、Codex；新增 accounting 和包加载使用真实 Completions/Responses/Anthropic/Google adapter。支持边界按 tools/消息/终止契约，不按名单，也不声称验证所有远端 |
| Scope：root、TUI、持久化 | provider 的 `admission-rejects-rpc/print/json/ephemeral/child/no-model` 全部 0 请求；显式子会话反例保留，没有因移除 worker 环境变量而漏测；真实 managed child 不安装独立 goal 循环 |
| Behavior：复用当前模型 | provider 私有 models.json 真实载入与模型切换；native-root-compaction-branch 及 child combined 使用不同当前模型，累计不因 provider 切换重置 |
| Continuation boundaries | terminal `nonempty-text-has-no-new-limit` 连续 8 次文本后正常完成，`empty-response-guard-remains` 仍停止空续跑；execution 的 repeated/alternating、three-full-failed-bash-runs 保留既有保护。没有新增强制预算或纯文本次数限制 |
| Final outcomes：等待宿主恢复 | terminal 的 native retry 500/429 成功/耗尽、native compaction length/error 成功、recoverable-length-exhausted；真实宿主恢复产生事件，成功保持 active、无旧异常通知，最终未恢复才 blocked |
| Final outcomes：length/deferred | terminal `final-length-*`、`final-deferred-*`，保留目标且不再自动发起；排队成功消除旧结果，未添加 fetchDeferred/poll/取消异步任务或提高 maxTokens |
| Final error classification | terminal 20 组 classification 正反例，明确独立错误码及固定文案命中；裸429、billing、auth/network、含糊quota、码子串/文档提及、Codex友好429均不误判；[固定来源](slice-2-final-outcomes.md#classification-sources) 支持采用规则 |
| Final error / budget priority | terminal `final-*-budget-100`、`compaction-failure-*-budget-100`。普通 error/length/deferred 保留 budget_limited；明确账户额度可转 usage_limited。工具开关组合均验证最后 usage，没有把工具关闭当冻结 |
| Tool availability：禁用与显式恢复 | provider `tool-recovery-create_goal/get_goal/update_goal`、creation-with-disabled、reload-keeps-disabled；状态保留、实际缺失项可见、不重启工具。普通输入、模型切换、编辑、reload 不清除独立 toolRecoveryRequired，只有显式 resume 解锁 |
| Tool availability：已归属最后用量 | provider `disabled-tools-still-settle-budget` 的最后 110 和收尾 7 仍计；terminal 工具 off × 终态 × 有无预算组合仍结算 7/110/117，并保留最终优先级 |
| Token accounting：归一化公式 | native 6家族矩阵和 child 6家族，各自保存 raw/normalized；50+10+30计90，cacheRead20排除、reasoning8不重复加。Google写缓存未暴露，实际80+10+0计90，不自写mapper假造write30 |
| Token accounting：可信零与非法 | 根6家族 cache-read-only 均计0无缺口；真实Google child缓存读取计0；全零、缺失、负output有无预算继续并警告，后续有效7只加7。其余非法数字/字段由本轮正式单测和Planning47场景补足 |
| Accounting scope：来源与归属 | native-root-compaction-branch证明实际 compact/tree usage；同一个真实child combined目标合计根10+child30+compact20+tree10=70，后续30+10保留110。归属只来自生产managed直接child订阅，不采集任意工具/第三方/孙代理账单 |
| Accounting scope：冻结与恢复 | 真实Google进程10→50→60计20，resume前实际刷新50基线；`child-budget.test.ts`覆盖paused/blocked/usage_limited/complete，`commands.test.ts`覆盖预算收尾结束、停止前缓冲量、checkpoint失败和恢复。新增测试证明冻结期缺口不立即污损目标，恢复后新增量保守带缺口 |
| Accounting scope：旧目标隔离 | provider replacement in-flight、terminal replacement error/length/deferred/compaction，真实tmux late报告100确实存在但新目标不收；预算/child-budget正式测试覆盖source独立、reopen与继承，根activation fence不因resume重新接纳停前回复 |
| Budget limits and wrap-up | 6原生家族各100→110，只一次提示、2请求，保留实际超额；真实来源组合110；tmux pending root已结束且有队列时120不另开预算提示回合，child仍活着直到显式close。完成工具可以真正complete，不因预算伪造完成 |
| Usage visibility | 实际8组PTY即时warning、/goal摘要、两次get_goal和update_goal；edit/reload/resume后同目标仍7且诊断存在。缺失不成为新停止条件，原有工具/预算/最终错误条件独立生效 |
| Accounting recovery | 6家族110/100 edit/resume/reload保持budget_limited；gap场景保留预算、累计、缺口；真实child源存在订阅后继承快照但删除订阅；新目标清零、旧目标迟到不转入。`budget.test.ts`配置默认/上限及controls耗尽预算恢复单测通过 |
| Design：公开扩展接口 | 本冒险产品只改extension capability/index/scheduler/quota及类型/存储字段，Pi核心和鉴权未改。当前变更只加通知，未新增HTTP、凭据配置或用户额度matcher |
| Design：settled、generation、atomic | #18正式scheduler测试覆盖旧agent_end/settled、await期间替换、run/goal归属复核；本关双版本terminal重新走真实生命周期。budget/child-budget/storage单测覆盖根/子检查点与累计原子保存、receipt重放，既有owner/generation保护不放松 |
| Working agreement / Open questions | 英文产品copy已有授权，文档正文中文、标题英文；Issue#19正文维护A/B计划，不另存本地计划；未更改progress、main、Pi核心、全局配置，不PR/合并/发布；Map/Spec留open待用户确认 |
| Acceptance：交付说明 | README与正式支持文档列出全部当前边界；旧descendant错误公式和完成后迟到追记已校正；实际package包含新说明并通过双版本加载。无必需项以“未运行”代替 |

Spec 的 Acceptance 清单均在表中展开，不仅按标题打勾。尤其将“工具可用性”和“已经归属用量”分开验证，将“缺口落盘”和“用户实际可见”分开验证，将“原生映射”和“真实远端模型”分开陈述。

## Deferred verification audit

| 延期来源 | 原延期项 | 本次结论 |
| --- | --- | --- |
| Spec / implementation-slices ownership：#17 | 非Codex正常入口、function tools、会话准入、工具禁用/显式恢复/队列/模型切换/reload、最后usage | #17已独立验收，本关双版本provider22场景再次通过 |
| Spec / implementation-slices ownership：#18 | 最终恢复时序、length/deferred、额度反例、旧终态隔离、工具/异常/预算组合 | #18已独立验收，本关双版本terminal56场景再次通过 |
| Spec / implementation-slices ownership：#19 A | 原生映射、跨来源、真实child、110、冻结、缺口、TUI | 本关native74、child16、tmux2、PTY4/版及正式单测完成，见阶段A报告 |
| Spec / implementation-slices ownership：#19 B | 同一worker审计、实际包、文档、check、清理 | 本报告、实际解压包双版本流程、305文件内容核对、check与清理记录完成 |
| [exception-policy-review](exception-policy-review.md#result-and-deferred-verification) | 整个静态异常/工具/旧事件场景表，需要实际SDK而非仅模拟 | provider+terminal+execution实际SDK回归；异常异步存储竞争由正式单测补充。未用Planning推演替代实现 |
| [budget-policy-review](budget-policy-review.md#deferred-verification) | 去名单后根/压缩/摘要/直接child、不同provider组合 | 实际native summary与真实child combined同一目标，计70→110 |
| 同上 | 两版原生usage正常/缺失、软收尾/最终错误 | native各74、terminal各56；raw与归一化证据齐备 |
| 同上 | 工具关闭、最后usage、预算、恢复、旧目标迟到 | provider/terminal组合与真实tmux late/pending重跑 |
| 同上 | 根/child missing提示，编辑/恢复/reload后查询与工具诊断 | 8组实际PTY+真实get_goal，新增警告TDD；旧缺口不会消失 |
| 同上 | 正式公式、冻结、软保证和支持范围一致 | 新正式support随包交付，README与历史验收文档纠错/标注 |
| #17/#18 worker及coordinator limits | 当时未执行的PTY、原生adapter、真实child、最终包 | 由本关以上证据补齐；前序历史“未执行”保留为当时事实，不改写旧Acceptance |
| terminal-contract / remaining-execution-boundaries | 静态length/deferred/纯文本/队列结论需要实现矩阵；不确定私有provider特殊结果 | 前者由terminal/execution完成；后者属于合规契约支持限制，不宣称远端全覆盖或异步取回能力 |

历史基础建设文档里的 SIGKILL/断电、全平台、真实模型质量、已放弃方案等限制，不是本次 Spec 的新增必需验收。旧 planning、handoff 和 todo 保留其时间语境，不全仓翻译或改写历史计划；本次随包交付的当前说明没有继续宣称 input+output 或完成后迟到追记。没有将必需项改名为限制来跳过。

## Package and document verification

在 worktree 的 `adventure/experiments/.slice-3-package` 实际执行 `pnpm pack`，通过 prepack 构建，再用 tar 解压。没有发布 registry。记录见 [pack log](slice-3-pack.log)、[artifact manifest](slice-3-package-artifact.json)。

- 归档 306 文件，416196 bytes，SHA-256 `88cadd23a22df27c42184a0b08fc2b5ca493cdad5088ebb99c3b361a12a65412`。
- 7 个 extension入口、1个主题、goal及其他必要许可证/NOTICE/UPSTREAM齐全；新增 `docs/goal-provider-support.md` 在白名单和包中。
- 包中没有 `adventure`、测试夹具、node_modules、prototypes或临时配置。`package-artifact.mjs` 的实际tar断言与仓库 `package:check` 同时核验入口和排除边界。
- [305个文件比对](slice-3-package-build-match.json) 确认除pnpm生成的manifest外，包内每个文件与最终工作区的生成构建和正式文档逐字节相同。`dist`只由build生成。
- [`package-provider-runtime.mjs`](../../extensions/goal/__tests__/package-provider-runtime.mjs) 在隔离agent settings中把实际解压路径设为Pi package，由目标版真实DefaultResourceLoader发现全部7入口。Completions/Responses/Anthropic/Google各实际创建、get_goal、暂停、显式resume、完成，20请求/版，无网络调用。
- 将 `GOAL_PRODUCT_ROOT` 指向解压路径，完整原生根计量矩阵另跑两版，报告保留该路径。不是只import源码或验证文件存在。

包说明缺失先由增强的 `package:check` 触发 [Red](slice-3-package-red.log)，加入明确files条目后 [Green](slice-3-package-green.log)。没有通过放宽排除规则把证据或测试打进包。

正式变更为 README、新 `goal-provider-support.md`、`goal-descendant-acceptance.md`、`goal-budget-acceptance.md`、`goal-integration-acceptance.md`、`goal-parity-acceptance.md`。其中descendant已直接改正公式和完成后归集描述；其他历史验收保留轮次并在首段标明当前边界。Codex-only的codex-compact/fast-mode本来就有各自产品范围，不因goal扩展支持而误改。

## Reproduction

阶段A完整命令见 [Accounting reproduction](slice-3-accounting.md#reproduction)。以下重现跨关回归和包交付；SDK路径沿用该段定义。

```bash
env -u PI_SUBAGENT_PARENT pnpm run check
env -u PI_SUBAGENT_PARENT PI_SUBAGENT_ISOLATED_INTEGRATION=1 \
  pnpm exec vitest run extensions/subagent/__tests__/isolated-integration.test.ts

for sdk in "$SDK_0843" "$SDK_0851"; do
  version=$(node -p "require('$sdk/package.json').version")
  env -u PI_SUBAGENT_PARENT GOAL_PROVIDER_EVIDENCE="adventure/evidence/slice-3-provider-$version.json" \
    pnpm exec node extensions/goal/__tests__/provider-runtime.mjs "$sdk"
  env -u PI_SUBAGENT_PARENT GOAL_TERMINAL_EVIDENCE="adventure/evidence/slice-3-terminal-$version.json" \
    pnpm exec node extensions/goal/__tests__/terminal-runtime.mjs "$sdk"
  env -u PI_SUBAGENT_PARENT GOAL_EXECUTION_EVIDENCE="adventure/evidence/slice-3-execution-$version.json" \
    pnpm exec node extensions/goal/__tests__/execution-runtime.mjs "$sdk"
done

mkdir -p adventure/experiments/.slice-3-package
pnpm pack --pack-destination adventure/experiments/.slice-3-package
tar -xzf adventure/experiments/.slice-3-package/pi-ext-0.1.0.tgz -C adventure/experiments/.slice-3-package
pnpm exec node extensions/goal/__tests__/package-artifact.mjs \
  adventure/experiments/.slice-3-package/pi-ext-0.1.0.tgz adventure/evidence/slice-3-package-artifact.json
package="$PWD/adventure/experiments/.slice-3-package/package"
for sdk in "$SDK_0843" "$SDK_0851"; do
  version=$(node -p "require('$sdk/package.json').version")
  env -u PI_SUBAGENT_PARENT pnpm exec node extensions/goal/__tests__/package-provider-runtime.mjs \
    "$sdk" "$package" "adventure/evidence/slice-3-package-sdk-$version.json"
  env -u PI_SUBAGENT_PARENT GOAL_PRODUCT_ROOT="$package" GOAL_ACCOUNTING_EVIDENCE="adventure/evidence/slice-3-package-accounting-$version.json" \
    pnpm exec node extensions/goal/__tests__/accounting-runtime.mjs "$sdk"
done
git diff --check
```

实际包tarball和解压临时配置在归档manifest、SHA和加载结果后删除。复现可生成新包，摘要可能因打包元数据变化不同，入口、内容与流程断言仍须通过。不要启用读取真实用户模型的 `PI_SUBAGENT_INTEGRATION=1` 作为离线复现的一部分。

## Cleanup and unexecuted scope

[Cleanup record](slice-3-cleanup.json) 保存本关证据中的PID检查、tmux socket结果、临时目录与端口检查。真实child通过close退出，PTY根正常退出；tmux夹具最后kill自己的隔离server并确认pane/server消失，socket不可用。SDK临时目录在finally删除，实际包和早期PTY调试目录也已删除。

本任务未留下后台测试进程或监听端口。工作区内既有Pi/MCP宿主不是本任务启动的服务，未停止，也未把其配置写入证据。必要依赖pyte按用户允许安装到既有conda测试环境，没有改Pi全局配置、真实凭据或用户模型设置。

明确未执行：

- 全部真实远端provider/模型端到端与付费调用，真实OAuth/服务端私有协议、私有额度文案穷举。离线样本不是这些结论。
- 默认在线subagent integration。默认check跳过2项，其中隔离integration已另开开关独立通过；在线项仍未运行，未计为通过。
- 本关未重新运行Windows/Linux真实TUI或tmux，当前实际平台为macOS。通用测试不等于所有平台实测。
- 断电零丢失、强杀前未报告用量恢复、未暴露失败请求费用、孙代理或任意工具内部账单、硬token/金额封顶。这些不在确认范围或无法由观测机制保证。
- PR、合并、部署、registry发布、main变更、Pi核心修改、Issue关闭及用户最终交付确认。

上述限制没有影响表中必需的本地双版本SDK、原生映射、实际进程/TUI、包和Spec审计。最终 `pnpm run check`、包验证与 `git diff --check` 通过，无遗留已知失败断言。本报告及提交交协调者独立核验。
