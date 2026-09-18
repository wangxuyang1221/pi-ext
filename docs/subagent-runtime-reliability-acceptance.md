# Subagent runtime reliability acceptance

## Follow-up review

针对 `91745a52c8296a5e31e22121b6f05c4e59ad0807` 的四项复审意见均已核验，并补入本轮修复。用户提供的 ZIP 中，`file-lock.ts` 与 `command-executor.ts` 的 Git blob SHA 分别为 `d8c209ad428d4d3cd1789d623235c0dfd82b9d57` 和 `f3b13184cfa868977b7b98c0129cd9fcd2e1876b`，与基线一致。检查脚本后在仓库内隔离目录执行锁探针，复现两个持有者同时通过 assertOwned。

| Finding | Reproduction and fix |
| --- | --- |
| Stale lock recovery | 屏障控制两个竞争者读取同一死 owner，并将 A 暂停在新目录已创建、owner 未发布处。原实现出现两个 owner；现在只有成功 unlink 旧 owner 的竞争者能继续 rmdir。增加同进程真实 FS 与两个独立 Node OS 进程回归。 |
| Failed initialization | 经实际 `subagentExtension()` 入口，用损坏 JSON 和 v2 root 触发 session_start 失败，再触发 session_shutdown。原实现锁仍在；现在首次 acquisition 与初始化作为一个共享 Promise，失败回滚锁和授权。已经持有的控制权不会因后续读取失败释放。 |
| Terminal single-target close | 真实 tmux 开启 remain-on-exit，进程退出后先 manager.list，再单目标 close。原实现返回 closed 但 pane 仍存在；现在终态对象也经过资源关闭和退出确认。另补无 locator 时不删除关系的回归，保留历史 alias 的独立分支。 |
| Identity installation order | 真实 Pi/tmux 中暂停 parent 的 set-option，等 child 先查询空实例标记后再放行。原实现登记超时；现在空标记在单次默认 5 秒 lookup deadline 内重查，不重置预算。错误标记、等待期间 server 或 pane PID 改变仍拒绝，超时和取消后不继续查询。 |

四项主要回归均经历明确的 Red → Green；新增保护用例继续覆盖已有控制权不被撤销、共享 alias 不误杀、超时不重发等边界。没有修改第 7、8 项。

### Isolated verification

使用仓库内独立 detached worktree，基线固定为 `91745a5`，仅叠加本轮 subagent 补丁。没有带入主工作区的 codex-compact 等未提交修改；依赖复用相同锁文件对应的 node_modules。Node.js 22.22.2、pnpm 11.9.0、tmux 3.6b、macOS，真实 child CLI 为 0.84.3/0.85.1，parent ExtensionAPI 仍由夹具提供。

| Command | Follow-up result |
| --- | --- |
| `pnpm exec vitest run extensions/subagent/__tests__` | 179 通过、4 个 opt-in 场景默认跳过 |
| `pnpm run check` | typecheck 通过；1,215 项测试通过、4 跳过；已有 MCP prototype suite 无法加载，未出现断言失败 |
| `pnpm run build` | 独立全量构建通过 |
| `pnpm run package:check` | 仍因已有 `docs/goal-descendant-acceptance.md` 缺失失败 |
| 主工作区 subagent tsc 构建与独立构建比较 | 80 个生成文件逐字节一致 |

隔离工作树全仓检查唯一的 suite 加载失败是 `extensions/mcp/__tests__/status-ui-prototype.test.ts` 引用不存在的 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`。原工作区的 codex-compact 未提交测试未带入，因此本轮不能沿用首次验收的全仓测试计数或将两次失败集合混为一谈。

### Follow-up runtime matrix

在隔离工作树分别设置 `PI_SUBAGENT_FIXTURE_DIST=0/1`、`PI_SUBAGENT_ISOLATED_INTEGRATION=1` 及对应 CLI 的 `PI_SUBAGENT_TEST_CLI`，执行：

```bash
pnpm exec vitest run \
  extensions/subagent/__tests__/file-lock.test.ts \
  extensions/subagent/__tests__/runtime-integration.test.ts \
  extensions/subagent/__tests__/isolated-integration.test.ts \
  extensions/subagent/__tests__/production-integration.test.ts
