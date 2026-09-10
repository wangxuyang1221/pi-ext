# Goal integration acceptance

## Historical scope

本文保存 #10 的历史验收及当时的限制，不作为当前 provider 支持清单。当前 goal 不按 provider 名称设白名单，计量包含 cacheWrite，完成后迟到子代理报告不追补。当前说明见 [Goal provider support](goal-provider-support.md)，多 provider 的完整交付证据见 [Spec audit](https://github.com/wangxuyang1221/pi-ext/blob/adventure/goal-all-providers/adventure/evidence/slice-3-spec-audit.md)。历史 `.scratch/` 引用不是本次 #19 必需证据入口。

## Status

[Implementation level #10](https://github.com/wangxuyang1221/adventure/issues/10) 的工作区集成证据已完成，结果待协调者独立验收。依据 [spec #3](https://github.com/wangxuyang1221/adventure/issues/3) 全文及 C1 至 C13。未提交、推送、部署或写 GitHub，不关闭 Issue。

最终交付同时要求 `.scratch/goal-10/finalization.json` 中 `passed: true`。该文件核验最终封包、安装结果、进程清理与检查点；不存在时不可仅凭本文认定本轮交付已收尾。原始日志和可恢复副本只保存在本地仓库，不随发布包分发。

## Baseline and changes

HEAD 为 `3972c9e1b6693021fd79d99a0acb19fb62f0260d`，加未提交 #4 至 #9 及研究/测试产物。`.scratch/goal-10/baseline.json` 核验 #9 manifest 的134文件，仅协调者已更新的 `docs/goal-ui-acceptance.md` 不同。没有用旧快照覆盖工作区。

本关不改变生产 goal、codex-ui、subagent 的源码或状态语义。主要交付：

- `integration-matrix.py` 统一隔离环境、命令日志与进程树记录；保留各切片原断言。
- `integration-runtime.mjs` 经原生 package discovery 同时加载七个发布入口，组合验证首回复前长目标恢复、中断、内容继承编辑、重开、预算软收尾及源记录隔离。
- `package-tui-driver.py`、`package-tui.mjs` 通过两版本真实 Pi CLI 安装本地解包目录，再用实际 InteractiveMode PTY 检查 CodexEditor、CodexFooter、goal 和 subagent 工具。
- `version-build.mjs` 针对实际 Pi 0.85.1 声明单独编译七个扩展；`package-artifact.mjs` 验证实际 tgz 的文件、入口、版权与许可。
- `budget-tui-driver.py` 改为等待 InteractiveMode 的重载完成通知后再发键，而非只等待过早的 `session_start`。`acceptance-tui.mjs` 增加可选 codex-ui/subagent 同时加载矩阵，默认场景不变。
- `package.json` 补 goal 元数据、#8/#9/#10 报告和 NOTICE；混合许可标识改为 `MIT AND Apache-2.0`。`scripts/check-package.mjs` 防止后续漏包。README、goal UPSTREAM 与本地 spec/slices 修正过时状态，保留历史报告原始证据。

可恢复快照为 `.scratch/goal-10/final-checkpoint/manifest.json`，同目录含 `files/`、`tracked.patch`、`status.txt`。manifest 记录当前发布相关 modified/untracked 文件的 SHA-256，不授权覆盖后续写入。

## Environment and evidence limits

macOS，Node.js 22.22.2，pnpm 11.9.0，TypeScript 5.9.3，tmux 3.6b。Pi 0.84.3 为仓库实际依赖；0.85.1 为宿主安装包，路径记录在各 matrix.json。未替换仓库开发依赖或 lockfile。

所有测试 HOME、agent、session、TMPDIR、安装依赖 store 和 tmux socket 位于仓库隔离目录。没有读取真实剪贴板、真实 session 或真实凭据，没有付费模型调用。原生 Codex adapter 解析构造的离线 SSE，另一些调度场景使用 faux provider；两者均不是在线服务或真实模型遵从证据。模型创建须明确授权、一般 blocker 三轮审计及完成审计仍属提示约束，不是形式证明。

Context7 `/earendil-works/pi` 只提供 main，未据此声称固定版本覆盖。本轮完整读取安装包 README、extensions、SDK、TUI、session-format、packages、custom-provider、compaction 文档及相关 SDK 示例，以全文和 `.scratch/goal-10/pi-doc-diff.txt` 核对两版本差异。公开入口依据 [Pi package docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)，固定行为以实际发布包及运行结果为准。TypeScript Context7 查询 `/microsoft/typescript/v5.9.3`，编译日志另确认真实声明路径。

## Verification matrix

以下不是复用 #8/#9 的旧 check。`.scratch/goal-10/matrix-v2/matrix.json` 记录本轮60次新执行、命令、环境、PID、退出码和时长，全部退出0。每版30次分别为6个 SDK/进程入口、14个调度 PTY、4个预算 PTY、2个内容双阶段 PTY、4个真实 tmux 场景。

### V1: Scheduling and input

默认 UI 两版本各14场景，证据 `.scratch/goal-10/matrix-v2/{0843,0851}-tui-<scenario>/`。每目录 `run.log` 与 `evidence/events.jsonl`、`terminal.ansi` 保存实际结果。

再同时加载 goal、完整 codex-ui 和 subagent，两版本各14场景，全部通过。证据 `.scratch/goal-10/codex-matrix/{0843,0851}-<scenario>/`，汇总 `.scratch/goal-10/codex-matrix-run/command/run.log`。不是只检查 footer 字符串而忽略自定义 editor 的输入路径。

| Scenario | Result |
| --- | --- |
| `c11` | 只有1次模型请求；失效自有续跑不发出；目标ID、paused和已有 assistant 历史保留；实际键入追加文字可从 editor 找回。其他扩展尚未处理消息被清除是限定的获准副作用。 |
| `retry-c12` | 原生 retry 等待中实际 Esc 停止，首个 settled 为 blocked 且只有1次调用；显式 resume 后共3次并 complete，保留目标和统计。 |
| `stream-interrupt`、`stream-pause`、`tool-interrupt` | 流式请求或真实 bash 执行中的中断、显式 pause 均 paused，不套用 C12；恢复成功。 |
| `edit-cancel`、`replace-cancel`、`retry-dialog` | 原生编辑、替换确认和无关确认的 Esc 仅关闭弹窗，不误 pause，不替换目标。 |
| `input-steer`、`input-followup` | 实际终端输入与其他扩展排队消息进入模型 context，分别4/5次调用，无旧自有请求时不套用 C11 清队列。 |
| `compact-success` | Pi 原生压缩成功后继续，共4次调用，无重复循环。 |
| `compact-failure`、`compact-cancel`、`compact-manual` | 失败为 blocked，真实取消为 paused；新输入及手动压缩不被永久阻断，显式 resume 后完成，各6次调用。 |

C11/C12 例外未扩大，没有生产 provider wrapper、editor 重建或 Pi 核心修改。

### V2: Accounting and direct children

每版 `budget-runtime/evidence/results.json` 有11个通过场景，使用该版本实际 Codex adapter。正常预算100保存实际110，该历史样本的 cacheWrite 为零；当前公式为 `input + output + cacheWrite`，排除 cacheRead 且 reasoning 不重复、创建中途基线、重复receipt、缺失usage、错误及预算优先级。预算 PTY 每版 `soft/baseline/quota/interrupt` 4项全部通过，包含摘要、编辑取消、reload、保留预算/统计及 usageIncomplete。

真实 tmux 每版 `budget/duplicate/late/pending` 全部通过，证据 `.scratch/goal-10/matrix-v2/{0843,0851}-tmux-<scenario>/evidence/`。root为真实SDK绑定TUI，child为真实CLI InteractiveMode。实际 TmuxRuntime 创建 pane、粘贴投递、捕获输出、检查存活并关闭，不用IPC冒充tmux。

- budget/duplicate 为根30加child100等于130；重复response不计200，预算100后只注入一次收尾，仍在运行的child不被预算强杀。
- late 中旧报告实际写出100，但根目标替换后最终只有新目标10。
- pending 中根已结束并排队自有请求，再释放child报告，最终120、budget_limited、只有2次根请求，无新收尾回合。
- wait由timeout转settled；重复read不重收；显式close无isError，状态和pane消失，报告留给根检查点；reload不重复收费。子端没有goal和subagent编排工具。

C13 只覆盖 root → direct child。孙代理、第三方或嵌套代理不在验收范围，不为测试开放嵌套。IPC旧证据只作历史补充，本关没有把未重跑IPC写为本轮通过。

额外显式执行 `PI_SUBAGENT_ISOLATED_INTEGRATION=1 pnpm exec vitest run extensions/subagent/__tests__/isolated-integration.test.ts`，1项通过。日志 `.scratch/goal-10/isolated-subagent/command/run.log`，覆盖已提交subagent修复的真实Pi/tmux投递代次、steer/follow-up、快速完成、失败与close。

### V3: Storage and combined lifecycle

两版本 `runtime.mjs`、`lifecycle-runtime.mjs`、`processes.mjs` 均在本轮重新执行。日志在 `matrix-v2/<version>-<entry>/run.log`。首回复前权威保存、无JSONL恢复唯一接管、已有会话恢复、镜像失败补写、写入失败不伪成功、tombstone、并发写者及异常退出通过；tree、普通fork/clone、显式继承、reload、切换与旧context隔离通过。异常退出不等于断电零丢失。

新增组合场景通过真实安装包同时加载全部七扩展，两版本均通过，初次已通过证据 `.scratch/goal-10/package-{0843,0851}-v2/runtime/results.json`，最终封包复验见 Final package 一节。UI交互在此为SDK回调，不冒充PTY。

1. 不支持provider下创建超过4000 Unicode的长目标，预算默认100，原生session尚未落盘；关闭并在新runtime显式恢复，仍是一份record，正文、预算与目标身份保留，零模型调用。
2. 暂停后切到离线Codex adapter，resume。首响应记60，第二请求运行中abort，保存paused、60及usageIncomplete，不虚构中断usage。
3. 显式clone复制paused目标、60和完整内容metadata，持久化继承门禁。编辑child生成新包，源正文不变；关闭重开不触发请求。
4. 显式resume释放门禁，新增100加收尾10，child最终170/100、budget_limited，只出现一次预算提示。返回源会话仍paused、60和原正文。总共4次离线请求。

### V4: Tools, content and UI

全仓check覆盖严格schema、工具授权状态边界、状态迁移、完整轮次bash失败、提示边界和附件安全；`execution-runtime.mjs` 在两版本重新执行。不是把工具描述中的语义规则当运行时验证器。

每版 `content-runtime/evidence/results.json` 通过4000/4001非BMP字符工具调用边界。4001工具失败且不创建，4000成功且不物化，外层拒绝被吞掉的工具错误。

默认UI和codex-ui两版本共4组真实PTY，每组创建和重开两个进程。证据 `matrix-v2/<version>-content-tui-ui{0,1}/evidence/`。原生Ctrl+V的clipboard数据源替换为本地PNG桩，所有真实clipboard方法禁止访问；实际Pi粘贴、临时文件生成、editor插入和附件选择都运行。临时源删除后持久图片仍由原生read返回image块；重开编辑完整正文、保存新包且旧包仍可读。原editor/footer对象身份保持。

正文1 MiB、最多32图、单图20 MiB为既有防御边界，工具仍4000 Unicode。1 MiB单次测量：0.84.3物化11.47ms、反解1.27ms、进程峰值RSS187,990,016字节；0.85.1分别10.82ms、1.22ms、226,115,584字节。RSS含SDK与前置工具测试，不是模块独占成本，也无跨机器性能承诺。状态渲染不读取内容文件；成功旧内容包保留，空间随保存次数增长，备份须包含完整goals目录。

### V5: Builds, installation and checks

- `.scratch/goal-10/final-check/command/run.log`：`pnpm run check` 通过，77文件通过、2默认跳过；919测试通过、2默认跳过；类型检查、七扩展构建和包检查通过。收尾后的最终复跑位于 `.scratch/goal-10/final-check-v2/command/run.log`。
- 默认跳过在线subagent integration和独立开关isolated integration。前者未执行，后者已单独运行通过；没有把默认跳过写成通过。
- `.scratch/goal-10/build-0851/results.json`：七扩展对实际0.85.1的pi-coding-agent/pi-ai/pi-agent-core/pi-tui声明重新编译，日志记录实际声明路径，全部成功。所有生成JavaScript逐字节等于0.84.3发布构建。只向隔离outDir构建，没有手改dist或替换开发依赖。
- 初次发布包292文件，经真实`pnpm pack`及prepack构建产生。包内有七入口、goal全部运行模块、MIT根LICENSE、Apache-2.0 LICENSE、适用OpenAI NOTICE及UPSTREAM修改说明，无tests/scratch/node_modules。
- 在仓库内解包并复制当前lockfile，实际 `pnpm install --frozen-lockfile --prod --ignore-scripts` 安装生产依赖，store也在隔离目录。`node_modules`只有直接生产依赖入口，不靠把开发依赖装进发行包过关。
- 两版本实际`pi install <解包目录> --no-approve`成功，原生CLI把路径相对agent settings保存。后续默认ResourceLoader从安装记录发现全部七入口，没有用手动factory代替安装发现。
- 每版另跑实际PTY，包内CodexEditor和CodexFooter真实建立，goal创建/暂停后footer含`Goal: paused`，主端goal/subagent工具可用，零模型请求、零网络尝试。此烟测不声称调用过远程MCP或Codex remote compaction服务。

## Final package

最终包位于 `.scratch/goal-10/final-release/pi-ext-0.1.0.tgz`，SHA-256、字节数、文件清单和许可断言见同目录 `artifact.json`。最终两版本实际安装、组合SDK及PTY结果分别位于 `.scratch/goal-10/final-package-{0843,0851}/results.json`；各目录包含独立 `runtime/` 和 `tui/`、CLI安装日志、事件、ANSI与PID。

安装命令见README的本地工作区打包流程。此包不含本地原始模型夹具或session证据，也未上传外部注册表。版本保持0.1.0，只有工作区及tarball是本轮代码基准，不能把GitHub现有HEAD当作已包含goal。

## Corrections and red evidence

- `.scratch/goal-10/package-red.log`：新增发布必需文件断言后，旧清单因缺`extensions/goal/NOTICE`退出1。补NOTICE、报告和清单后，`package-green.log`通过；实际tarball检查继续验证内容，不只看package.json。
- `matrix/0843-budget-tui-soft` 的初次运行25秒超时。事件已记录预算110和第二次ready，终端显示reload完成，但驱动在完成前已发送退出命令。只修复测试发送时机，保留调用数、预算、状态和reload断言。`matrix-v2`重新执行全部60项并通过，未把超时目录作为成功证据。
- `cross-0843`和`cross-0843-v2`是新增SDK夹具调试失败，缺theme/getTheme导致扩展错误；补完整UI回调后`cross-0843-v3`及双版本安装包组合运行通过。所有错误必须为空，不通过吞错绕过。
- `package-{0843,0851}`的首次CLI断言错把保存路径要求为绝对路径，实际CLI合法保存相对路径。修正为相对settings解析后，`package-*-v2`通过，没有改生产安装行为。

没有发现需要交回#9的生产反例。本轮没有行为修复，也没有删除测试、降低业务断言或扩大C11/C12/C13。

## Attribution and cleanup

原文来源为固定提交的 [Codex LICENSE](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/LICENSE) 和 [NOTICE](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/NOTICE)，本轮重新联网读取。Apache-2.0完整文本、OpenAI版权、复制模板来源和TypeScript适配修改说明均随包保留。Ratatui不属于本次移植，按上游LICENSE第4节排除不适用声明，未把其代码纳入goal。

`.scratch/goal-10/cleanup.json` 汇总本轮记录PID、已退出/复用PID、TCP监听与独立tmux socket检查。不停止其他会话进程。原始测试证据和所有旧工作区产物保留，没有写真实HOME、全局Pi设置或系统剪贴板。最终差异检查日志为 `.scratch/goal-10/diff-check.log`。

## Coordinator writeback

建议协调者逐项核验后回写：

- V1通过双版本默认UI与codex-ui/subagent组合各14项真实PTY，C11/C12保持窄边界。
- V2通过双版本11项预算SDK、4项预算PTY与4项真实tmux单层归集，并验证已提交subagent投递修复。
- V3通过双版本持久化/生命周期/异常退出，新增安装包跨恢复、中断、继承内容编辑与预算的组合流程。
- V4通过全仓工具/状态/安全测试及双版本Unicode和原生粘贴双阶段PTY。
- V5通过双版本构建、实际安装/发现/加载、完整check、混合许可和清理。最终以finalization.json及协调者独立复验为准。

#1/#3/#10旧暂停、#9未完成、#7未验收等段落应标记为历史或移除过时当前状态。#10仅由协调者独立核验后关闭。受控provider结果不升级为真实在线服务保证；C13不覆盖孙代理，其他provider、非交互goal循环、断电零丢失、持续磁盘故障下零用量丢失和自动内容垃圾回收均不在本次承诺内。
