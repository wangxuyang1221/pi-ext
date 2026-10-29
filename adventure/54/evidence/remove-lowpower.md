# Remove lowpower

## Scope

对应 Issue #60。基准 `01be7d6fb5be896eebc705ac0e2d2da3ad175432`，工作区 `.scratch/worktrees/pi-animation`，分支 `adventure/pi-animation`。

删除 `/lowpower` 注册、参数补全、extension 状态、Write 执行捕获的模式参数、Write/Edit/Bash/codemode 的专用分支及缓存，始终使用原有默认完整行为。移除仅为切换模式而暴露的 codemode refresh 回调。已有 Bash 分组、Write 快照与 diff 限制、codemode 原始结果及布局预算保持不变。

当前 README、验证 skill、features.json 和正式 CLI/PTY 驱动同步更新。旧 lowpower feature 删除，工具验证新增 `ui-tool-rendering`，覆盖完整显示和已删除命令的真实清单/补全检查。历史 adventure 材料没有追改。

## Environment

Doctor 输出保存在 `.tmp/remove-lowpower-doctor.json`。本工作区独立依赖，`sharedDependencies=false`，无验证锁。实际 Node `v22.22.2`、pnpm `11.9.0`、Pi 四包 `1.4.0`、Python `3.12.13`，Conda 环境为 `codex-py312`。

所有 pnpm 调用使用命令级 `pnpm_config_verify_deps_before_run=false`，未安装或修改全局 Pi。Doctor 的 subagent socket 长度提示不适用于本次 codex-ui 验收，本次未运行 subagent/tmux 场景。

## Red and green

1. 在删除实现前，`pnpm test extensions/codex-ui/__tests__/index.test.ts` 新增两条行为约束。旧实现仍注册 lowpower，`commands.has("lowpower")` 为 true；session_start 仍写入低功耗状态。两处有效失败，日志 `.tmp/remove-lowpower-red.log`。
2. 首次删除模式后，`pnpm test extensions/codex-ui/__tests__` 通过 34 个文件、270 条用例，日志 `.tmp/remove-lowpower-unit.log`。最终删除无调用 stable-key 辅助分支及其专用测试后，复验为 34 文件、269 用例，日志 `.tmp/remove-lowpower-unit-final.log`。
3. 旧测试中仍适用的 pending 参数隐私、只读取一次错误内容、旧无 metadata Write 总行数、主题代理更新、错误/取消、静态状态、缓存有界与重复 ID/未绑定 candidate 保护保留或改为完整 renderer 断言。只删除已失效的短预览、隐藏 Bash 正文和模式锁定/切换断言。

## Retained regression coverage

| Removed strategy | Remaining protection |
| --- | --- |
| Write/Edit 短预览与模式锁定 | `tools.test.ts` 保留 pending 参数隐私、失败不读取 diff、错误 getter 单次捕获、旧无 metadata Write 行数及主题代理更新；真实完整 diff 使用持久变化测试与 CLI 原字节验证 |
| Write 不读取旧正文、不生成 diff | 该模式专用预期删除；`write-execution.test.ts` 保留真实 Added/Edited patch、队列并发、提前/晚取消和有界快照；自定义 factory 仍不探测本地文件 |
| 低功耗 Bash 的隐藏正文、短尾部、模式锁定 | `grouped-bash.test.ts`、`grouped-bash-cache.test.ts`、`claude-bash-performance.test.ts`、`rendering-pipeline.test.ts` 保留输出边界、展开、失败/超时/取消、增量缓存、不重复扫描和无刷新计时器 |
| 旧模式形成的分组屏障 | 重复 ID、历史未绑定 candidate、text/thinking/其他工具屏障及已绑定旧成员归属仍由 `grouped-bash.test.ts` 覆盖；对应生产所有权逻辑未删除 |
| codemode 短 fallback 与切换 | `codemode-view.test.ts` 保留 child/inspector 缓存复用和淘汰提示；原生子 renderer、树/inspect/内存预算由现有集成、模型和 CLI/PTY 覆盖 |

## Final cleanup

