# Codex-ui acceptance drivers

## Run

先按 [skill](../SKILL.md) 完成安装、构建与 doctor。从仓库根目录执行，三条命令各自创建隔离目录，无需修改脚本中的路径。

```bash
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/cli.py regular
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/cli.py fullscreen
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/headless.py
```

`cli.py` 启动仓库固定版本的原生 CLI。`model-provider.ts` 只提供离线模型响应、记录公开事件、注册宿主原有 codemode 工具，并为 `/compact` 提供确定摘要。工具、QuickJS、文件、配置、session、选择器和生产 renderer 均实际运行。该路径不证明真实远程模型会生成相同响应。

两条驱动在每次新 CLI 进程前调用 [health.py](health.py)，保存 `doctor-*.json/.stderr`，对应进程条目的 `doctor` 字段指向它。它复用共享只读 doctor，非零退出、无效输出或验证锁占用时拒绝继续。失败后重新 doctor 并检查该次证据/cleanup，UI 卡住则重启已知状态。所有 pnpm 命令使用 `pnpm_config_verify_deps_before_run=false`，不要并发构建与 PTY。

单独执行 preflight 的命令见 [Helpers](../SKILL.md#helpers)。回归入口为 `conda run --no-capture-output -n codex-py312 python -m unittest discover -s .cursor/skills/verify-pi-codex-ui/scripts -p test_health.py -v`。

`headless.py` 分别启动原生 `--print --mode json` 和 `--mode rpc`。RPC 通过客户端消息发起 prompt；它不是给 SDK 设置一个 mode 字段。工具返回的 PNG 字节需解析为 4000×40 或 2000×20，实际 shell 输出必须写入并读回文件。

只补验控制字符 diff 时，可运行 `cli.py regular --controls` 和 `cli.py fullscreen --controls`。该聚焦路径实际覆盖已有 CRLF 文件、展开 diff，并检查源文件中的清屏和 OSC 标题指令没有执行；它不能代替完整 CLI 旅程。

## CLI coverage

| Feature IDs | Required observations |
| --- | --- |
| `ui-header`, `ui-composer`, `ui-resize` | 启动 Pi header；输入时逐列检查整行背景；40/80/140 列；真实设置菜单选择 light 与 codex-pi；fork/resume 后再检查背景。保存 pyte 文本与颜色区间、原始 ANSI。 |
| `ui-status` | 加载生产 fast 与 permissions 扩展，离线支持模型显示目录、模型、fast、full access 组合，关闭 fast 并切回 Default permissions 后对应状态消失。窄屏另存画面。 |
| `ui-theme` | 原生 `/settings` 落盘主题；`/reload`、`/new`、原生 `/fork` 与 `/resume` 选择器替换后检查 codex-pi 背景。fork 的多行预填须 Ctrl+C 清除。 |
| `ui-user-markdown`, `ui-reply-markdown` | bracketed paste 输入标题、嵌套列表、表格、代码围栏、引用、链接；核对真正模型请求和持久 session 原文，另检查 TUI 内容。`/copy` 的系统剪贴板部分须按下节人工补验。 |
| `ui-tool-rendering` | 普通/fullscreen 的真实命令清单保留 `/inspect` 且排除 `/lowpower`；Tab 补全 `/inspec` 成功、`/lowp` 保持原输入。reload/new/fork/resume 后重复检查。始终执行真实 write/edit/bash/codemode，保存完整折叠预览与 Ctrl+O 展开结果，核对文件字节及工具成功结果。 |
| `ui-write-added`, `ui-write-edited`, `ui-diff`, `ui-bash-preview`, `ui-expand`, `ui-error`, `ui-interrupted` | 真实新建、覆盖、Edit、大结果 Diff unavailable、控制字符原始字节、长/多行/截断 Bash；真实 Esc 取消独立 Bash，确认延后文件未生成。Write/Edit 使用短时异步文件操作，无可观察的分阶段进度，取消证据见下方文件修改边界。 |
| `ui-shell-prefix`, `ui-shell-path`, `ui-project-trust`, `ui-settings-error`, `ui-settings-reload` | shell wrapper 真实输出；未信任项目前缀不生效；可信项目语法错误和不可读文件均阻止 read/bash；修复而未 reload 仍拒绝；reload 后恢复；重启为不信任后再次排除项目前缀。 |
| `ui-codemode-cache`, `ui-inspect-tabs`, `ui-inspect-scroll`, `ui-codemode-resume` | 真实读取累计超过 4MiB；首项缺失、末项可读；方向键/PgDn/PgUp/Shift+Tab；原生 `/resume`、`/tree` 后发后续模型请求核对已保存结果，并确认 raw cache 不从历史恢复。调用顺序、预览外失败和本地 MCP 仍运行 skill 的 codemode case。 |
| `ui-thinking-stream`, `ui-thinking-collapse`, `ui-thinking-resume`, `ui-title`, `ui-title-stop` | 实际流式 Thinking、Ctrl+T 隐藏选择、持久重开及后续上下文、原生 `/resume` 恢复取消/错误思考、`/compact` 后保留及开关；流中 OSC 动画、settled/取消后静止。80ms 精度仍由计时器测试验证。 |
| `ui-working`, `ui-receive-rate` | 复用 [text-regions Working](../../verify-pi-text-regions/features/working.md) 的完整 regular/fullscreen 旅程，覆盖生产事件到组件、真实权限/文件/取消、input/retry/compaction、宽度、goal、new/reload/renderer/quit。先执行其 Launch/Doctor；这些不在旧 cli.py 的断言内。原版/发布/CPU 与物理边界按新 skill 对应 feature 另行验证。 |

## Manual boundaries

以下部分不能凭 pyte 或文件断言标为通过。执行人必须保存动作、画面和结果；缺少该证据时，对应 ID 保留 `unverified`，同时记录自动通过部分。

1. `ui-composer` 的终端像素和拖选。用真实终端启动共享 `tui codex-ui`，输入含中文、ASCII、长行的三行文本。分别在 light/codex-pi、窄屏/宽屏、`/new`/`/fork`/`/resume` 后拖选输入和空白区，检查背景无缺口、光标无残影、选择内容与输入一致。pyte 的逐列背景断言只证明 ANSI 单元格语义。
2. `ui-reply-markdown` 的 `/copy`。在已允许写系统剪贴板的人工终端中，生成上述代表 Markdown，运行 `/copy`，粘贴到临时纯文本编辑器，与 session 中 assistant 原文逐字比较。代码围栏、缩进和表格分隔线必须一致，不含 renderer 添加的外层列表。自动驱动不会写系统剪贴板。

## File mutation cancellation

Write/Edit 包含异步文件操作。宿主 Write 使用 `fs/promises` 执行 mkdir/writeFile，Edit 执行 access/readFile/writeFile，在这些宿主 await 检查点观察 AbortSignal。工具不通过 `onUpdate` 发布文件操作阶段，也没有可等待的确认步骤。普通本地文件通常在人工按 Esc 前完成；看到 Writing/Editing 标题只能说明工具进入执行，不能证明底层写入尚未开始。因此本 skill 没有稳定的真实终端按键步骤来命中某次 Write/Edit 文件操作。按缺少可观察阶段报告未验证，不将人工抢按 Esc 或大文件抢时序列为可复现验收步骤。

实际取消承诺有以下边界：

- 在开始某个步骤前观察到 signal 已取消时，工具拒绝继续该步骤；宿主会停止尚未开始或在检查点观察到取消的后续调用。已经并行启动的调用各自处理同一个 signal，不保证它们都没有文件副作用。
- 已经提交的文件系统调用没有接收 signal，工具会等待它结束，再返回 `Operation aborted`。同文件修改队列在操作结束前保持占用。取消不回滚已经写入的内容，也不把之前成功完成的 Write/Edit 改成未执行。
- codex-ui 将确切的原生 `Operation aborted` 结果显示为 Interrupted，不把普通错误文本误判为取消。Write 观察器只有在宿主 execute 成功返回后才生成成功 diff；取消后可能保留已写字节而没有成功 diff。

Write 观察器的 writeFile 回调先取得旧文件 stat/有界快照，再调用实际 writeFile；这个回调内部没有额外的 signal 检查，宿主在整个回调返回后才再次检查。因而快照阶段触发取消也可能仍写入新字节。这正是现有受控晚取消测试实际覆盖的情况。

证据分开记录：真实 CLI 的独立 Bash 已证明 Esc 传播、Interrupted、实际 abort 结果及延后文件未生成。`write-execution.test.ts` 的预先取消用例证明拒绝且不生成成功 patch；其受控晚取消用例实际写入 `new` 后拒绝、保留字节且不生成成功 patch，下一次写入以这些现存字节为基线。`tool-status.test.ts` 包含 Read/Edit/Write/Bash 的真实预先取消及序列化后黄色中断渲染。测试源码位置为执行边界证据，只有本次确实运行过的测试才能写入通过记录。

本次没有证明“真实 Esc 恰在 Write/Edit 的某次 await 期间到达”。需要这一端到端断言时，`ui-interrupted` 保留该分支 unverified，写明缺少可观察、可控制的取消阶段。源码依据是宿主 `core/tools/write.js`、`edit.js`、`file-mutation-queue.js`，以及插件 [write-changes.ts](../../../../extensions/codex-ui/src/write-changes.ts)、[tool-status.ts](../../../../extensions/codex-ui/src/tool-status.ts)；调度器的串行中止和并行 signal 检查属于宿主职责。

## Evidence and cleanup

每次运行输出 `.tmp/test-results/codex-ui-<kind>-<mode>-<id>/`。CLI 保存每次进程的 `terminal-N.ansi`、`journey.json`、动作字节、pyte 文本/颜色区间、工具事件、配置/session/工作文件副本。headless 保存原始 JSONL、stderr、工具事件、图片尺寸与文件结果。输出 `passed=true` 仅表示脚本内断言通过。

CLI 的每个 PID 和进程组必须停止，headless 的每个 Popen 必须退出；scratch 必须删除。失败保留原始 failure 和证据，修复后新建一次运行，不覆盖失败记录。这些驱动不启动监听服务；真实本地 MCP 的服务清理由 codemode case 负责。SIGKILL 无法执行 finally，依共享文档检查本次 PID 后处理。
