# Pi 0.99.1 infrastructure upgrade todo

## Understanding

将仓库的主要开发、测试和 CI 基线从 Pi `0.87.0` 升级到 `0.99.1`，让验证环境与当前使用的宿主一致。本次只升级基础设施，不顺带适配虚拟模型、Codemode、新 OpenAI 订阅认证或内置 MCP。

## User Visible Changes

- 插件的命令、配置、权限和现有物理模型工作流无预期行为变化。
- 贡献者运行仓库检查时，使用 Pi `0.99.1` 的 SDK 和宿主；评估结果记录实际执行版本，不再把新版运行标成 `0.87.0`。
- 发布包只声明支持 Pi `0.99.1`，三个 Pi peer 依赖精确固定为此版本，不再声明旧版支持。

## Evidence

- 升级前，`package.json` 的三个 Pi 开发依赖和 peerDependencies 均固定为 `0.87.0`；`.github/workflows/ci.yml` 按锁文件安装后运行 `pnpm run check`。当前全局 Pi 为 `0.99.1`，全局版本不能代替仓库依赖版本。
- 此前在隔离副本中，八个发布扩展的新版类型检查、构建和包校验通过。现有测试有五个失败，分别来自两个会话保存时机断言、一个默认工具渲染断言，以及两个冻结评估脚本的版本限制。独立 codex-search 类型检查另有八处测试 context 缺失字段。
- 另有未纳入上述失败数的版本硬编码，例如 goal 的 accounting fixture 和 footer benchmark、Codex accounting 报告。必须区分当前执行约束、结果标签与历史冻结基线，不能全仓替换版本字符串。
- 详细依据见 [compatibility audit](pi-0.99-compatibility-audit.md)。其中新增能力的支持缺口不是本次升级必须修复的旧工作流故障。

## Todo

### 1. Locate

- [x] 盘点 `package.json`、锁文件、CI、`scripts/` 和各扩展 `__tests__/` 的宿主选择、版本检查与结果标签；区分当前验证入口和历史冻结评估，形成需要调整及必须保留的清单。覆盖默认检查与独立的 PTY、tmux、accounting、quality 验收入口。
- [x] 明确发布支持范围。用户选择只声明 `0.99.1`，不保留旧版支持承诺，也不声明版本区间兼容。

### 2. Implement

- [x] 将 `@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui` 的开发依赖固定到 `0.99.1`，更新锁文件。保留现有 Node、pnpm、TypeScript 和 Vitest 工具链。
- [x] 按用户确认的支持策略，将三个 Pi peerDependencies 精确固定为 `0.99.1`，与开发和测试基线一致。
- [x] 调整测试 harness 和 context fixture，使其符合新版 SDK，同时保留 skill 持久化、恢复、工具参数校验和自定义渲染的原始验收目的；按下述用例验收，不删除失败用例或降低断言强度来换取通过。
- [x] 调整当前评估入口的版本传递和报告，让执行计划明确记录预期宿主版本，worker 核验实际版本，报告使用实际版本；保留版本不匹配时的失败保护。历史冻结评估继续使用其固定环境和原始标签，不重写历史结果，也不直接把旧质量分数当作新版基线。
- [ ] 让当前宿主验收入口明确使用仓库依赖的 Pi，并在父进程、worker 和子代理路径记录实际宿主及相关依赖版本，防止混用 PATH 中的全局安装。补齐必要的隔离配置与资源清理，复用已有加载、PTY 和 tmux 驱动，不为每个用例重复安装宿主或启动无界后台进程。
- [x] 将可移植的新版宿主加载检查接入仓库验证，覆盖八个发布扩展的源码和构建入口；独立 codex-search 继续覆盖类型检查与离线测试，但不改发布清单。CI 保留现有三平台矩阵和 frozen-lockfile 安装方式，明确平台专用验收的入口及执行位置。

### 3. Deliver

- [x] 更新当前开发与验证说明，写明主基线、已确认的发布支持范围、独立验收命令及证据边界；历史报告保持原样。记录本清单的完成结果和未通过项，不将未运行的真实终端或远端模型路径标为通过。

## How To Test

### Red first

- 安装新版依赖后先复现已知失败，再逐项调整测试和 harness。核对失败是否仍属于过时预期；若出现真实生产行为回归，保留失败证据并重新界定范围，不能修改期望来掩盖问题。
- 会话生命周期用例经真实 Pi 发送第一条用户消息，在 assistant 回复前检查会话已保存；继续验证 skill 内容进入预期请求、重启恢复后仍正确生效。不能只把“不存在文件”改成“存在文件”就结束。
- 默认渲染用例验证新版参数展示，同时保留异常参数的执行拒绝和正常调用的自定义 renderer。codex-search mock 补齐新版字段后，原有成功、错误与渲染用例仍应通过。
- 评估版本用例分别覆盖预期与实际版本一致、不一致，以及报告中的实际版本；不一致必须失败。另行确认历史冻结入口不会被新版默认值悄悄替换。
- 发布版本用例检查三个 Pi peer 依赖都等于仓库宿主的精确版本，旧版值或版本区间均应失败。先在旧 peer 声明上复现失败，再固定到 `0.99.1` 后验证通过。

### Host integration

