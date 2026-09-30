# Pi 0.99.1 infrastructure validation

## Scope

主开发与测试基线从 `0.87.0` 升至 `0.99.1`。三个 Pi 开发依赖与锁文件已更新；Node `v22.22.2`、pnpm `11.9.0`、TypeScript `5.9.3`、Vitest `3.2.4` 未升级。

没有修改扩展 `src/` 的生产实现，没有迁移 MCP、扩大 Fast 名单或添加虚拟模型、Codemode、新 OpenAI 订阅认证支持。用户确认只声明支持 `0.99.1`，三个 Pi peer 依赖已精确固定为此版本，不承诺旧版或其他版本兼容。独立集成验收仍有下述两个未解决的失败，升级清单尚未全部完成。

## Review follow-up

下文 Passed checks 保留升级实施阶段的历史结果，不代表当前工作区全绿。审阅修复后的主检查为 `2640 passed / 2 failed / 13 skipped`。两个新增 Write 拒绝断言失败，因为宿主会把 `null`、数字转成字符串并执行写入；缺失、对象、数组的真实拒绝路径通过。环境继承已改允许名单，macOS 普通进程组取消已验证，Linux/Windows 和脱离进程组的强制取消尚未验证。

Goal 已定位为撤销自有 continuation 时中止整个 session，阻止外部 follow-up 继续执行。源码与 dist 的 tmux 均复现关闭后的空锁阻塞删除，不能沿用“仅源码失败”的判断。最终矩阵另发现 Fast transcript 顺序断言失败，尚未确定原因。生产代码未改，方案、各入口复跑及平台限制见 [review fixes validation](pi-0.99.1-review-fixes-validation.md)。

## Infrastructure changes

| Area | Change |
| --- | --- |
| Dependencies | 三个 Pi 开发依赖和三个 Pi peer 依赖均精确固定 `0.99.1`；锁文件和准确版本的安装年龄豁免已同步 |
| Main check | 增加独立 codex-search 类型检查；构建后用真实 loader 检查八个源码入口与八个构建入口 |
| Test environment | `scripts/test.mjs` 为每次 Vitest 创建仓库内的 HOME、agentDir、临时和缓存目录，过滤继承的 provider 凭据环境变量；记录实际宿主、AI、Agent Core、TUI 版本并检查一致性 |
| Host integration | `scripts/check-host-integration.mjs` 复用现有 tmux、SDK、PTY 和性能驱动，明确使用仓库 CLI，隔离凭据，检查进程组清理；Unix 验收与三平台通用 CI 分开 |
| Evaluation | 当前计划传入预期 Pi 版本，worker 与父进程核验实际版本；结果不再写死旧版标签。新增版本不匹配和历史默认值保护用例 |
| Fixtures | 校验首条用户消息已落盘且恢复后不重读 skill；验证默认参数展示和异常参数错误渲染；原测试手工设置错误结果，不能证明真实宿主拒绝，后续执行验收见上文。补齐工具 context、editor/custom UI、子进程就绪握手和真实 transcript 工具读取 |
| PTY | MCP 以会话事件文件确认替换完成，不依赖会被重绘清除的通知；原首帧渲染断言保留。明确 truecolor 能力，避免按 RGB 断言测试 256 色终端 |
| Reports | 当前 accounting、footer 和子进程报告读取实际版本；Goal UI 新证据写入 `.tmp/goal-ui-evidence`，不覆盖历史 adventure 报告 |

历史 fixed-boundary 入口未指定版本时仍要求 `0.87.0`。新计划应为 `plugins.old.piVersion` 和 `plugins.new.piVersion` 都显式指定本轮宿主版本，直接调用 `runPluginCompaction()` 则传入 `expectedPiVersion`。版本不符时 worker 必须失败，不自动改成新版。历史结果和质量分数未重跑或改写。

## Red and green

- 安装新依赖后，原套件复现五个失败，`2617 passed / 5 failed / 13 skipped`。证据为 `.scratch/pi-0.99.1-upgrade/logs/red-suite.log`。
- 生命周期与工具渲染调整后，相关 `70` 个测试通过。独立 codex-search 先复现八处 context 类型错误，补齐 `tools` 和 `executeTool` 后类型检查与 `80` 个测试通过。
- 评估新增预期版本传递用例先失败，调整后 plugin/fixed-boundary 的 `10` 个测试通过。涵盖实际版本报告、错版拒绝、未指定版本仍要求旧宿主、原生拒绝和超时清理。
- 用虚构的 OpenAI key 和 Google credentials 路径检验子进程环境隔离，先复现凭据继承，再过滤环境变量后通过。证据为 `logs/credential-red.log` 与 `logs/credential-green.log`。
- 三个 Pi peer 依赖必须与仓库宿主的精确版本一致。该断言在旧 `0.87.0` 声明上失败，固定到 `0.99.1` 后三个宿主兼容测试通过。证据为 `logs/peer-red.log` 与 `logs/peer-green.log`。
- 真实集成中的夹具缺失接口、就绪握手与通知等待失败均保留过失败证据，再修正夹具；没有删除用例、缩短预览或放宽性能阈值。