引用检查发现 `tools.updateComponent` 的 `cacheKey` 参数，以及 `ResponsiveLinesComponent` 的稳定 key 保留分支，删除模式后均没有生产调用。它们仅为原 lowpower 的跨 renderer 替换缓存服务，因此一并删除；对应专用用例删除。按宽度的正常缓存、renderer 替换时失效、显式 invalidate、宽度变化重算，以及有界 ToolRenderCache 均保留。

这一步没有改动任何原 full 调用的执行路径，因为所有 full 调用此前都没有传 key，始终替换 renderer 并失效。源文件中已没有 lowpower 状态或 cacheKey 分支。最终复验使用组件测试、真实宿主 rendering pipeline 和完整 check，均通过；前面的普通/全屏 CLI 证据验证同一默认路径，不机械重复全部旅程。

## Verification

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm test extensions/codex-ui/__tests__` | passed，34 文件 / 269 用例 | `.tmp/remove-lowpower-unit-final.log` |
| `pnpm run check` | passed，196 文件 / 2898 用例；构建、类型、脚本/链接、密钥、发布边界、source/dist 宿主加载均通过 | `.tmp/remove-lowpower-check-final.log` |
| `pnpm exec tsc -p extensions/codex-ui/tsconfig.json --noEmit --noUnusedLocals` | passed | 无剩余未使用声明 |
| `pnpm run hooks:check` | passed | 本 worktree 的仓库 pre-commit hook 已生效 |
| `conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/cli.py regular` | passed，124 断言 / 113 画面 | `.tmp/test-results/codex-ui-cli-regular-1793240173725260000/` |
| 上述 `cli.py fullscreen` | passed，124 断言 / 113 画面 | `.tmp/test-results/codex-ui-cli-fullscreen-1793240260879553000/` |

两种真实 CLI 共同检查：

- `ui-tool-rendering`：startup/fork/resume/reload/new 的真实命令清单保留 inspect、没有 lowpower；真实输入 `/inspec` 后 Tab 打开菜单，再 Tab 接受补全，`/lowp` Tab 没有已删除命令候选。
- `ui-write-added`、`ui-write-edited`、`ui-diff`：新建前后磁盘原字节、reload 后覆盖、真实 Write/Edit 同文件结果为 `EDIT-PAIR-full\n`、完整折叠预览及展开 diff。4002 行显示 Diff unavailable，控制序列保留磁盘原字节而不能执行 OSC 标题。
- `ui-bash-preview`、`ui-expand`：长命令、多行、截断标记与 Ctrl+O 展开。真实独立 Bash 在 BEGIN-CANCEL 可见后 Esc，结果包含 Command aborted，延后副作用文件不存在。
- `ui-codemode-cache`、`ui-inspect-tabs`、`ui-inspect-scroll`、`ui-codemode-resume`：真实读取超过 4MiB 后旧项缺失提示、末项可读，实际 Tab/Shift+Tab、方向键和翻页；原生 resume/tree 后继续请求并核对已保存上下文，raw cache 不从历史捏造。
- 另覆盖真实 theme 设置、composer ANSI 单元格、完整 Thinking、标题动画与停止、执行配置拒绝/修复以及 companion footer。完整功能验收仍遵循下文人工边界。

第一次 CLI 运行在正向补全检查失败，原因是错误假定首个 Tab 直接替换输入。宿主实际先打开候选菜单，第二个 Tab 接受。驱动已按实际交互修正，保留原始失败目录 `.tmp/test-results/codex-ui-cli-regular-1793240133302250000/`，后续完整普通/全屏旅程通过。

专用入口结果：

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run codex-ui` | passed，cleanup=removed，process.groupStopped=true | `.tmp/test-results/verify-codex-ui-wjrWH1/` |
| 上述 `run codex-ui-fullscreen` | passed，cleanup=removed，process.groupStopped=true | `.tmp/test-results/verify-codex-ui-fullscreen-7ZpMv3/` |
| 上述 `run tool-status` | passed，普通/全屏播放与重开、MCP 重开共三条；cleanup=removed，process.groupStopped=true | `.tmp/test-results/verify-tool-status-a4gah7/` |

