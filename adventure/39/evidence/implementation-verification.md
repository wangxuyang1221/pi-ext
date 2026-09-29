# Goal summary implementation verification

## Result

Implementation [#43](https://github.com/wangxuyang1221/pi-ext/issues/43) 的执行者验证完成，等待主代理 Acceptance。本报告逐项对照 [Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40)，不代替协调者验收，不关闭 Issue。

产品改动只有 `extensions/goal/src/renderers.ts` 和 `extensions/goal/src/tools.ts`。固定 summary，无密度选项或新产品命令。没有修改 execute、schema、description、response、Goal 存储、调度、预算、计量、footer、`/goal` 或 codex-ui。

## Environment and API evidence

- Node v22.22.2、pnpm 11.9.0，安装的 Pi coding-agent、AI、TUI 均为 0.87.0。接手基准 `f5451950657a950a0bdbb5800062f24adcc6cd84`。
- Context7 查询 `/earendil-works/pi`，确认 self shell 与行局部 renderer 方向。检索未提供 0.87.0 版本，具体行为以本地目标版本为准，没有用当前 harness 的 0.87.1 接口替代。
- 完整读取目标安装包 `docs/extensions.md`、`tui.md`、`themes.md`、`sdk.md`、`session-format.md`、`keybindings.md`，以及 `examples/extensions/todo.ts`、`examples/sdk/13-session-runtime.ts`。
- 核验 `dist/core/extensions/types.d.ts` 和 `dist/modes/interactive/components/tool-execution.js`。宿主先调用 renderCall，再调用 renderResult，然后绘制组件；result slot 的 details 与取消信息存入该行 state，call slot 在绘制时读取。宿主 invalidate 会重新调用 renderer，lastComponent 用于复用两个组件。
- Goal 单独的 tsconfig 构建通过。产品 renderer 只导入 Pi 与 TypeBox 类型，不跨 extension rootDir 引入 codex-ui。

## Acceptance matrix

| Spec item | Status | Evidence and observations |
| --- | --- | --- |
| 1. 正式 Goal + codex-ui，三个 Goal 工具与真实 Bash/Write/Edit 同屏，regular/fullscreen，summary/expanded | 通过 | [regular](implementation/pty-regular.json)、[fullscreen](implementation/pty-fullscreen.json) 的 mixed-summary 与 expanded。加载两个正式 dist 入口，dist 由 pnpm build 生成。Bash 执行 printf，Write 创建 ui-note.txt，Edit 将 Before edit 改成 After edit；断言最终文件。圆点、无背景 shell、加粗标题与结果缩进采用 summary 基线。 |
| 2. schema、description、content/details、状态更新与计量不变 | 通过 | [SDK](implementation/sdk.json)、[SDK 日志](implementation/sdk.log)。逐字比较原 tools.ts 除 import 与三处展示展开之外的全部源代码；对比基准编译工具的 schema、description、execute 函数字符串。将真实执行所得 Goal 快照送入基准序列化路径，逐条断言 content/details 完全相等。真实生产计量将 write/get/edit/update 四个模型回复的 input + output + cacheWrite 求和，等于 complete 返回及落盘 tokensUsed；模型等待 1.1 秒使真实 elapsed 至少 1 秒。模型下一请求中保留 get_goal 的原始 JSON。 |
| 3. 等待、成功、失败、明确取消、无目标、六种合法状态、无预算、不完整 usage、异常 details | 通过 | [组件测试](../../../extensions/goal/__tests__/renderers.test.ts)、SDK scenarios 与 PTY snapshots。全部六种状态都经正式存储/调度产生并读回。paused/blocked/budget_limited/usage_limited 成功调用仍是 success 色。空目标成功显示 No goal。失败红色；仅原执行器精确取消消息识别为 interrupted，任意含 cancelled 的其他错误仍失败。异常 details 默认一行回退，展开可查全部已有文本。 |
| 4. 长目标、换行、中文/emoji、控制字符、40/80/120 列、主题切换、极窄宽度 | 通过 | 两个 PTY 报告的 width-40/80/120、long-expanded、light；组件覆盖 0/1/2/4/8/12/40/80/120 列，逐行 visibleWidth 不超过列宽。检查 CSI、OSC52、BEL、C1、双向控制字符不进入组件输出，整个 PTY 原始输出不含输入的 OSC52。宿主自身合法的清屏序列不作为用户输入注入判据。模型原始目标仍含控制字符，显示清理没有改动返回数据。 |
| 5. 历史快照、reload/重启、独立加载、无 TUI | 通过 | 两种 PTY 都退出首个 Node 进程、用相同 JSONL 启动新进程，再执行 /reload；Created goal 仍为 Active，Updated goal 仍为 Complete，工具执行事件数不变。SDK 比较后续目标变化前后的历史结果与渲染文本，reload/恢复后逐条相等。[独立 SDK](implementation/sdk-standalone.json) 不导入或注册 codex-ui。print 模式重新绑定正式 Goal，get_goal 读取既有落盘状态与原 JSON；create/update 按原能力规则不激活，不将非交互调用变成新的变更能力。 |
| 6. 重绘有界、不重复执行、资源清理 | 通过 | 组件执行一次工具后，重复 1000 次展开/收起、invalidate 和 40/80/120 列切换，execute 仍为 1；两个组件 identity 不变，state 键数不变。PTY 再重复 10 次 Ctrl+O，工具事件计数不增加。每行只缓存最新宽度的行数组，无全局集合、回调注册、计时器、I/O 或网络。见 Cleanup。 |
| 7. check 与正式组件/SDK/PTY 证据 | 通过 | [check.log](implementation/check.log)，173 files passed、2604 tests passed；4 files / 13 tests 为原有 skipped。类型检查、所有扩展构建、8 个扩展入口及发布包边界校验通过。专门 SDK/PTY 单独运行，不用 check 或原型结果替代。 |

### Deferred verification

| Deferred item | Status | Coverage |
| --- | --- | --- |
| 正式 Goal 与 codex-ui 组合、模型结果/状态不变 | 通过 | 上表 1、2；真实默认 GoalStore 与生产事件处理，不使用原型 GoalAccess。 |
| 正式注册下恢复、reload/重启、独立与非交互 | 通过 | 上表 5；实际 JSONL、Node 进程重启、reload 生命周期、独立入口及 print 绑定。 |
| 不合法 details、明确取消、极窄宽度、重绘与清理 | 通过 | 上表 3、4、6；确定性组件边界注入，取消通过正式 execute 的 AbortSignal guard 产生，存储前后完全相等。 |
| 最终整体验证 | 执行者检查通过，待主代理验收 | 无未通过的本关要求；既有跳过测试和替代边界如下，不伪称真实付费模型或所有终端都已测试。 |

## Inputs and production paths

`extensions/goal/__tests__/tool-ui-runtime.mjs` 是专门验收入口，不是产品命令文件。测试控制命令仅由测试 factory 注册，不进入正式 extension。

正常路径为 faux model → Pi agent/tool 调度 → 正式 codex-ui 工具或默认 Goal extension → GoalStore 文件锁、记录、checkpoint、计量与 scheduler → Pi toolResult/JSONL/模型下一请求 → 正式 ToolExecutionComponent/InteractiveMode。捕获注册的 Proxy 只保存定义并原样传给 Pi，不包装或替换 execute。

替代边界明确如下：

| Input | Source and boundary |
| --- | --- |
| 三工具与 Bash/Write/Edit，active/paused/blocked/complete/空目标/失败/无预算 | 模型只替换为 Pi faux provider。调用参数、真实文件操作和 Goal 生产路径不替换。失败由无目标的 update_goal 实际抛出。 |
| budget_limited | 正式 create_goal 设置预算 1，faux 模型生成的真实 usage 经过 Goal accounting 达到预算，再以 get_goal 读回。 |
| usage_limited | faux 模型回复精确的 usage_limit_reached 错误，生产 scheduler 将目标变为 usage_limited，再真实 get_goal 读回。 |
| usage 不完整 | 测试 message_end hook 把模型回复 usage 设为全零，位置在 Goal accounting 之前。生产 accounting 识别未核验零用量并持久化标记，真实 get/update 返回 incomplete。没有直接伪造 Goal details。 |
| 等待 | PTY 的 tool_call 测试 hook 暂停在执行前，宿主显示 Reading goal；释放后走原 execute。组件另测参数/执行等待与 partial result。没有在产品 execute 中加入延时。 |
| 明确取消 | SDK 直接向三个已注册的正式 execute 传 AbortSignal.abort()，取得真实取消错误并送入正式组件，验证 warning/interrupted 与存储不变。没有声称 PTY 的用户 Esc 能在瞬时 Goal I/O 中稳定命中此 guard。 |
| 异常 details、任意错误文本、精确固定统计与极窄宽度 | 组件测试注入。目的是独立命中所有边界，不能单凭此证明正式存储；上面的组合执行证据另行保留。 |
| SDK UI | SDK 用最小 UIContext 验证生产逻辑和组件，不把它称为真实屏幕。PTY 使用真实 InteractiveMode、主题、编辑器、footer 和原生 Ctrl+O。 |
| 非交互 | SDK 以 mode=print 绑定，无终端，调用模型与 get_goal。没有请求真实模型服务，未额外测试 RPC 传输协议。 |

所有测试 HOME、TMPDIR、agent、session 与 workspace 在本 worktree 的 `.tmp/` 下。ModelRuntime 使用内存凭证/模型目录并禁用网络，fetch 一旦被调用即失败；SDK 与 PTY networkAttempts 均为 0。未调用当前主会话的 Goal 工具。

## Red, green and corrections

1. [red-1](implementation/red-1.log) 默认仍输出 JSON、缺少 Read goal；增加正式 self renderer 后 [green-1](implementation/green-1.log)。
2. [red-2](implementation/red-2.log) 缺少 Observed usage only 和展开字段；实现摘要警告、完整字段与无预算后 [green-2](implementation/green-2.log)。
3. [red-3](implementation/red-3.log) 错误结果缺失 details 导致 render 崩溃；实现失败、精确取消、No goal、partial 与六种业务状态后 [green-3](implementation/green-3.log)。搭建测试时先修正了 Theme API 的导出路径；不把导入失败算作行为 Red。
4. [red-4](implementation/red-4.log) 控制序列进入显示；增加仅显示层清理与 details 校验、文本回退后 [green-4](implementation/green-4.log)。
5. [red-5](implementation/red-5.log) 重绘不断创建组件；复用 lastComponent、缓存单个宽度并在 invalidate 时清空后 [green-5](implementation/green-5.log)。最终补充 execute 次数断言，并避免对正常结构化结果重复清理其 JSON 文本，最终 check 通过。

整体验证期间另修正测试入口问题，没有改动产品规则：

- SDK JSONL 恢复不会保留值为 undefined 的可选 usage 键。[初次失败](implementation/sdk-first-failure.log) 暴露了测试比较内存对象与 JSON 持久化对象的差别。改为比较 JSON 表示，content/details 与值均未放宽。SDK 的最小 UIContext 还补齐了 codex-ui session_start 所需的主题和 UI 方法，最终 errors=[]。
- 预算场景会由生产 scheduler 再请求一次预算汇报。最初 faux 队列缺少该回复，出现 No more faux responses queued，目标虽保持 budget_limited，但证据混入了非预期模型错误。补齐预算汇报回复，并在 SDK 与 PTY 保存前断言没有非预期模型错误；最后两套 SDK 和两种 PTY 全部重跑通过。最终 SDK 报告的 unexpectedModelErrors=[]，PTY 只记录主动安排的 usage_limit_reached。
- [首次 check](implementation/check-inherited-env-failure.log) 继承了执行者的 PI_SUBAGENT_* 环境，触发子会话能力限制，173 个测试失败。改用 env -i 且显式设置隔离 HOME/TMPDIR/agent 后完整通过，没有跳过或修改这些失败测试。

## Cost and resource bounds

正常目标最长由原执行器限制为 4000 Unicode 字符。默认摘要仅生成目标单行与统计单行，不提前生成展开折行；不完整 usage 警告单独折行，不参与目标裁剪。异常文本默认一行，展开才按列宽生成全文行。

每个历史工具行保留两组件、两项跨 slot 状态和各自一个最近列宽的缓存。历史行本身必然随调用次数增长；本次约束的是同一行重绘不能积累组件或监听器。展开行数随正文长度增长属于必要输出成本，不限定为常数。1000 次重绘的 identity、state 键数和 execute 次数断言能发现本次原型曾发生的重复注册/累积设计。此实现没有全局切换回调。

## Commands

在仓库根目录运行。依赖已安装；如需重新安装，使用 `pnpm install --frozen-lockfile --ignore-scripts`。PTY driver 需要 codex-py312 中现有 pyte。

```bash
mkdir -p .tmp/goal-ui-agent/{home,tmp,agent,sessions}
env -i PATH="$PATH" HOME="$PWD/.tmp/goal-ui-agent/home" \
  TMPDIR="$PWD/.tmp/goal-ui-agent/tmp" \
  PI_CODING_AGENT_DIR="$PWD/.tmp/goal-ui-agent/agent" PI_OFFLINE=1 \
  TERM=xterm-256color pnpm run check

env -i PATH="$PATH" HOME="$PWD/.tmp/goal-ui-agent/home" \
  TMPDIR="$PWD/.tmp/goal-ui-agent/tmp" \
  node extensions/goal/__tests__/tool-ui-runtime.mjs
env -i PATH="$PATH" HOME="$PWD/.tmp/goal-ui-agent/home" \
  TMPDIR="$PWD/.tmp/goal-ui-agent/tmp" \
  node extensions/goal/__tests__/tool-ui-runtime.mjs --standalone

PYTHONDONTWRITEBYTECODE=1 conda run --no-capture-output -n codex-py312 \
  python extensions/goal/__tests__/tool-ui-driver.py
PYTHONDONTWRITEBYTECODE=1 conda run --no-capture-output -n codex-py312 \
  python extensions/goal/__tests__/tool-ui-driver.py --fullscreen
```

SDK 日志：[组合](implementation/sdk.log)、[独立](implementation/sdk-standalone.log)。PTY 日志：[regular](implementation/pty-regular.log)、[fullscreen](implementation/pty-fullscreen.log)。完整事件：[regular](implementation/pty-regular-events.json)、[fullscreen](implementation/pty-fullscreen-events.json)。原始终端流以 gzip 无损压缩保留为相邻 `.ansi.gz` 文件，包含宿主控制序列，请使用终端解析器查看，不直接输出到正在使用的终端。

## Cleanup

最终 SDK PID 为 54266、54646；regular PTY 为 58211、58861；fullscreen PTY 为 61419、62282。SDK finally 执行 abort/dispose 并删除根目录，PTY driver waitpid 回收两次进程并删除根目录。更早运行的实例也走相同 finally，未留运行实例。

各 PTY 报告记录 rootRemoved=true、listeningPorts=[]。SDK 不启动网络服务；最终额外检查进程与监听端口，见 [cleanup.json](implementation/cleanup.json)。验收辅助目录 `.tmp/goal-ui-agent` 已删除。原工作区与主代理维护的 progress.md/slices.md 未修改。

## Limits

- 未使用付费模型或真实凭证，模型输出和边界 usage 为离线输入。Goal 的执行、持久化、调度与计量不是 fixture。
- 真实终端验证范围是本机 PTY + Pi 0.87.0 regular/fullscreen，以 pyte 屏幕内容和颜色断言为证；不声称覆盖所有终端模拟器或 Pi 其他版本。
- 仓库既有 13 个 skipped 测试未运行，均非本关新增。Spec 本关要求没有因这些跳过项而省略。
- 等待主代理独立 Acceptance；本报告只记录实施者的执行结果。