## Passed checks

本机为 macOS。通用 CI 配置仍有 Linux、macOS、Windows 三个平台，但没有在本会话中执行远端 CI。

| Check | Result | Evidence |
| --- | --- | --- |
| Frozen install | peer 声明更新后，重新生成锁文件并运行 `pnpm install --frozen-lockfile --ignore-scripts` 通过 | `logs/peer-lockfile.log`、`logs/peer-install.log` |
| Main check | peer 声明更新后，类型检查、测试、构建、包校验和真实宿主加载通过；`174` 个文件通过，`4` 个文件跳过；`2628` 个测试通过，`13` 个测试跳过 | `logs/peer-check.log` |
| Package | peer 声明更新后，`pnpm pack --dry-run` 通过，发布清单仍为八个扩展 | `logs/peer-pack.log` |
| Loader | 源码及构建入口全部加载；确认仓库 `/mcp` 替换 builtin MCP，而不是只忽略警告 | `logs/peer-check.log` |
| Search | 独立类型检查、`80` 个离线测试、普通和全屏 PTY 恢复通过 | `logs/pty-final.log` |
| PTY group | `pnpm run host:pty:check` 通过；覆盖 footer 四种模式、Goal UI 普通与全屏、真实 stdio MCP 调用后恢复、tool status 五种模式、搜索两种模式，以及 root/child accounting | `logs/pty-final.log` |
| Native accounting | `74` 个根场景、`288` 个请求通过；`16` 个受管 OS 子进程场景通过。只替换 HTTP 边界，保留原生 provider 序列化与用量解析 | `logs/accounting-5.log` |
| Terminal recovery | `56` 个终止、恢复和预算场景通过 | `terminal/command/run.log` |
| Python quality | `24` 个测试通过，无付费请求 | `logs/python-quality.log` |
| Benchmark | 原阈值通过；footer 最大 median CPU `12.123 ms`、最大 p95 wall `15.735 ms`，阈值分别为 `60 / 100 ms`；MCP `500` 行等待/流式输入成本检查和历史提取检查通过 | `logs/benchmark.log` |
| tmux distribution | 明确设置 `PI_SUBAGENT_FIXTURE_DIST=1` 后 `12` 个真实 tmux 用例通过，含物理 Codex Fast、角色隔离、认证来源和 delivery receipt | `logs/tmux-dist.log` |

上述相对证据路径均位于 `.scratch/pi-0.99.1-upgrade/`，为本机运行产物，不纳入发布包。主套件仍条件跳过真实 tmux 和在线入口；跳过不算通过。Fast 另通过真实 OpenAI Responses 与 Codex 发送路径验证名单、priority、拒绝提示及手动重试降级。

## Remaining failures

### Goal follow-up preservation

`pnpm run host:accounting:check` 未整体通过。`provider-runtime.mjs` 的 `stale-queued-continuation-followUp` 期望两个请求，实际只有一个。使用缓存的真实 `0.87.0` SDK 复跑同一夹具也出现相同失败，不能归因为 `0.99.1` 专属回归。

证据为 `logs/accounting-5.log` 和 `logs/provider-legacy.log`。原断言保留，生产调度逻辑未改。该 group 在此失败后不会继续；terminal 场景另通过隔离入口单独补验。

### Intermittent tmux close timeout

源码 tmux 的首次 `12` 个用例全部通过，但后续重复运行分别在 full-package-fast、auth-env、auth-stored 等场景出现关闭阶段的 `Subagent operation timed out; mutation outcome may be unknown`。串行运行仍遇到一次失败，不能仅解释为测试并发，也不能用一次构建矩阵通过宣布已经消除。

证据为 `logs/tmux-source.log`、`logs/tmux.log`、`logs/tmux-2.log`、`logs/tmux-serial.log`。未提高 deadline，也没有删掉关闭和回执断言。这是升级实施阶段的记录。后续审阅及修复调查在 dist 同样复现，已定位空锁阻塞删除，完整 tmux 验收仍未完成，见上文 Review follow-up。

## Cleanup and limits

运行结束后，测试报告确认任务进程组停止、私有 tmux socket 不可用、stdio 子进程退出。进程扫描未发现本任务测试目录下的存活宿主。PTY 和 MCP 驱动报告无遗留监听端口；HTTP 测试服务在 finally 中关闭。

未提交、发布或部署，未修改全局 Pi、用户配置或真实会话。远端认证、付费模型请求、历史质量重跑、实际 Linux/Windows CI 和旧版完整兼容矩阵不在已通过的证据中。
