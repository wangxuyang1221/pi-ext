# Pi 0.99.1 review fixes todo

## Understanding

修复升级审阅发现的测试进程清理、凭据隔离和异常 Write 参数验收问题。另行查明 Goal follow-up 与源码/dist tmux 超时的原因；若需要修改生产逻辑，先提交最小方案并取得授权。

用户已授权执行本计划中的基础设施修复与调查，未授权修改 Goal/subagent 生产逻辑。实施结果见 [review fixes validation](pi-0.99.1-review-fixes-validation.md)。整份计划未完成，未通过项保留未勾选。原审阅报告位于本机忽略目录 `.scratch/pi-0.99.1-review/review.md`。

## User Visible Changes

- 取消 `pnpm test` 后，测试 worker 和本任务监听端口应停止；不再先删除临时 HOME、留下仍在执行的测试。取消或清理失败返回非零状态。
- 测试不再继承开发者或 CI 的 AWS 认证来源。正常离线测试和明确支持的集成测试开关继续可用。
- 插件命令、权限和原有物理模型工作流无预期变化；异常 Write 参数的执行契约不变，只补齐真实宿主验收。

## Todo

### 1. Locate

- [x] 确定 `scripts/test.mjs` 的跨平台进程归属与关闭方案。Unix 优先使用任务独占进程组；Windows 必须能在 pnpm 提前退出后仍清理 worker，不能假定父 PID 存活或直接复用负 PID 信号。核对 `scripts/check-host-integration.mjs` 和现有 `stopProcessGroup()` 的嵌套调用，明确普通子进程、PTY 新会话和私有 tmux server 各由谁清理，以及清理期限的依据。
- [x] 盘点主测试所需的系统环境变量、pnpm 启动信息及测试开关，确定最小允许名单。核对 `0.99.1` provider 的实际凭据入口与 Windows 环境变量大小写，避免改用 `PI_*`、`AWS_*` 等宽泛放行规则。
- [x] 定位 Goal follow-up 失败，区分 Goal 撤销自有 continuation、宿主队列调度与夹具时序的责任；输出导致保留输入未继续执行的具体路径和最小调整方案。旧 `0.87.0` 同样失败不是自动豁免依据。
- [x] 定位 tmux `auth-stored` 等用例的操作超时，明确卡在关闭请求、宿主退出、pane 消失、receipt 还是驱动等待。审阅已在 dist 复现，不能只调查源码加载或归因于并发；输出根因证据及最小调整方案。

### 2. Implement

- [ ] 修复 `scripts/test.mjs` 的进程生命周期。正常结束、非零退出、启动失败、取消与强制终止走同一个幂等清理流程；先确认任务进程停止，再删除临时目录。重复信号不重复启动清理，忽略信号的子进程在有界期限内被强制停止。无法确认停止时返回明确失败并保留诊断目录，不误杀用户进程。仅在确有复用需要时抽取小型进程管理 helper，不重写无关评估 runner。
- [x] 将 `scripts/test.mjs` 的环境继承改为允许名单，再显式设置仓库内 HOME、agentDir、TMP、XDG 和 Windows 配置目录。保留已盘点的必要测试开关，拒绝隐式认证、用户配置和会话路径透传；测试在自身内部注入的虚构凭据不受影响。构造环境只遍历一次，不为每个测试重复扫描系统配置或调用外部命令。
- [x] 在 `extensions/codex-ui/__tests__/` 补齐真实宿主的 Write 参数验收。按用户确认保留宿主语义：缺失、对象、数组验证拒绝和无文件变更，null/数字验证转换后的确切内容及真实成功结果。保留现有 fallback 折叠、展开和正常调用渲染断言；不能以手工注入 `isError: true` 代替执行结果。

### 3. Deliver

- [x] 同步 README、基础设施 validation 和升级 todo，准确记录取消与隔离保证、三平台证据、Write 执行验证，以及 tmux 已在 dist 复现的事实。三个审阅问题和两个既有集成失败分别记录状态，未解决项保持未完成。

## How To Test

### Red first

先将以下行为写成失败用例，再做对应修复。普通回归测试接入现有测试发现范围，避免只保存在 `.scratch/`。

