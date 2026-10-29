# Working and token-rate implementation evidence

## Scope

本记录对应 Implementation #63 的开发自测。基线为 `845e2f9c3bab4fac13e455b1c756bd3917e8a529`，工作区为 `.scratch/worktrees/pi-animation`，分支为 `adventure/pi-animation`。#64、#65 的验证系统工作与 #66 的独立验收仍属后续关卡。

实际运行环境为 Node 22.22.2、pnpm 11.9.0、Pi 1.4.0、Conda `codex-py312` 中 Python 3.12.13。所有 pnpm 和提交命令设置 `pnpm_config_verify_deps_before_run=false`。全局 Pi、原型目录和用户运行实例未修改。没有创建 PR、推送、合并或部署。

## Implementation

生产入口为 `extensions/codex-ui/src/index.ts`。WorkingSession 监听公开生命周期和 message 事件，挂载独立 widget，并包装真实 CodexFooter。两个组件共享一个 32ms 定时器，各自注册 factory 实际返回的组件。原版缺少 `registerTextRegion` 时调用正常刷新。开始、结束和移除行强制正常刷新，防止高度变化遗漏。标题调度保持原实现，原生 Working 仍隐藏。

Working 持续至 `agent_settled`，不在 `agent_end`、输入等待或 Esc 按键时结束。重复 start 保留开始时间和唯一调度器；replacement、reload、shutdown 释放句柄与定时器。旧定时回调通过 generation 拒绝，旧响应数组通过身份拒绝。footer 保留状态字段和 goal 后续行，速率仅占第一行右侧。估算口径、精度及 100ms 桶边界见[生产说明](../../../docs/codex-working-rate.md)。

本关保留 coding-agent 的原有摘要补丁。pi-tui 补丁内部增加全屏文本校验结果复用，字符串或宽度变化重新验证，合成得到其他字符串仍裁剪；#61/#62 的 API 和回退契约不变。没有引入新等待接口、生产 F 键或模拟速率。

## Provider contract

读取了固定依赖的 `pi-ai/dist/api/openai-responses-shared.js`、`api/anthropic-messages.js`、`providers/faux.js` 及 agent-core 的 `agent-loop.js`。真实 provider 使用共享 partial，宿主传递浅复制的 message，不能把 start 对象当历史快照。faux 在块之间和 final 重建 content 数组，但保留本响应 usage 对象身份。实现只用其身份关联响应，不使用 usage 数值计算速率。

`token-rate-provider.test.ts` 经过真实 OpenAI Responses normalizer 和 SDK event queue，先生产完再消费，刻意覆盖 partial 已包含后续内容的情形。另一个测试运行真实 faux stream，覆盖数组替换。delta 按增量计量，块 end 与 final 补齐缺失量；完整无 delta 只计一次，final args 不二次累计。签名、redacted thinking、输入和工具结果不进入计量。100000 个增量的测试让全文 getter 直接抛错，证明 delta 和动画帧没有取累积正文。

状态只保留 20 个时间桶、当前响应每个块的计数和 JSON 解码状态；不保存文本片段，final 后清空块表。旧身份用弱引用记录，不延长宿主消息寿命。计量精度是 UTF-16/4 的估算，不能把结果当 tokenizer 或账单数据。

## Verification commands

所有命令从本 worktree 根目录执行。原始日志、ANSI、操作与公开事件保存在 `.tmp/working-token-rate/`；既有回归保存在 `.tmp/test-results/`。

```bash
pnpm_config_verify_deps_before_run=false pnpm test extensions/codex-ui/__tests__/token-rate*.test.ts extensions/codex-ui/__tests__/working*.test.ts extensions/codex-ui/__tests__/json-units.test.ts
node scripts/local-refresh-install.mjs --pack
conda run -n codex-py312 python scripts/local-refresh-pty.py <new-evidence-directory> --working --mode <regular-or-fullscreen> --cli <installed-pi> --extension <installed-codex-ui>
conda run -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/cli.py regular
conda run -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/cli.py fullscreen
conda run -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/headless.py
pnpm_config_verify_deps_before_run=false pnpm run check
```

