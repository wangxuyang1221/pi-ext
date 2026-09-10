# Goal attachments and UI acceptance

## Status

[Implementation level #9](https://github.com/wangxuyang1221/adventure/issues/9) 工作区实现完成，协调者已独立验收通过并关闭本关，见 [验收记录](https://github.com/wangxuyang1221/adventure/issues/9#issuecomment-5605930818)。协调者核验134文件指纹与双版本结果，另跑完整检查919通过、2默认跳过，日志 `.scratch/goal-9-coordinator-check.log`。依据 [spec #3](https://github.com/wangxuyang1221/adventure/issues/3) 的入口、界面与附件、持久化规则。没有写 GitHub、提交、推送或部署，没有实施 #10。计划见 [Goal attachments and UI todo](goal-ui-todo.md)。

基准 `3972c9e1b6693021fd79d99a0acb19fb62f0260d` 加已验收 #4 至 #8 及研究产物。对照 `.scratch/goal-8-final-checkpoint/manifest.json` 的40个文件，本关只改变其中 `extensions/goal/src/index.ts`、`storage.ts` 和 `__tests__/commands.test.ts`；其他37个文件哈希不变。保留 subagent 修复、C11/C12/C13 与全部既有改动。

## Implementation

- `extensions/goal/src/content.ts` 保存独立内容包。短文本直接保存，长文本或选中图片使用短 objective 引用。权威 goal 保存 `content` metadata，含随机 bundle ID、正文 SHA-256 和有界附件清单。每次编辑创建新包，不原地改旧包；继承快照可继续读取旧包，计费和状态仍各自独立。
- `extensions/goal/src/storage.ts` 为既有 schemaVersion 1 增加可选 content 字段，读取时校验结构。replace/edit 将引用与目标原子提交，pause/resume、计费、继承及其他状态变化保留字段。旧记录无需迁移。
- `extensions/goal/src/index.ts` 使用 Pi 原生 `select`、`editor`、`confirm`、`notify`。提交目标前，对当前 Pi 临时目录下完整的 `pi-clipboard-<UUID>.<ext>` 路径逐项选择 `Copy attachment`、`Keep as text` 或 `Cancel`。未确认前不读文件内容。其他路径保持普通文本，不推断为附件。
- `/goal edit` 只反解带本插件 metadata、精确匹配生成引用且校验和有效的文件。用户手写相似引用不会触发读取。`/goal` 显示前1000字符预览、附件数、受控引用、状态、累计用量/时间及命令；编辑打开完整正文。
- 文件读取使用普通文件检查、目录符号链接检查和 `O_NOFOLLOW`。拒绝路径遍历、源文件符号链接、内容目录或文件符号链接。只支持原生粘贴涉及的 PNG/JPEG/GIF/WebP，检查类型签名，不宣称验证所有格式内部结构。
- 内容文件使用独占创建、0600权限与 fsync，目录0700。权威提交前的失败仅清理当前实例当前 draft 中记录了 inode/dev 的文件，非递归删除。目录或文件被替换时保留，不删外部文件。权威记录无法证明未提交时不清理，避免 post-rename 错误导致已提交附件消失。
- `extensions/codex-ui/src/footer.ts` 消费既有 `setStatus("goal", ...)`，有目标时增加第二行；第一行原布局保持，状态变化参与缓存比较，清除时移除第二行。goal 没有调用 `setFooter` 或 `setEditorComponent`。默认 Pi footer 继续展示同一 status。
- `README.md` 说明操作、安全边界、内容保留与限制；`extensions/goal/UPSTREAM.md` 记录本地适配归属。固定上游提示、工具与 Apache-2.0 归属说明保留。

## Resource boundaries

TUI 正文最多1 MiB、最多32张保存图片、单图20 MiB。超限报告英文错误并保留旧目标，工具仍是4000 Unicode字符。这些是本关文件读取的资源防护，不是 token 预算，也不改 C11/C12/C13。识别前检查正文大小；未加载 codex-ui 无需额外依赖。

状态渲染不读取正文或附件，没有新增后台服务、轮询或模型请求。编辑时顺序验证与复制明确附件，成本随正文和附件大小增长，不扫描其他包。成功提交的旧包不随 clear、replace 或 edit 自动删除，以保留历史与显式继承引用；长期空间随保存次数增长。垃圾回收不在本关范围，备份应包含完整 goals 目录。

双版本 SDK 的1 MiB纯文本测量见 `.scratch/goal-9-final-runtime-{0843,0851}/results.json`。0.84.3物化17.64 ms、反解1.98 ms；0.85.1物化17.37 ms、反解1.82 ms。峰值RSS分别约188 MB和225 MB，包含SDK与前面的工具测试，不是单独内容模块的内存用量。此为单次边界负载记录，无吞吐或跨机器耗时保证。

## TDD evidence

每轮先确认行为失败，再实现并运行当前及相关测试。日志均在 `.scratch/`。

| Behavior | Red | Green |
| --- | --- | --- |
| 长 Unicode正文物化、重建实例后反解 | `goal-9-red-content.log`，4001未变短 | `goal-9-green-content.log` |
| 选中图片持久复制、源消失后读取 | `goal-9-red-images.log`，缺少content | `goal-9-green-images.log` |
| 任意选中路径、遍历、源与目录符号链接 | `goal-9-red-paths.log`，任意路径被接受 | `goal-9-green-paths.log` |
| 伪造引用和附件篡改 | `goal-9-red-reference.log`，篡改附件仍可打开 | `goal-9-green-reference.log` |
| 非图片、超限及失败包清理 | `goal-9-red-cleanup.log`，非图片被接受 | `goal-9-green-cleanup.log` |
| 编辑复制旧附件，不改变继承快照 | `goal-9-red-edit-content.log`，编辑丢metadata | `goal-9-green-edit-content.log` |
| TUI保存、关闭绑定、重开编辑完整正文 | `goal-9-red-command-long.log` | `goal-9-green-command-long.log` |
| 原生路径选择及未确认不读取 | `goal-9-red-command-images.log` | `goal-9-green-command-images.log` |
| codex-ui目标行、实时缓存更新、原首行不变 | `goal-9-red-footer.log` | `goal-9-green-footer.log`，全部146个codex-ui测试通过 |
| 摘要包含已保存长正文预览 | `goal-9-red-summary.log` | `goal-9-green-summary.log` |
| 清理不删被替换的文件 | `goal-9-red-cleanup-identity.log` | `goal-9-green-cleanup-identity.log` |
| 识别候选前拒绝超限文本 | `goal-9-red-candidate-limit.log` | `goal-9-green-candidate-limit.log` |

补充回归覆盖取消编辑/附件选择、post-rename不确定提交保留、精确路径token与带空格临时目录、超限图片、伪造编辑引用、实际工具4000/4001边界、旧目标状态与统计保留。初次缺模块的运行不作为行为Red；`goal-9-red-content.log` 已是可运行实现返回4001字符时的断言失败。

## Real runtime matrix

实际环境为 macOS、Node.js 22.22.2、pnpm 11.9.0，Pi 0.84.3与0.85.1。0.84.3为仓库实际依赖，0.85.1为用户提供的宿主安装包。均使用独立仓库内HOME、agent dir、session dir、TMPDIR，关闭启动联网和遥测，fetch遇调用即抛错。没有付费在线模型请求。

### Native InteractiveMode and clipboard fixture

入口 `extensions/goal/__tests__/content-tui.mjs`，驱动 `content-tui-driver.py`。最终四个目录每个包含两个真实PTY进程，第一进程创建并保存，退出后第二进程打开原生session文件。

- `.scratch/goal-9-final-tui-0843-ui0/`，Pi 0.84.3，默认UI。
- `.scratch/goal-9-final-tui-0843-ui1/`，Pi 0.84.3，加载完整codex-ui。
- `.scratch/goal-9-final-tui-0851-ui0/`，Pi 0.85.1，默认UI。
- `.scratch/goal-9-final-tui-0851-ui1/`，Pi 0.85.1，加载完整codex-ui。

每个目录保存 `results.json`、`saved.json`、`events-{create,reopen}.jsonl`、`terminal-{create,reopen}.ansi`、`pids.json`、`cleanup.json`，以及实际目标和会话文件。

驱动通过终端输入粘贴长目标，再发送原生Ctrl+V。测试先把安装包的native clipboard对象全部方法替换为禁止真实访问的桩，只有hasImage/getImageBinary返回仓库内构造图片。实际 Pi `handleClipboardPaste` 执行，生成随机临时文件并插入当前editor；没有直接构造一个路径冒充这段原生粘贴调用。native图片数据读取桩不触碰系统剪贴板。

之后实际显示附件选择，Enter确认复制。离线faux OpenAI Codex provider完成目标，真实工具返回无错误，再执行pause。退出前删除Pi生成的临时源，重开时原生 `/goal` 显示预览、`/goal edit` 收到与保存正文完全一致的prefill，通过原生多行editor键盘输入追加 `EDITED_AFTER_REOPEN` 并保存。新包与旧包不同，旧目标快照仍能完整反解。

两阶段均使用对应版本原生 `createReadTool` 读取持久图片，要求返回真实image块，不把文本错误当成功。重开阶段确认源文件已删除后的图片读取、目标ID和用量不变、paused保留、零模型请求。每阶段记录进入对话框前后的实际editor/footer对象身份相等。codex-ui为 `CodexEditor`/`CodexFooter`，默认UI为 `CustomEditor`/`FooterComponent`；实际footer和ANSI输出都含 `Goal: paused`。

调试运行不计最终证据。首版PTY一次大块写入未及时排空输出而卡住，驱动已改为非阻塞分块输入并排空输出。第二次运行暴露测试PNG内部损坏，原生read拒绝，外层断言正确失败；改用本地Pillow生成的16×16有效PNG，保留原生image断言。最终四目录全部在最终生产代码构建后重跑通过，不引用失败目录代替验收。

复现默认UI示例，证据目录必须全新：

```sh
GOAL_UI_CODEX=0 conda run -n codex-py312 python \
  extensions/goal/__tests__/content-tui-driver.py \
  .scratch/goal-9-recheck-0843 \
  node_modules/@earendil-works/pi-coding-agent
```

将 `GOAL_UI_CODEX` 改为1加载codex-ui。0.85.1使用宿主包绝对路径，不修改开发依赖。

### Unicode tool boundary

`extensions/goal/__tests__/content-runtime.mjs` 在真实Pi SDK绑定TUI mode，使用原生工具执行链和离线faux provider。不是PTY，不冒充上一节真实UI。

最终 `.scratch/goal-9-final-runtime-0843/` 与 `goal-9-final-runtime-0851/` 均通过。第一组模型实际调用create_goal提交4001个非BMP字符，tool_execution_end.isError=true，未创建目标。第二组4000字符成功，未物化，随后complete成功；其余工具结果全部非错误，共五次离线faux调用。`results.json` 保存版本、PID、边界结果及性能记录。

## Final checks and sources

- `pnpm run check` 通过。最终日志 `.scratch/goal-9-final-check.log`：77文件通过、2跳过；919测试通过、2跳过；类型检查、构建、7个扩展发布包校验通过。默认跳过在线subagent与独立开关isolated integration，本关未重新运行这两项，不把check当作它们通过。#8真实子代理证据仍由原验收报告承接，#10负责整体验证。
- `git diff --check` 通过，`.scratch/goal-9-diff-check.log`。
- 仅由构建生成dist，没有手改。package依赖版本与lockfile未改，没有安装新依赖。
- 完整读取固定0.84.3的README、extensions.md、tui.md、sdk.md、session-format.md及status-line/handoff示例；宿主差异全文见 `.scratch/goal-9-pi-doc-diff.txt`。按同内容加完整diff核对0.85.1，native clipboard路径逻辑两版本一致。相关公开UI接口及原生多行editor/paste源码均核对。
- Context7 `/earendil-works/pi` 只返回main，未覆盖所需固定版本，未以其结果声称双版本支持。固定依据为两份实际发布包源码及上述运行结果。来源入口：[Pi仓库](https://github.com/earendil-works/pi)、[0.84.3发布包](https://www.npmjs.com/package/@earendil-works/pi-coding-agent/v/0.84.3)、[0.85.1发布包](https://www.npmjs.com/package/@earendil-works/pi-coding-agent/v/0.85.1)。

## Checkpoint and cleanup

可恢复检查点 `.scratch/goal-9-final-checkpoint/manifest.json` 记录HEAD与当前所有modified/untracked发布相关文件的SHA-256，同目录 `files/` 保留对应副本、`tracked.patch` 与 `status.txt`。用于核验和人工恢复，不授权覆盖后续工作区。源码/测试归属见 Implementation 与 TDD 章节，#8的37个非本关文件保持原哈希。

`.scratch/goal-9-check-processes.json` 记录最终check进程树的137个进程，全部退出。`.scratch/goal-9-cleanup.json` 汇总check和所有本关记录的SDK/PTY尝试共159个PID，全部退出，对应TCP监听为空。没有启动服务或专用tmux socket，没有停止用户或协调者进程。测试证据目录保留，未清除其他记录或用户文件。

## Limits and next step

本关V4附件与UI验收项已有双版本证据并通过协调者复核，不宣称整个goal交付完成。没有扩大C11/C12/C13，不改Pi核心或重建编辑器。文件存储继承原有异常退出边界，不承诺断电零丢失；不测试同权限恶意进程在每次系统调用之间持续替换整个受保护目录树的竞态，也不声称插件是操作系统沙箱。

协调者核对本报告、manifest和最终runtime/TUI结果后代同步#9及#3。#9验收后再交由独立#10 worker做完整集成矩阵；不要跳过#10，也不要沿用调试失败目录作为成功证据。