codemode 的 `ui-codemode-order`、`ui-codemode-failure`、`ui-inspect-tabs`、`ui-codemode-resume` 通过真实 QuickJS、嵌套工具、本地 MCP stdio、父完成但子失败、预览外失败、错误/取消、主题、分支/reload/compact/restart 验证。额外断言最终完整展开仍显示 native Read 子 renderer。

tool-status 的 `ui-read-group`、`ui-error` 与 `ui-interrupted` 已覆盖的状态分支，通过生产 renderer 播放、静态等待、失败/中断/超时颜色、分组、reload 与冷重开验证。该夹具替换工具结果，文件副作用依据前面的真实 CLI 与执行测试。`ui-interrupted` 的 Write/Edit 文件 await 期间真实 Esc 分支仍整体记为 unverified。

`conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/headless.py` 通过 12 个 print/json 与 RPC 场景。覆盖真实 Bash 文件字节、图片原尺寸/缩放和配置破损/不可读时的无副作用拒绝。证据 `.tmp/test-results/codex-ui-headless-1793240719651155000/`，所有 case passed，scratchRemoved=true。此入口也验证新增的公开命令清单观察代码可在 print/RPC 正常加载。

## Resource bounds

本次沿用原 full 的成本约束，Write 旧/新正文各最多 1MiB、合计最多 4000 行时生成 diff，patch 最多 2MiB；超限仍执行原工具并明确显示 Diff unavailable。codemode 的父/子数量限制、原始结果与布局各 4MiB 预算不变。Bash 的稳定重复绘制不重新清理/计数/扫描内容、布局预算与增量更新由现有确定性测试保护。删除模式不引入新的全历史扫描、文件读取或计时器。

没有为本关重设 CPU 指标或声称动画优化已完成，相关动画/局部刷新工作仍由其他切片承担。

## Evidence boundaries

真实 CLI 的模型响应由离线 provider 提供；宿主、QuickJS、工具执行、文件、session、选择器与生产 renderer 实际运行。不会据此声称远程模型会生成相同工具调用。

Write/Edit 文件操作没有可观察、可控制的阶段进度。本次保留实际预先取消与受控晚取消的执行测试；真实 Esc 恰好命中文件 await 阶段仍为 `unverified`。取消不回滚已完成文件写入。真实终端像素、拖选和系统剪贴板仍为 `unverified`。

## Cleanup

仅核对本次驱动及其实际后代，用户原型进程未扫描或操作。三条共享 helper 均为 cleanup=removed，process.groupStopped=true，归档无错误，验证锁已删除。

| Run | Recorded PIDs | Final state |
| --- | --- | --- |
| 首次 CLI 补全假定失败 | 48629 | stopped/groupStopped；scratch 删除，失败证据保留 |
| CLI regular | 48939, 49418, 49467, 49555, 49608 | 全部 stopped/groupStopped；scratch 删除 |
| CLI fullscreen | 49699, 50091, 50197, 50281, 50339 | 全部 stopped/groupStopped；scratch 删除 |
| Codemode regular | driver 55979，7 个观察到的进程含两个 stdio MCP server | 全部停止，helper scratch 删除 |
| Codemode fullscreen | driver 57632，8 个观察到的进程含两个 stdio MCP server | 全部停止，helper scratch 删除 |
| Tool-status | driver 58510，24 个观察到的后代进程；PTY 为 58707, 60069, 61505 | 全部停止，helper/fixture scratch 删除 |
| Headless | 67948, 67953, 67957, 67959, 67967, 67983, 67986, 67991, 67995, 68000, 68003, 68025 | 12 case 全部 stopped/groupStopped；scratch 删除 |

共享入口额外的按父 PID 递归只读观察记录在 `.tmp/remove-lowpower-codemode-regular-processes.json`、`.tmp/remove-lowpower-codemode-fullscreen-processes.json`、`.tmp/remove-lowpower-tool-status-processes.json`。最终 `.tmp/remove-lowpower-cleanup.json` 对上述合计 62 个已记录 PID、37 个进程组逐一执行存在性检查，均不存在；针对这些 PID 的 TCP LISTEN 检查为空。codemode 使用 stdio MCP，没有启动 TCP 服务或分配监听端口。普通 test wrapper、检查命令和只读观察进程也都正常返回，没有保留后台任务。