原版 PTY 命令另外加 `--original`。安装驱动分别保留补丁版和原版锁文件及 probe。先冻结安装，再安装本次 `pnpm pack` 产物，再次冻结安装并逐字节比对发布的生产 JS。`strict-dep-builds=false` 仅用于 pnpm 11 的 ignore-scripts 占位提示，依赖构建脚本没有运行。

## Real PTY paths

生产 provider 夹具只替代远程模型和摘要结果。权限来自生产 permissions 扩展，批准后执行真实 bash 并核对 `tool-proof.txt`。取消通过真实 Esc 传播到正在执行的 shell，检查 `should-not-exist.txt` 不存在。429 触发宿主 retry，context overflow 触发宿主自动压缩，记录 `reason=overflow`、`willRetry=true` 及后续恢复。不是直接设置 session 内部状态。

旅程还覆盖 idle/active input dialog、overlay 焦点、草稿和输入位置、32/40/100/12/120 列、light/codex-pi、Ctrl+O、最终错误、双向模式切换、真实 `/new`、reload 及 `/quit`。权限和 dialog 等待期间检查 Braille 与灰度变化；约两秒没有样本后显示 `-- t/s`。结束后 Working 和 rate 都消失，goal 行保留。

首次发布安装记录为 `.tmp/working-token-rate/published-installation.json`。四个入口的 `published-{patched,original}-{regular,fullscreen}` 中，原版两模式与补丁版全屏通过；补丁版普通模式首次在并发全量测试时光标断言失败，独立重跑 `published-patched-regular-2` 通过。两次记录均保留，不把失败批次删去。footer 分拆后再次打包，安装根为 `.tmp/local-refresh-install-1CfaxF`，包 SHA-256 为 `5fd982e1f4ddb523c394d04e4405b21c9b5c70ebdf50fcb076899fb0b5d215ca`。该阶段 `final-{patched,original}-{regular,fullscreen}` 四个入口均通过 53 项检查，正常 `/quit` 返回 0，运行目录删除且进程组为空。

既有 CLI 回归记录为 `codex-ui-cli-regular-1793247680134449000`、`codex-ui-cli-fullscreen-1793247680106806000`，headless 为 `codex-ui-headless-1793247681612027000`。两个 CLI 各通过 124 项断言。codemode 的共享 helper 两模式及 goal-footer 四入口也通过，局部刷新示例两模式回归通过。正式旅程通过不等于物理终端像素、拖选和系统剪贴板通过，这些本次未测。真实 Esc 命中 Write/Edit 某个文件系统 await 的旧边界仍未验证；本关验证的是可观察的 bash 取消。

## CPU protocol

正式 CPU 驱动使用生产 Working、CodexFooter、TokenRate、真实 AgentSession 上下文统计和真实 UserMessageComponent/AssistantMessageComponent 历史。每帧处理正文、thinking、参数增量，包含 final 补齐；同一内容、主题、尺寸、频率和帧数比较原版正常刷新与补丁局部刷新。

120×40，0/200/1000 对历史。同步测量预热 50 帧，三轮各 7×320 帧，批次交替顺序，计入 process user+system CPU。200/1000 对纯动态帧要求下降至少 30%；正常内容更新和未接 API 路径要求额外中位数不超过 `max(基线10%, 0.1ms/帧)`。32ms 原生调度单独记录，不混入同步中位数。终端模拟器和远程模型 CPU 不在此进程测量范围。