```

| Child CLI | Extension | Result |
| --- | --- | --- |
| 0.84.3 | src | 9/9 |
| 0.85.1 | src | 9/9 |
| 0.84.3 | dist | 9/9 |
| 0.85.1 | dist | 9/9 |

编译产物矩阵中，独立 OS 锁竞争脚本实际导入 dist/file-lock.js，runtime 与 manager 及真实 child 均选择对应 dist；同进程锁调度测试固定调用源码。最后对锁断言再收紧后，源码和产物的锁测试各 2/2 通过。

两个生产入口场景分别为立即安装标记与受控延迟安装。最终矩阵的生产入口和普通 Pi 集成均报告 `livePids: []`、`socketUnavailable: true`：

| CLI / Extension | Production PIDs, immediate / delayed | Isolated fixture PIDs |
| --- | --- | --- |
| 0.84.3 / src | 16006, 16007, 16010 / 16283, 16285, 16288 | 15992, 15991 |
| 0.85.1 / src | 16772, 16773, 16776 / 17019, 17020, 17023 | 16749, 16748 |
| 0.84.3 / dist | 17501, 17502, 17506 / 17786, 17787, 17790 | 17477, 17476 |
| 0.85.1 / dist | 18230, 18231, 18234 / 18527, 18528, 18532 | 18207, 18206 |

锁进程测试确认两个 PID 不同，结束后均返回 ESRCH。真实 dead pane 测试经 manager 关闭链路验证 terminal=absent，并在 finally 关闭独立 server。未启动 TCP 服务。Linux 实机、所有进程终止排列和真实 pane 移动仍不在本次已运行矩阵中。

Context7 查询不可用，测试调度替身的 `vi.mock` / `vi.hoisted` 用法改查 [Vitest v3 官方文档](https://v3.vitest.dev/api/vi.html)。以下保留首次验收记录，计数与矩阵不代表本次复审结果。

## Initial result

审查问题 1–6 的实现和针对性回归已落地。第 7 项计费归属和第 8 项 renderer 未修改。`dist/` 由构建生成，没有手工编辑。

本轮测试基于包含用户既有修改的工作区，不是 `6ec995fae1086e5c00525d6e9a43055e3f625b21` 的干净检出。验收记录生成时尚未创建 commit，也没有对用户正在运行的 namespace 执行升级或关闭。

## Environment

| Component | Version |
| --- | --- |
| Host | macOS |
| Node.js | 22.22.2 |
| pnpm | 11.9.0 |
| tmux | 3.6b，`/opt/homebrew/bin/tmux` |
| Repository Pi SDK | 0.84.3 |
| Real child Pi CLI | 0.84.3、0.85.1 |

所有测试状态、HOME、socket 和临时文件均放在仓库内。Pi 集成使用离线 provider，不调用付费模型。生产入口测试实际调用 `subagentExtension()`，parent 的 ExtensionAPI 与事件由夹具提供，child 则为真实 Pi TUI；不等同于两套版本的完整 parent TUI 人工验收。

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run extensions/subagent/__tests__` | 167 通过，3 个 opt-in 测试默认跳过 |
| `pnpm run check` | typecheck 通过；1,830 测试通过，6 失败，3 跳过，另有 1 个 suite 无法加载 |
| `pnpm run build` | 通过，全量生成 dist |
| `pnpm run package:check` | 失败，已有必需文档缺失 |
| 导入 `dist/index.js` 与 `dist/upgrade.js` | 通过 |
| `pnpm pack --pack-destination <repo-temp>`，检查归档内 subagent 文件 | 80 个生成文件与本地 dist 字节一致，运行说明和验收文档已收录，subagent 源码/测试未打包 |
| `git diff --check`，本轮相关文件 | 通过 |

全仓失败与计划阶段记录一致，均不在 subagent：

- `extensions/codex-compact/__tests__/quality-report.test.ts` 缺少 development/chain evidence 与 pilot corpus audit，另有发布清单断言失败，共 6 项。
- `extensions/mcp/__tests__/status-ui-prototype.test.ts` 缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`，suite 无法加载。
- 发布包检查首先报 `docs/goal-descendant-acceptance.md` 不存在，后续发布项未完成核验。独立打包仅确认本轮 subagent 产物齐全，不能据此宣称全仓门禁或发布包检查通过。

全仓高并发运行时还发现两个测试夹具问题，已修复后重跑：并行 spawn 夹具改用明确的 launch 屏障并等待清理；验证 interruption 持久化的测试不再用 100 ms 同时约束文件 I/O。独立的挂起查询 deadline 测试仍保留短预算，未删除超时断言。

## Real runtime matrix

重建后的源码与 dist 均执行以下命令。`PI_SUBAGENT_TEST_CLI` 指向对应版本的实际 `dist/cli.js`；`PI_SUBAGENT_FIXTURE_DIST` 为 0 或 1。

```bash
PI_SUBAGENT_ISOLATED_INTEGRATION=1 \
PI_SUBAGENT_FIXTURE_DIST=0 \
PI_SUBAGENT_TEST_CLI=/absolute/pi/dist/cli.js \
pnpm exec vitest run \
  extensions/subagent/__tests__/isolated-integration.test.ts \
  extensions/subagent/__tests__/production-integration.test.ts \
  extensions/subagent/__tests__/runtime-integration.test.ts