- **进程清理。** 用真实 wrapper → pnpm → Vitest → worker 启动本地 listener，通过就绪握手取得 PID 和端口，再只向 wrapper PID 发送 `SIGTERM`。当前实现应复现“wrapper 已退出、HOME 已删除、worker 和端口仍存活”。修复后断言 worker 和 listener 停止后才删除目录，返回非零状态。测试监督进程独立负责兜底清理，避免失败用例本身泄漏。
- 覆盖 `SIGINT`、重复取消、子进程忽略终止信号、pnpm 提前退出留下后代、正常成功及失败退出。启动失败可在 spawn 边界注入，进程树清理不能仅靠 mock 证明。加一个不属于本任务的受控对照进程，确认不会误杀；对照进程也由测试最终清理。
- **凭据隔离。** 外部父进程向真实 wrapper 注入虚构值，至少覆盖 OpenAI key、Bedrock bearer token、web identity token 文件、AWS 容器凭据 URI、profile/credentials/config 路径及 Google credentials。子进程断言这些变量不存在，隔离的 ModelRuntime 不因这些输入获得可用认证来源。禁止真实 token、真实身份文件读取及远端请求。
- 同时断言必要的 PATH、平台变量、源码/dist 集成开关正常传递；目录覆盖仍指向仓库隔离目录。不能让测试直接继承真实父环境来验证允许名单。
- **Write 参数。** 固定离线 provider 响应仅用于产生 `write` tool call，分别提供缺失 content、`null`、数字、对象和数组。调用必须经过真实宿主及仓库工具定义。缺失、对象、数组须拒绝且文件不变；null/数字按已核验且用户确认保留的宿主转换语义，验证执行器收到字符串、文件确切内容和真实成功结果。增加合法字符串对照，保留 fallback 及自定义渲染验收。不得伪造校验后的 tool result。

### Failure investigation

- Goal 使用独立目录复跑 `provider-runtime.mjs`，记录自有 continuation 与外部 follow-up 的入队、撤销、出队和 settle 顺序。保留“两次请求”和 `PRESERVED_INPUT` 断言；只在网络响应边界替代真实请求，不预先构造处理后的队列。
- tmux 对源码和 dist 的同一用例记录操作各阶段的单调时钟、任务 PID、私有 socket、pane 与 receipt 状态。在原 `5 s` deadline 下分别单独和整组串行复跑，每种实现至少连续运行三次用于比较；重复通过不能单独证明根因消除。
- 两项调查若指向夹具，先说明原验证目的为何仍被保留，再确定修正。若指向生产实现，停在根因与最小方案，取得授权后补充实施项；不能把期望请求数改成 1、删除关闭断言或延长 deadline。

### Resource and cost acceptance

- 正常成功退出不应固定等待整个优雅退出窗口；资源已经停止时立即完成清理。
- 取消清理有统一期限，按单个任务计时，不能为每个后代串行等待完整期限。用少量及较多 worker 的受控负载检查这一点，并断言重复信号只触发一次关闭流程。
- Unix 正常路径不循环扫描全机进程。需要追踪脱离进程组的资源时，只记录本任务创建的 PID、私有 socket 等标识，不按进程名批量杀进程。
- 具体清理期限在 Locate 中依据候选方案和受控实验确定并固化为测试，不能照搬当前耗时加宽裕倍数，更不能用它放宽生产操作 deadline。

### Final validation

使用仓库依赖，先完成构建，再串行运行依赖 dist 的验收：

```bash
pnpm run check
pnpm pack --dry-run
pnpm run host:accounting:check
pnpm run host:tmux:check
pnpm run host:pty:check
pnpm run host:benchmark:check
pnpm run codex-compact:quality:check
```