早期 `cpu-baseline-regular.json` 使用固定上下文 getter，仅作开发记录。发现它漏掉真实 footer 统计成本后，更换为 SDK session，保留 `cpu-real-context-before.json` 与 `cpu-real-context-fullscreen-before.json`。两模式初测通过。随后完整三轮在全屏 200 对历史均失败，下降分别为 25.95%、25.79%、26.93%，不能以初测替代最终结果。最终测量改用 codex-pi/truecolor、会话与屏幕完全相同的历史正文、fast/permissions 及结构化 goal 的两行，使用最后一次发布安装的原版宿主作基线。三轮失败保存为 `cpu-{regular,fullscreen}-{1,2,3}.json`。定位到每帧重复读取未变化的会话投影后，新增按只追加分支、模型与窗口变化的上下文读取器，两侧比较均使用此生产优化。虚拟模型保留实时路径，避免对 live agent routing 作错误缓存。仅上下文缓存后的三轮全屏 200 对历史仍失败，保存为 `cpu-optimized-*`，原生调度补测为 `cpu-native-*`。V8 profile 显示热点为 `truncateToWidth`，生产 footer 每次速率变化重新裁剪整行及 goal 两行。最终分离 goal 缓存；已按列分配好空间的 footer 和能放下的固定 Working 行直接返回，只有窄屏走原裁剪。最终 `cpu-final-*` 保留全部绝对值、波动和失败批次。组件优化后的三轮有两轮通过、一轮全屏 200 对失败，全部保存为 `cpu-final-*`。随后在 pi-tui 补丁内消除重复宽度验证，正式复测保存为 `cpu-validated-*`。

## Failures and corrections

| Record | Finding | Correction |
| --- | --- | --- |
| red-sampling / red-arguments / red-working / red-lifecycle | 新行为尚未实现时对应断言失败 | 逐个实现后跑同一契约；另保留 provider 导入错误的无效红灯，不算行为证据 |
| regular-1 | 流式正文增高时驱动错误要求绝对光标行不变 | 改查编辑器内的列与草稿及真实插入结果 |
| regular-2 | 命令文字与 Enter 同次发送触发选择器行为 | 分开发送；初始权限由公开环境配置设为 default |
| regular-3 | tool_execution_start 在权限批准前发生 | 等待真实 shell update 标记再取消 |
| regular-4 | 小上下文使旧 threshold compaction 混入 overflow 断言 | 扩大 fixture context，按新的 compaction 事件计数检查 |
| regular-5 | 模式选择 Enter/Esc 一起发送导致驱动断言失败 | 分开发送真实按键；regular-6 全旅程通过 |
| mutator-first | 共享依赖 overlay 可能共用 Vite 缓存 | 停止本次运行，增加独立 configLoader runner 和禁用测试缓存的配置 |
| mutator-isolated | Unicode 分片时机、40列边界、非零开始时间、旧回调等断言不足 | 增补行为断言，删除冗余生命周期 guard；复测保留等价变异说明 |
| cpu-fullscreen-1/2/3 | 三轮 200 对历史下降仅约 26%，共同成本是每个动画帧重复统计未变历史 | 先写真实 SessionManager 分支变更的红灯测试，再按分支和模型缓存；两侧使用同一生产优化，原预算不变 |
| cpu-optimized-fullscreen-1/2/3 | 单独缓存上下文后，相对收益仍不足；两侧共同变快，说明首次定位不完整 | V8 profile 查明组件裁剪热点；拆开 goal 缓存并避免裁剪已知能放下的行，保留所有窄屏断言 |
| green-render-cost | index 测试的 context 缺少公开 sessionManager 字段 | 夹具改用真实 SessionManager，生产代码保持正式接口契约 |
| cpu-final-fullscreen-2 | 组件优化后仍有一轮 200 对历史低于预算 | 全屏复用同宽、同字符串的文本校验；归一化后直接保留已验证行，合成变更照常裁剪。追加共享可变数组、样式、Thai/Lao、超宽和控制序列回归 |
| patch-commit | pnpm 11 因忽略依赖构建脚本返回 1，补丁已生成 | 用 ignore-scripts 和 strict-dep-builds=false 完成 patch-commit；移除自动生成的 allowBuilds 占位，没有执行依赖脚本 |
| check / reasoning-regression | 三条旧测试假定完全无 widget，另有动态时钟使字节对比不稳定 | 保留正文/重绘断言，明确只有 Working widget；固定比较时钟，settled 时允许单行消失 |