```

| Child CLI | Extension | Result |
| --- | --- | --- |
| 0.84.3 | src | 5/5 |
| 0.85.1 | src | 5/5 |
| 0.84.3 | dist | 5/5 |
| 0.85.1 | dist | 5/5 |

每格包含真实 tmux 改名、live/dead pane 关闭、server 重启后 pane ID 复用拒绝认领，以及两个真实 Pi 集成场景。production fixture 预先创建带旧 agent directory、旧 tmux 路径和环境 sentinel 的独立 server，验证 child 的有效配置、新 pane 身份、状态握手和关闭清理。

最终矩阵的生产入口与普通集成夹具分别跟踪以下 PID，均报告 `livePids: []`、`socketUnavailable: true`：

| CLI / Extension | Production entry PIDs | Isolated fixture PIDs |
| --- | --- | --- |
| 0.84.3 / src | 81251, 81252, 81255 | 81242, 81241 |
| 0.85.1 / src | 81661, 81662, 81665 | 81652, 81651 |
| 0.84.3 / dist | 82062, 82063, 82066 | 82053, 82052 |
| 0.85.1 / dist | 82494, 82495, 82498 | 82485, 82484 |

真实 runtime 测试也在 finally 中关闭独立 server，并断言其 socket 不再可用；server 重启用例另外确认前后进程均退出。命令执行器测试确认忽略 SIGTERM 的命令与其后代被回收。测试不启动 TCP 服务。

## Regression evidence

这些测试直接调用仓库源码，不使用转录实现代替：

| Area | Evidence |
| --- | --- |
| Identity and close | `tmux-runtime`、`runtime-integration`、`manager-close`、`reliability`：身份未知不判死、不盲杀，dead pane 单独清理，关闭失败保留管理关系 |
| State consistency | `state-store`、`multiprocess`、`runtime-state`：双 Store 与两个真实 Node OS 进程交错写入；settled 不回退；禁止其他进程接管已有 managed binding |
| Controller ownership | `reliability`、`index`：控制权竞争、旧 I/O 取消、旧 guard 失效、namespace epoch 保持、root 切换与失败后的释放 |
| Capacity and recovery | `manager-capacity`、`manager-races`、`reliability`：会话交接空窗、空绑定进程注册表、未知启动 reservation、close-all 与迟到登记 |
| Fault isolation | `state-store`、`reliability`、`scope-performance`：无关坏记录不影响关闭，当前损坏成员占位并诊断，非法计数/控制字段拒绝读取 |
| Launch environment | `index`、`tmux-runtime`、`production-integration`：相对程序路径固定到父端目录，旧 server 配置被清除，父 pane 与凭据不透传 |
| Deadlines and cleanup | `wait`、`operation`、`command-executor`、`reliability`、`tmux-runtime`：挂起查询、signal 传递、进程组终止、取消后的 buffer 清理、原始错误保留 |
| Offline upgrade | `upgrade`：存活写入者、损坏记录、未知版本和仍有 reservation 时拒绝；已有备份/中断临时文件后重试；原字节备份、幂等转换与离线回退演练；原生 JSONL 不变 |
| Existing contracts | 原有 receipt、快速完成、未消费队列、历史 alias、安全关闭、分页、输出预算与 usage 测试继续通过 |

身份不明、stale save、跨 Store 交错、环境继承、取消后的 buffer 清理、控制锁泄漏、跨进程接管与重复父快照读取等测试均经历失败后修复通过。多进程、升级和完整集成测试还承担了最终行为验证，不能把所有新增测试都声称为先出现行为失败。

## Cost and cancellation checks

- 当前 namespace 固定时，加入 0、100、10,000 个无关坏 namespace，list 的状态读取集合及次数相同，全局 `list()` 被夹具禁止，同一进程只探测一次。
- 20 个 alias 共享一个进程，分别验证 alive/exited 分支只探测一次。parent snapshot 读取固定在 15 次以内，退出事实批量写入，而非每个 alias 重读和改写 parent。
- 100,000 条 JSONL 的取消测试在 1,000 ms 容差内返回，不通过截断成功结果改变历史语义。既有 20 条 64 KiB assistant 消息的读取基准继续通过。
- deadline 使用剩余预算；进程组取消测试包含忽略 SIGTERM 的后代；资源清理宽限为 750 ms。wait 取消不终止 child，未知变更保留操作身份。

## Remaining limits

以下未完成项不记作通过：

- Linux 实机矩阵未运行。当前结果来自 macOS，不是跨平台证明。
- pane 移动由结构化观测测试覆盖，未进行真实移动的集成验收。关闭中控制权交接经过可控夹具验证，未穷举真实 parent 在每次文件写入/启动阶段被 SIGKILL 的所有排列。
- 离线升级只支持清理完毕的空 v2 root。不支持在线接管旧 child，也未做文件系统断电注入；测试模拟了备份已写而提交未完成的状态。
- 普通 list 的无关 namespace 成本已实测；read/prompt/close 的作用域路径经过代码核验和既有回归，没有分别完成 10,000 namespace 的全矩阵性能测试。
- 单条极大 JSON 的同步解析和部分投影不是可抢占工作，不承诺任意输入下的硬实时返回。
- 结果未知、没有 locator 的启动仍可能需要人工核验，不能自动释放名额。
- 第 7 项跨 goal 记账时序风险与第 8 项展示问题仍保留。

升级与回退操作见 [runtime guide](subagent-runtime-reliability.md)。