- 主检查及新增 wrapper/Write 回归必须通过。保持精确 `0.99.1`、八个发布入口、历史 quality 默认 `0.87.0` 的错版拒绝和现有性能阈值。
- 在 macOS、Linux、Windows 上验证通用 wrapper；Unix 专用 tmux/PTY 验收仍只在支持平台运行。未获得某平台实际执行证据时明确标为未验证，不以 mock 或 skip 代替。
- accounting 与 tmux 在根因处理前可能继续失败，必须分别记录，不能将新修复通过等同于整份升级通过。被 fail-fast 阻断的 terminal 或 dist 路径使用独立隔离入口补验，不能用补验覆盖失败记录。
- 日志写入新的仓库内证据目录，不覆盖原审阅记录。结束前核对受管进程、私有 tmux socket 和监听端口均已清理。

## Current status

Write 与 wrapper 两项主检查失败已修复。wrapper 的实际失败是退出期间信号 0 探测返回 EPERM，被误当成不可恢复错误；现在继续原有有界等待，只有 ESRCH 才确认组不存在。新增暂时/持续 EPERM 回归均通过，真实八路并行取消从 4/8 失败变为 8/8 通过。

`pnpm run check` 连续三次完整通过，`2644 passed / 13 skipped`；pack dry run 通过。Linux/Windows 未实跑，detached 资源强杀仍未验证，因此跨平台生命周期总项不勾选。tmux 按用户要求暂不处理，Goal SDK 的兼容性差异仍保留。详见 [main check validation](pi-0.99.1-main-check-validation.md)。下方状态是此前各轮的历史记录。

## Test fixes status

用户在调研后授权拆分并修复 Fast/Goal 测试，覆盖了原计划将 SDK 与 TUI 一律要求两次自动请求的假设。Fast 只补等待实际回复落盘，正式完整场景连续三次通过。Goal 的 TUI 用例按 C11 验证输入可找回及显式重发；SDK 单独记录取消后保留队列但不自动执行的兼容性差异，不宣称历史保证已恢复。provider 26 场景通过，accounting 整组通过。

当前主检查两次均为 `2639 passed / 3 failed / 13 skipped`：两个 Write 预期冲突，以及 wrapper 全套运行时的 HOME 清理断言。wrapper 单独八个用例通过，原因尚未定位。生产逻辑未改，tmux 按用户要求暂不处理。详见 [test fixes validation](pi-0.99.1-test-fixes-validation.md)。以下 Execution status 保留上一轮记录。

## Execution status

- 凭据允许名单及八个 wrapper 回归通过。Unix 普通进程组清理已在 macOS 验证；Windows Job Object 已实现但未实跑，Linux 同样未实跑。脱离进程组的 PTY/tmux 资源在强制取消下尚未验证，因此生命周期项未勾选。
- Write 六类真实执行验收已加入，缺失、对象、数组拒绝和合法字符串对照通过。宿主会将 `null`、数字转换为字符串并写入，违反本计划的拒绝预期。保留两个失败断言，待用户选择保持宿主语义或授权严格拒绝。
- Goal 证实全 session abort 阻止排队的外部 follow-up 继续执行；tmux 证实关闭进程后 `store.delete()` 被空锁目录阻塞。方案及证据已记录，生产修复待授权。
- 最终主检查 `2640 passed / 2 failed / 13 skipped`。accounting 仍失败；最终 tmux 源码还出现 Fast transcript 顺序断言失败，不能混同为空锁问题。单独 dist 补验 12 通过不抵消已复现的超时。
- 构建、包校验、pack dry run、源码/dist loader、PTY、benchmark、Python quality 和独立 terminal 补验通过。完整日志索引见 validation。

## Notes

- 当前审阅基线是主检查 `2628 passed / 13 skipped`。Goal follow-up 预期两个请求、实际一个；tmux 本轮源码 12 通过，dist 11 通过、1 个 `auth-stored` 超时。这些是调查输入，不是可接受失败的默认约定。
- 本计划不授权修改生产 Goal/subagent 行为。若完整交付必须包含这类修复，先给出方案并确认范围，不静默豁免失败。
- 不改变 Node、pnpm、TypeScript、Vitest 或 Pi 支持版本；不新增 virtual model、Codemode 用量、新 OpenAI 认证或 builtin MCP 迁移支持。
- 不使用真实凭据、付费模型、用户会话或公共 tmux server。不手工修改 dist，不提交、推送、发布或部署。