## Quality tools

新增模块的 CRAP 最高为 9，修改后的 footer render 为 8。最终覆盖率来自 codex-ui 全部 291 项测试。原有 `codexUiExtension`、`renderBase`、`fitItems` 分别仍为 21.6、15.0、11.4，作为既有注册和布局复杂度记录，不宣称整个仓库低于 10。dryer 对五个新增生产模块按 0.8 阈值未发现重复。

mutator 最终为 137 个位置，131 killed、6 equivalent survivors、0 uncovered，原始退出码为 3。两个 Map 读取的 `??` 改 `||` 对对象或 undefined 等价；两个空桶 tick 初值变异不影响零单位桶；加零时 `<`/`<=` 不改变总量；反光 distance=5 时 cosine 的强度本来就是零。每项解释与原始报告保存在 `.tmp/working-token-rate/quality/` 和 `mutator-final.log`。没有把这些等价变异伪记成 killed。随后新增的上下文读取器 CRAP 为 5，7/7 变异全部 killed；分支编辑、压缩、导航、模型窗口变化及虚拟模型回退均有行为测试。

## Action log

1. 完整读取工作区规则、Spec/Map/Implementation、前关机制证据及只读原型，计划写入 #63 Execution。
2. 查固定 provider 与宿主生命周期契约，选用增量单位、时间桶和响应身份；先写对应失败测试，再实现采样和 Working。
3. 将生产 widget/footer 绑定正式 API；保留 goal、标题和原版路径，补充真实事件与旧回调测试。
4. 扩展正式安装、CPU 和 PTY 入口，实际执行离线 provider 到宿主、工具、生产组件的旅程，保存失败和修复记录。
5. 安装固定 coverage 开发依赖，执行 crapper、dryer、mutator；只在本 worktree 写入覆盖率、隔离 overlay 和证据。
6. 打包并在两种干净宿主安装，跑四个实际入口及既有 codex-ui CLI/headless 回归。
7. 首轮完整 `pnpm run check` 通过 202 文件、2938 测试。随后加入上下文缓存和补丁回归，最终完整检查通过 203 文件、2941 测试。
8. 完成三轮同步 CPU 与原生调度复测，核对八份最终样本的源码/补丁哈希一致，重装最终发布包并重跑四入口、机制和既有用户流程。
9. 汇总原始样本和失败记录，核查本任务 67 个已记录 PID 无存活进程或监听端口，保留原型与证据，执行提交门禁。

## Final CPU results

最终同步复测共 54/54 项预算通过，32ms 原生调度补测 4/4 项通过。所有批次的 user/system CPU、wall time、输出字节数、源码哈希以及先前失败阶段保存在 [CPU 原始数据](working-token-rate-cpu.json)，共 34 次运行。以下绝对值是三轮各自批次中位数再取中位数，下降范围列保留三轮差异；不是挑选最快批次。

| Mode | History pairs | Normal CPU ms/frame | Region CPU ms/frame | Reduction across three rounds |
| --- | ---: | ---: | ---: | ---: |
| regular | 200 | 0.5752 | 0.2670 | 51.92%–53.88% |
| regular | 1000 | 2.8515 | 0.9293 | 67.32%–67.71% |
| fullscreen | 200 | 0.1255 | 0.0583 | 42.45%–54.67% |
| fullscreen | 1000 | 0.3741 | 0.0645 | 82.17%–84.38% |

0/200/1000 对的正常内容更新和未接 API 路径也逐轮通过原有额外 CPU 预算。原生调度补测仅覆盖 200/1000 对纯动态帧，每项 3×40 帧：普通模式下降 43.14%/57.03%，全屏下降 48.06%/87.57%。它与同步数据分开保存，不声称覆盖原生调度的全部组合。

