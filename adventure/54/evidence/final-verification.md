# Final verification

## Result

本轮在指定独立上下文以 gpt-6.1-sol / high 验证，没有委派，也没有修改产品、补丁、测试或共享驱动。全部安全可执行自动入口已实跑。58 个 feature ID 中 53 个通过、0 个失败、5 个仍未验证，整体结果为 `unverified`。未发现需要交 Astra high 修复的产品或共享驱动问题。物理终端、剪贴板、远程请求及精确 Write/Edit await 按键落点仍是最终验收缺口，不能据自动通过关闭 #66。

权威为 [Spec #55](https://github.com/wangxuyang1221/pi-ext/issues/55)，执行计划只维护于 [Implementation #66](https://github.com/wangxuyang1221/pi-ext/issues/66) 的 Execution。完整逐项状态、精确命令、退出码、时间、来源哈希、全部 CPU 批次和原始证据索引见 [machine-readable evidence](final-verification.json)。历史 #60–#65 的通过结论没有代替本轮运行。

## Identity and launch

- cwd 为 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation`，分支 `adventure/pi-animation`，验证源码 HEAD 为 `3a5f87c367f146af784cbf2425f4fd7fca4a5304`。开始时工作树干净，依赖独立，doctor 的 independentCheckout=true、sharedDependencies=false。
- Node v22.22.2、pnpm 11.9.0、Pi coding-agent/ai/agent-core/tui 1.4.0、Python 3.12.13、pyte 0.8.2；macOS arm64，Apple M5。
- 两个 skill 的全部 feature、必要引用及驱动 helper 已读取，并实际执行 Launch/Doctor/Drive/Evidence/Cleanup；同时应用 write-todo-list 和 unslop。未调用 maintain/source-reader wave 或 skill-creator。
- 仓库已有匹配 node_modules，运行 build 和 hooks:check，退出均为 0；未改共享 hooks 配置。所有 pnpm 和提交命令均带命令级 pnpm_config_verify_deps_before_run=false。
- 本次证据根为 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation/.tmp/final-verification-66-20261029`。所有 PTY 子目录均为新目录。空 HOME、agent、workspace、session 与凭据过滤由正式 helper 创建，真实 ready 条件满足后才发输入。

实际 Launch 和安装命令如下，精确 argv 与时间另在索引 commands 中。

```bash
pnpm_config_verify_deps_before_run=false pnpm run build
pnpm_config_verify_deps_before_run=false pnpm run hooks:check
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs
pnpm_config_verify_deps_before_run=false pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm_config_verify_deps_before_run=false node scripts/local-refresh-install.mjs --pack
```

## Installation and fallback

- 新消费根为 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation/.tmp/local-refresh-install-eoWVvw`，patched/original 均按冻结锁、ignore-scripts、offline 安装，未执行依赖构建脚本。strict-dep-builds=false 仅处理忽略构建脚本的配置提示。
- 初始补丁消费锁 SHA-256 为 `f2830f6a572d6d77f15a365b6a9761a9aa5b4705956c0d953fb8b98ed5f64616`，与仓库锁一致。两种初始 lockUnchanged=true；加入本次 tarball 后各再冻结，publishedFrozenLockUnchanged=true。两个冻结阶段分别核对，未把加入包前后的锁误要求相同。
- 两份 patch 与仓库逐字节一致。doctor 对 patched 的 regular/fullscreen 都为 true，对 original 的两项都为 false。实际 bin 的示例挂载分别显示 region API / normal fallback，生产 Working 四入口也实际运行。
- 七个生产 JS 为 index、working、working-session、token-rate、json-units、context-usage、footer，两个消费者均与本轮构建字节一致，最终 check 再构建后仍匹配。
- tarball 为 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation/.tmp/local-refresh-install-eoWVvw/pi-ext.tgz`，SHA-256 为 `8469325ca95bf53ccfce46aef45c7dedd4c3a57d1a0986fd1b06b6f3f1cfa7e1`。实际 tar 清单含七个生产文件且不含 examples，保存于 tarball-entries.txt。示例使用仓库源码，不能称为发布包示例。
- 全局 Pi 仅定位和读取入口、真实 bundle、package 版本及哈希。前后入口、目标、版本和两份 SHA-256 完全相同，没有修改全局安装、默认命令或升级流程。

全局入口为 `/Users/wangxuyang/Library/pnpm/bin/pi`，版本1.4.0。具体前后快照为 RUN/global-before.json 和 global-after.json，真实 bundle SHA-256 为 `e79626f2dd6f94aa45d30f3fa63cd84319a6eefcd150b353cfaf274366926774`。

## Text region journeys

入口均执行正式 `scripts/local-refresh-pty.py`。每次先用相应 project/extension/original 参数运行 doctor，随后以 Conda Python、真实 CLI bin、真实 PTY 按键驱动。working 入口加 --working，发布入口另加 --extension 指向已安装 index.js；原版加 --original，Kitty 加 --kitty。索引 journeys 保存每条完整命令。

| Entrance | Mode | Checks | Result |
| --- | --- | ---: | --- |
| `working-repository-regular` | regular | 54 | passed, exit 0 |
| `working-repository-fullscreen` | fullscreen | 54 | passed, exit 0 |
| `working-published-patched-regular` | regular | 54 | passed, exit 0 |
| `working-published-patched-fullscreen` | fullscreen | 54 | passed, exit 0 |
| `working-published-original-regular` | regular | 54 | passed, exit 0 |
| `working-published-original-fullscreen` | fullscreen | 54 | passed, exit 0 |
| `regions-repository-regular` | regular | 36 | passed, exit 0 |
| `regions-repository-fullscreen` | fullscreen | 40 | passed, exit 0 |
| `regions-installed-patched-regular` | regular | 36 | passed, exit 0 |
| `regions-installed-patched-fullscreen` | fullscreen | 40 | passed, exit 0 |
| `regions-installed-original-regular` | regular | 36 | passed, exit 0 |
| `regions-installed-original-fullscreen` | fullscreen | 40 | passed, exit 0 |
| `regions-kitty-patched` | fullscreen | 40 | passed, exit 0 |
| `regions-kitty-original` | fullscreen | 40 | passed, exit 0 |

六个 Working 入口各 54 项，真实链路从公开 agent_start 进入生产 Working/TokenRate/CodexFooter，经 permissions/input、真实 Bash、retry/自动压缩直到 agent_settled。工具文件实际读回为 TOOL-FINISHED；取消后 should-not-exist.txt 不存在，不能把 Esc 按下当作已经完成取消。idle input 不启动 Working，agent_end/backoff/等待与工具执行不提前隐藏。

32/40/100/12 列、Goal 第二行、草稿中间插入中文/ASCII、光标、overlay/input 焦点、主题、Ctrl+O、双向模式切换、new/reload/quit 均按完整旅程执行。12 次动画采样至少五种 spinner 与两种灰度，accent 为 5efcff。十帧/80ms、两秒反光与共享32ms调度的精确契约由本轮定向测试补证，未把定时器测试写成物理像素证据。

示例分别验证 animation/footer 独立及同帧更新、draft-中文-aXbc、七次真实历史增长、高度/主题/resize、挂载替换/释放、模式/new/reload/quit。fullscreen 另实际发送 Ctrl+Home/End、SGR wheel/选择和 Ctrl+Shift+F 搜索 Response 0。Kitty 入口核对 a=T 原始传输字节，普通入口核对 Image 文本降级。宿主 copy callback 最新文本、搜索/布局/光标等价及复杂状态回退由真实 renderer 契约补证；这些不是系统剪贴板和图片像素。

## Final frames and title intervals

- 0333f31 回归：六份 screens.finished 都是完整 synchronized frame，Working 和速率同时消失，Goal 行保留。另从各自 terminal.ansi 的开头独立重放到 finished.rawBytes，六份文本与光标均与 captured finished 完全一致；结果在 ansi-replay.json。
- 标题独立于 Working 核对。六个入口各取首次 retry、自动 overflow compaction、reload 后 retry，共18个原始 ANSI banner 字节区间，均有多种 OSC spinner 帧，banner 期间无静态标题，任务结束恢复 π 静态标题。区间原始字节位置、标题集合与末帧在 osc-intervals.json；未借 Working 的动画断言证明标题。
- 1e91275 回归：tool-status 的 regular/fullscreen 共6组 held 状态，各15次采样，静态卡片的文案、行列位置、前景/背景和所有 pyte 样式在实际断言中逐次相同。90帧同时满足至少五种 spinner、两种反光及 accent 5efcff。MCP-only 本来不加载 codex-ui，不要求 Working，但静态卡和黄色标记仍核对。
- 旧 tool-status JSON 导出行坐标与动画样本，完整单元格相等断言实际运行；其旧 helper 仅保留最后一个 ANSI 流，不能宣称三个入口的全部 ANSI 都已导出。原失败维护目录和 verify-tool-status-SsPXWo 未覆盖。

## Codex-ui journeys

| Entrance | Actual observations | Result |
| --- | --- | --- |
| codex-ui / codex-ui-fullscreen | 真实 QuickJS、本地 stdio MCP、调用树、hiddenfail、inspect、主题、branch/reload/compact/restart | passed |
| thinking / thinking-pty.py --fullscreen | 真实 TUI 流式思考、Ctrl+T、完成后隐藏选择、resize | passed |
| tool-status | regular/fullscreen/MCP-only 三入口，均含 restart、完整颜色/Read 分组/展开与静态卡回归 | passed |
| goal-footer | codex/native × regular/fullscreen，详情快照、恢复/暂停/清空、窄屏、分钟边界、idle输出0字节 | passed |
| cli.py regular / fullscreen | 各124项，原生设置/fork/resume/tree、Markdown、真实工具/取消、配置快照、缓存、Thinking/OSC | passed |
| headless.py | print/json与RPC共12场景，4个健康图片/文件结果、8个配置拒绝且无副作用 | passed |
| codemode-cli.mjs --smoke | 10个真实执行场景，错误后已应用的Edit保留、nested/MCP/hiddenfail、网络调用0 | passed |

```bash
pnpm_config_verify_deps_before_run=false pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run codex-ui
pnpm_config_verify_deps_before_run=false pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run codex-ui-fullscreen
pnpm_config_verify_deps_before_run=false pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run thinking
conda run --no-capture-output -n codex-py312 python extensions/codex-ui/__tests__/thinking-pty.py --fullscreen
pnpm_config_verify_deps_before_run=false pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run tool-status
pnpm_config_verify_deps_before_run=false pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal-footer
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/cli.py regular
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/cli.py fullscreen
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/headless.py
node extensions/codex-ui/__tests__/fixtures/codemode-cli.mjs --smoke
```

CLI 两模式共10个进程、headless12个进程，全部22份内部逐进程 doctor 文件已独立读回，lockPresent=false、版本1.4.0、revision对应本轮、独立依赖且清理通过。CLI 的 proof.txt 为 replacement 换行、pair.txt 为 EDIT-PAIR-full 换行；取消、全局和项目拒绝文件均不存在，事件有实际 Command aborted。headless 健康图片尺寸为4000×40或2000×20，文件为headless:wrapper；8个损坏/不可读配置场景均拒绝read/bash，不暴露图片、不写文件。

headless RPC 在 agent_settled 后由 helper 终止空闲客户端，所存子进程退出码可为 -15；外层场景退出0，工具与副作用断言通过。它不表示任务被键盘取消。

来源按实际入口区分：新 Working 与 legacy CLI 加载 codex-ui dist，发布四入口加载安装目录 dist；codemode/Thinking 加载生产 dist；tool-status 将生产 dist 逐文件复制到隔离 runtime；Goal footer-fixture.ts 实际导入生产 source。最终 host:check 另分别加载八扩展的 source 与 dist。所有外部模型/摘要均为明确离线替身，未写成远程联网实测。

## CPU protocol

本次八份新测量从新安装原版 pi-tui 取 baseline，candidate 来自本仓库 patched node_modules。生产 Working、CodexFooter、TokenRate、真实 AgentSession上下文及真实User/Assistant历史组件组合，不是机制旧报告。120×40、同 codex-pi/truecolor 主题与内容；同步0/200/1000对，每场景50帧预热、7×320帧、轮换先后，三轮×两模式；原生补测32ms、200/1000对、50帧预热、3×40帧。

逐批重算 (userMs+systemMs)/frames，再取七批或三批中位数。八份全部退出0，54个同步和4个原生预算判断全部通过，没有重跑选择最佳轮。每批bytes相同；脚本预热逐帧和每批末帧比较输出/光标，全屏另比较layout节点、clip和scrollContentLines。没有声称所有正式帧逐帧截图等价。八份来源哈希相同且与最终源码/补丁一致，七个最终dist仍与发布包相同。

CPU运行没有本任务并发build/PTY/check；未停止用户进程。度量是Pi进程user+system，不包括远程模型或终端模拟器自身CPU。同步step=32ms是内容推进，实际interval=0，不能与32ms原生结果混算。

### Dynamic results

下表为全部动态200/1000对结果，单位ms/帧，预算为下降至少30%。原生与同步分开列名。

| Run | Pairs | Baseline | Candidate | Reduction |
| --- | ---: | ---: | ---: | ---: |
| regular-1 | 200 | 0.56889 | 0.25935 | 54.41% |
| regular-1 | 1000 | 2.85461 | 0.90967 | 68.13% |
| fullscreen-1 | 200 | 0.11717 | 0.05894 | 49.70% |
| fullscreen-1 | 1000 | 0.37596 | 0.08272 | 78.00% |
| regular-2 | 200 | 0.56639 | 0.26445 | 53.31% |
| regular-2 | 1000 | 2.81186 | 0.91247 | 67.55% |
| fullscreen-2 | 200 | 0.12968 | 0.07019 | 45.88% |
| fullscreen-2 | 1000 | 0.36474 | 0.06160 | 83.11% |
| regular-3 | 200 | 0.56577 | 0.26041 | 53.97% |
| regular-3 | 1000 | 2.86998 | 0.90272 | 68.55% |
| fullscreen-3 | 200 | 0.13471 | 0.07116 | 47.17% |
| fullscreen-3 | 1000 | 0.37037 | 0.06323 | 82.93% |
| regular-native | 200 | 5.62720 | 3.28695 | 41.59% |
| regular-native | 1000 | 13.99230 | 6.33330 | 54.74% |
| fullscreen-native | 200 | 2.95592 | 1.62262 | 45.11% |
| fullscreen-native | 1000 | 9.33540 | 1.43440 | 84.63% |

### Normal and unused results

下表保留全部42个正常/unused及0对动态场景。Extra必须不超过Budget，Budget=max(基线10%,0.1ms/帧)。原始JSON同时保留每批user/system、wall、bytes，无舍弃样本。

| Run | Pairs | Workload | Baseline | Candidate | Extra | Budget |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| regular-1 | 0 | animation-and-rate | 0.05560 | 0.06184 | 0.00624 | 0.10000 |
| regular-1 | 0 | streaming-and-animation | 0.06681 | 0.11649 | 0.04968 | 0.10000 |
| regular-1 | 0 | unused-api | 0.05676 | 0.07786 | 0.02110 | 0.10000 |
| regular-1 | 200 | streaming-and-animation | 0.57909 | 0.58938 | 0.01029 | 0.10000 |
| regular-1 | 200 | unused-api | 0.58875 | 0.56710 | -0.02165 | 0.10000 |
| regular-1 | 1000 | streaming-and-animation | 2.90964 | 2.90158 | -0.00805 | 0.29096 |
| regular-1 | 1000 | unused-api | 2.84337 | 2.88002 | 0.03665 | 0.28434 |
| fullscreen-1 | 0 | animation-and-rate | 0.08906 | 0.07831 | -0.01076 | 0.10000 |
| fullscreen-1 | 0 | streaming-and-animation | 0.10412 | 0.14651 | 0.04239 | 0.10000 |
| fullscreen-1 | 0 | unused-api | 0.06162 | 0.09010 | 0.02847 | 0.10000 |
| fullscreen-1 | 200 | streaming-and-animation | 0.12810 | 0.14180 | 0.01370 | 0.10000 |
| fullscreen-1 | 200 | unused-api | 0.12406 | 0.14058 | 0.01651 | 0.10000 |
| fullscreen-1 | 1000 | streaming-and-animation | 0.38230 | 0.35980 | -0.02250 | 0.10000 |
| fullscreen-1 | 1000 | unused-api | 0.34322 | 0.36704 | 0.02382 | 0.10000 |
| regular-2 | 0 | animation-and-rate | 0.05241 | 0.05960 | 0.00719 | 0.10000 |
| regular-2 | 0 | streaming-and-animation | 0.07099 | 0.10898 | 0.03799 | 0.10000 |
| regular-2 | 0 | unused-api | 0.04762 | 0.06722 | 0.01960 | 0.10000 |
| regular-2 | 200 | streaming-and-animation | 0.57566 | 0.58604 | 0.01038 | 0.10000 |
| regular-2 | 200 | unused-api | 0.56833 | 0.56083 | -0.00751 | 0.10000 |
| regular-2 | 1000 | streaming-and-animation | 2.86333 | 2.91637 | 0.05304 | 0.28633 |
| regular-2 | 1000 | unused-api | 2.81775 | 2.90208 | 0.08433 | 0.28178 |
| fullscreen-2 | 0 | animation-and-rate | 0.08983 | 0.09621 | 0.00638 | 0.10000 |
| fullscreen-2 | 0 | streaming-and-animation | 0.10275 | 0.14080 | 0.03805 | 0.10000 |
| fullscreen-2 | 0 | unused-api | 0.08098 | 0.10042 | 0.01944 | 0.10000 |
| fullscreen-2 | 200 | streaming-and-animation | 0.12360 | 0.13832 | 0.01472 | 0.10000 |
| fullscreen-2 | 200 | unused-api | 0.12752 | 0.14394 | 0.01642 | 0.10000 |
| fullscreen-2 | 1000 | streaming-and-animation | 0.37719 | 0.36370 | -0.01349 | 0.10000 |
| fullscreen-2 | 1000 | unused-api | 0.35387 | 0.36880 | 0.01493 | 0.10000 |
| regular-3 | 0 | animation-and-rate | 0.05630 | 0.06574 | 0.00944 | 0.10000 |
| regular-3 | 0 | streaming-and-animation | 0.07403 | 0.11217 | 0.03814 | 0.10000 |
| regular-3 | 0 | unused-api | 0.05086 | 0.06482 | 0.01397 | 0.10000 |
| regular-3 | 200 | streaming-and-animation | 0.59709 | 0.59438 | -0.00271 | 0.10000 |
| regular-3 | 200 | unused-api | 0.58671 | 0.56971 | -0.01701 | 0.10000 |
| regular-3 | 1000 | streaming-and-animation | 2.87234 | 2.88088 | 0.00854 | 0.28723 |
| regular-3 | 1000 | unused-api | 2.82583 | 2.89197 | 0.06614 | 0.28258 |
| fullscreen-3 | 0 | animation-and-rate | 0.11181 | 0.09182 | -0.01999 | 0.10000 |
| fullscreen-3 | 0 | streaming-and-animation | 0.11875 | 0.14416 | 0.02541 | 0.10000 |
| fullscreen-3 | 0 | unused-api | 0.06820 | 0.09316 | 0.02496 | 0.10000 |
| fullscreen-3 | 200 | streaming-and-animation | 0.12782 | 0.13960 | 0.01177 | 0.10000 |
| fullscreen-3 | 200 | unused-api | 0.13581 | 0.14799 | 0.01218 | 0.10000 |
| fullscreen-3 | 1000 | streaming-and-animation | 0.38140 | 0.36716 | -0.01424 | 0.10000 |
| fullscreen-3 | 1000 | unused-api | 0.35310 | 0.37923 | 0.02613 | 0.10000 |

## Feature coverage

covered/passed 仅代表该 ID 的定义范围。物理或远程分支未由离线自动结果替代。没有使用 verified-unreachable 豁免。

| Skill | Group | ID | Result |
| --- | --- | --- | --- |
| text-regions | regions | `region-independent` | passed |
| text-regions | regions | `region-edit` | passed |
| text-regions | regions | `region-lifecycle` | passed |
| text-regions | regions | `region-original` | passed |
| text-regions | working | `working-stream` | passed |
| text-regions | working | `working-permission` | passed |
| text-regions | working | `working-cancel` | passed |
| text-regions | working | `working-recovery` | passed |
| text-regions | working | `working-replacement` | passed |
| text-regions | interactions | `interaction-focus` | passed |
| text-regions | interactions | `interaction-transcript` | passed |
| text-regions | interactions | `interaction-image` | passed |
| text-regions | interactions | `interaction-physical` | unverified |
| text-regions | interactions | `interaction-network` | unverified |
| text-regions | performance | `cpu-dynamic` | passed |
| text-regions | performance | `cpu-normal` | passed |
| text-regions | performance | `cpu-native` | passed |
| text-regions | performance | `cpu-equivalence` | passed |
| text-regions | installation | `install-patched` | passed |
| text-regions | installation | `install-original` | passed |
| text-regions | installation | `install-published` | passed |
| text-regions | installation | `install-isolation` | passed |
| codex-ui | layout | `ui-header` | passed |
| codex-ui | layout | `ui-composer` | unverified |
| codex-ui | layout | `ui-status` | passed |
| codex-ui | layout | `ui-theme` | passed |
| codex-ui | layout | `ui-resize` | passed |
| codex-ui | layout | `ui-user-markdown` | passed |
| codex-ui | layout | `ui-reply-markdown` | unverified |
| codex-ui | layout | `ui-working` | passed |
| codex-ui | layout | `ui-receive-rate` | passed |
| codex-ui | thinking | `ui-thinking-stream` | passed |
| codex-ui | thinking | `ui-thinking-collapse` | passed |
| codex-ui | thinking | `ui-thinking-resume` | passed |
| codex-ui | thinking | `ui-title` | passed |
| codex-ui | thinking | `ui-title-stop` | passed |
| codex-ui | tools | `ui-tool-rendering` | passed |
| codex-ui | tools | `ui-read-group` | passed |
| codex-ui | tools | `ui-bash-preview` | passed |
| codex-ui | tools | `ui-expand` | passed |
| codex-ui | tools | `ui-write-added` | passed |
| codex-ui | tools | `ui-write-edited` | passed |
| codex-ui | tools | `ui-diff` | passed |
| codex-ui | tools | `ui-error` | passed |
| codex-ui | tools | `ui-interrupted` | unverified |
| codex-ui | codemode | `ui-codemode-order` | passed |
| codex-ui | codemode | `ui-codemode-failure` | passed |
| codex-ui | codemode | `ui-inspect-tabs` | passed |
| codex-ui | codemode | `ui-inspect-scroll` | passed |
| codex-ui | codemode | `ui-codemode-cache` | passed |
| codex-ui | codemode | `ui-codemode-resume` | passed |
| codex-ui | execution | `ui-shell-prefix` | passed |
| codex-ui | execution | `ui-shell-path` | passed |
| codex-ui | execution | `ui-image-resize` | passed |
| codex-ui | execution | `ui-project-trust` | passed |
| codex-ui | execution | `ui-settings-error` | passed |
| codex-ui | execution | `ui-settings-reload` | passed |
| codex-ui | execution | `ui-headless` | passed |

## Unverified branches and continuation

- `interaction-physical`：物理终端访问已有工具安全拒绝，未重复或绕过。物理像素、实际拖选、系统复制粘贴及真实图片像素未验证；系统剪贴板无当前写入授权。
- `interaction-network`：隔离环境三类provider key存在性均false；无指定provider/model/付费范围，未读用户auth或发送远程请求。
- `ui-composer`：ANSI逐列背景、焦点/草稿/宽度/会话替换自动通过；物理像素和实际拖选未验证。
- `ui-reply-markdown`：模型请求/session原文及TUI渲染自动通过；/copy写系统剪贴板并实际粘贴比对未验证。
- `ui-interrupted`：真实Bash Esc/宿主abort/无迟到文件、Read/Edit/Write预先取消和受控晚取消补证通过；真实Esc精确落在Write/Edit filesystem await的分支缺少可观察、可控制阶段。

物理入口沿用新 skill manual-terminal recipe，在被允许操作的真实终端分别启动regular/fullscreen和补丁/原版；记录终端版本、尺寸、协议和截图，执行草稿/窄屏/滚动/遮挡/选择及真实1×1图片放大检查。已知Ghostty拒绝原文为 `Computer Use is not allowed to use the app 'com.mitchellh.ghostty' for safety reasons.`。本轮只读取既有拒绝证据和哈希，不重复被拒操作、不换工具控制同一应用。

系统复制续验需要当前写入授权及可操作终端，执行/copy或实际选区复制，粘贴到本次隔离workspace并与session原文逐字比较。远程续验需明确provider/model、可用凭据与费用授权范围，启动正式codex-ui而不加载faux provider，分别保存正文/thinking/参数、过期与settled隐藏证据。本轮三类key仅检查存在性且均false，未读取用户auth或发付费请求。

Write/Edit精确Esc落点需宿主提供可观察且可控制的文件操作阶段，或另获认可的可复现同步条件。当前Writing/Editing标题不足以证明操作尚未开始。已开始的写入不回滚，执行层预先/晚取消补证不能替代该键盘分支。以上缺项交主代理处理，不重新向用户询问已确认需求。

## Final checks and cleanup

- `pnpm_config_verify_deps_before_run=false pnpm run check` 退出0，204文件/2951测试，八扩展source/dist各8项、loadErrors=0。发布包排除边界通过。既有MCP命令替换warning如实保留在日志，不是加载错误。
- 定向 `pnpm test` 23文件/185测试通过。包含新区域契约、动画/采样、旧layout/thinking/tools/codemode/execution补证，完整argv在focused-contracts.command.json。
- Conda unittest health为6项、held-frame为5项，均通过，单独记录且不计入2951。ANSI重放是离线证据分析，也不是物理终端测试。
- 逐旅程立即核对进程组、lsof、runtime与证据。最终再次读取记录到的686个PID及119个进程组，无存活或监听；新PTY runtime、CPU工作目录及共享验证锁均已移除，证据、安装包和CPU原始数据保留。
- 没有按名字kill、没有停止用户原型或删除整个.tmp。adventure/54/prototypes与原维护失败证据保留。未写系统剪贴板，未修改全局Pi。无PR、push、merge或deploy。

## Analysis corrections

没有产品或共享驱动失败。两次本轮附加分析错误均保留原件并先doctor后核对：一是把初始冻结锁与加入tarball后的锁误比，改按两个冻结阶段核验；二是首次codemode清理分析把尚在运行的记录器及其ps算入共享进程组，记录器退出后全部应用PID/组读回已停止，后续命令记录器单独建立进程组。没有修改任何测试断言、驱动、产品行为或CPU预算。

另外一次codemode执行smoke没有紧邻专用doctor，随后补做只读doctor并在新命令记录中再跑10个场景，均退出0，两次日志均保留。最终有效smoke记录为codemode-execution-smoke-preflight.command.json。

## Handoff

提交仅包含本报告和机器可读索引。主代理审核本轮证据后负责push及Acceptance；#66、Map与Spec不由本验证代理关闭。自动范围已通过，五个未验证ID的必要分支仍待补证，不请求把它们豁免成完整验收。