- 使用隔离的 HOME、agentDir、配置、临时目录和会话目录，加载八个实际扩展入口。源码与构建入口均无加载错误；本仓库 `/mcp` 替换 builtin MCP 的警告可以存在，但必须确认实际加载的是预期实现。
- Fast 用例通过真实 Pi 请求钩子和物理模型发送路径，验证 OpenAI 名单匹配、Codex priority 注入、明确不支持后的提示及手动重试降级。只在网络发送边界提供固定响应，不用虚拟模型替代原有路径。
- 压缩、goal 和恢复用例由真实 SessionManager 生成并保存历史，经生产上下文钩子、检查点重放和 provider 序列化后观察请求与续跑结果；同时覆盖无效检查点和真实前缀不匹配的拒绝。HTTP 响应可离线替换，不能直接提供已处理好的中间历史。
- MCP 用例使用本地 stdio 测试服务，经实际客户端连接、工具调用、会话持久化、恢复注册及历史渲染验证原配置可用；permissions 仍拦截原有受限调用。子代理用例经真实 tmux 派发、隔离子进程、工具执行和 delivery receipt 验证，而非仅模拟回执。
- 在支持环境运行现有普通与全屏 PTY、恢复和 tmux 验收，记录每个入口的实际版本。Windows 无法运行的本机 tmux/PTY 路径应由支持平台补验，不能把 skip 计为通过。
- 复用现有历史恢复与渲染性能保护，不降低刷新频率、缩短预览或放宽阈值来掩盖升级回归。测试服务与宿主在成功、失败和超时后均须停止，确认监听端口释放。

### Final validation

- 查询实际 Node、pnpm 与三个 Pi 包版本；使用 `pnpm install --frozen-lockfile --ignore-scripts` 从更新后的锁文件重现依赖，再运行 `pnpm run check` 和 `pnpm pack --dry-run`。确认主检查实际使用 `0.99.1`，而不是仅使用新版全局 CLI。
- 独立运行 `pnpm exec tsc -p extensions/codex-search/tsconfig.json --noEmit` 和 `pnpm exec vitest run extensions/codex-search/__tests__`，覆盖默认 typecheck 未包含的扩展。
- Python 驱动使用 `conda run -n codex-py312 python`。验证写入限制在仓库测试目录，不读取用户凭据或改动正在使用的会话；远端认证、付费模型请求和历史评估重跑不在默认验收范围。
- 记录类型检查、测试、构建、包校验、宿主加载及独立集成验收结果。针对本次相关失败保持实现项未完成；全部约定验证通过后再勾选，不要求测试总数与旧基线完全相等。

## Notes

- 用户已批准执行，并确认只声明支持 `0.99.1`。主基线升级和 peer 声明已完成；通用检查曾通过，但审阅新增 Write 执行用例后有两个失败，完整验收仍未完成。
- 不增加旧版兼容 CI 矩阵。历史冻结评估的 `0.87.0` 约束和旧版故障复现记录继续保留，不代表发布支持承诺。
- 不改变插件生产行为，不迁移 MCP，不新增虚拟模型、新订阅认证或 Codemode 用量支持，不扩大 Fast 模型名单，也不调整 `/codex-metadata` 默认值。
- 若新版宿主确实要求修改生产代码，先给出复现、原因和最小调整方案，再确认是否纳入本次任务。
- 不手工编辑 `dist/`；不提交、发布或部署，不修改全局 Pi 安装及用户配置。

## Review follow-up

本轮修复和调查结果见 [review fixes validation](pi-0.99.1-review-fixes-validation.md)。环境允许名单与 macOS 普通 worker 清理回归通过；Linux/Windows 尚未实跑。新增 Write 执行验收使当前主检查为 `2640 passed / 2 failed / 13 skipped`，失败来自宿主将 `null`、数字转换成字符串后写入，待确认执行契约。

Goal follow-up 和 tmux 空锁已定位，生产修复待授权。tmux 源码与 dist 均曾超时，不能用下方历史 dist 通过结果认定问题只在源码。本轮最终矩阵另出现 Fast transcript 顺序断言失败，需独立调查。构建、包、loader、PTY、benchmark、quality 和 terminal 补验通过，不抵消失败项。

## Historical results

以下为审阅修复之前的升级实施结果。

- `pnpm run check` 通过，`2628 passed / 13 skipped`；源码和构建入口的八个扩展均经真实 `0.99.1` loader 加载。frozen install、包 dry run、独立搜索类型检查和 `80` 个离线测试通过。
- `host:pty:check`、`host:benchmark:check` 通过；原生 accounting 根场景 `74` 个、子进程场景 `16` 个，以及另行运行的 terminal 场景 `56` 个通过。Python quality `24` 个测试通过。
- 构建实现的真实 tmux `12` 个用例通过。源码初次通过，但重复运行有关闭超时，完整验收保持未完成。
- `host:accounting:check` 的 Goal follow-up 保留用例失败，在真实 `0.87.0` SDK 复跑也失败。保留原断言，未修改生产调度逻辑。
- 三个 Pi peer 依赖已精确固定 `0.99.1`，README 和验证记录已同步。版本声明用例先失败后通过；重新运行 frozen install、`pnpm run check` 和包 dry run 均通过。独立集成中的两个失败未改动或撤销。详细证据和未运行项见 [infrastructure validation](pi-0.99.1-infrastructure-validation.md)。