最后一次优化只改变 pi-tui 补丁内部文本校验复用，不改 registerTextRegion 契约。复用范围受同宽 retained frame 限制，每帧集合仅保留本次区域旧/新字符串；字符串、宽度或 frame 变化时重新校验，不累计动画历史。样式、多行、共享可变数组、Thai/Lao、超宽与控制字符回退都有回归。未改摘要补丁，也未降低 32ms 频率、减少采样或隐藏内容。

## Final delivery verification

最终发布安装为 `.tmp/local-refresh-install-4tyVm9`，tarball SHA-256：`8469325ca95bf53ccfce46aef45c7dedd4c3a57d1a0986fd1b06b6f3f1cfa7e1`。补丁版与原版均从冻结锁安装，并在安装实际发布包后再次冻结安装；锁未变化，生产 JS 与本次构建逐字节相同。原版 probe 无 region API，功能旅程仍通过。

最终 `delivery-{patched,original}-{regular,fullscreen}` 四入口各通过 53 项检查，共 212 项；正常 `/quit` 返回 0，运行目录已删除、进程组为空。新补丁下的正式机制旅程普通模式 36 项、全屏 40 项通过。最终完整 `pnpm run check` 通过 203 个测试文件、2941 项测试，打包检查及八扩展 source/dist 加载通过。已有 `/mcp` 替换提示保留，不是加载失败。

最后对变更的 Working.render 和 footer 缓存/组合分支追加变异检查，30 killed、5 equivalent survivors。三个默认值运算符变异对对象/undefined 或空字符串等价；两个恰好能放下的边界只改变是否经过无变化裁剪。原始工具报告另含既有 `nextShorterVariant` 的 1 个 uncovered，位于所选变更行以外，保留该记录，不宣称零未覆盖或将等价项记为 killed。详细统计见 [质量结果](working-token-rate-quality.json)。

最终旧 CLI 回归为 `codex-ui-cli-regular-1793249968003738000`、`codex-ui-cli-fullscreen-1793249969129635000`，各 124 项断言通过且临时目录删除。goal-footer 四入口为 `verify-goal-footer-QntFCa`，codemode 两模式为 `verify-codex-ui-LcQMnH`、`verify-codex-ui-fullscreen-IqEeCq`，均通过并清理进程组。

安装、逐项 PTY 结果、公开宿主事件计数、回归摘要、最终源码/补丁哈希和清理明细见 [验证索引](working-token-rate-verification.json)。八份最终 CPU 原始样本的源码和补丁哈希均匹配本提交文件，源码冻结后只补充证据文档。安装包比对为同一批源码构建的 dist，没有手工修改构建产物。

## Cleanup

最后核查本任务记录的 67 个 CPU/PTY/回归 PID 均已退出，针对这些 PID 的 TCP LISTEN 查询为空。各 PTY 驱动已确认自身进程组为空、运行配置目录删除；变异工具的 `target/mutation-workers` 为空，`.metrics` 已移至本次本地证据目录。未启动持久服务。全量检查中短时测试服务随测试进程退出，未留下本任务监听端口。

保留 `.tmp/working-token-rate/` 的原始 ANSI、公开事件、失败日志、CPU JSON、profile 和隔离安装以供复查。用户已有原型 PID 18552、27701、27910 未操作；其他旧运行资料未清理。资源核查时间与 PID 清单在验证索引中。

## Delivery boundary

本记录只对应 Implementation #63 的开发自测；#64 验证系统建设、#65 旧 skill 维护与 #66 独立验收仍待后续关卡。远程联网 provider、物理像素、系统剪贴板及 Write/Edit 文件系统 await 的精确取消落点未在本次验证；受控 provider 替代外部服务，宿主权限、重试、压缩、shell、取消和退出路径实际运行。未创建 PR、合并、推送或部署，未修改全局 Pi、父代理 progress/slices 或本地原型。
