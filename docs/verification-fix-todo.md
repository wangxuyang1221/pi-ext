# Product regression fix todo

## Understanding

修复验证中发现的五项产品回归，交付扩展代码、Pi 1.4.0 可复现依赖补丁及对应验收证据。详细行为与反例以 [修复方案](verification-fix-plan.md) 为准；本清单记录执行顺序和完成条件；实现与专项验收已完成，详细证据见 [验收记录](verification-fix-results.md)。

## User Visible Changes

- MCP 调用持续收到合法进度时可延长软超时，仍受硬截止约束；用户取消后立即结束。
- Goal 遇到明确的账户额度耗尽错误时进入 `usage_limited`，包括恢复后及在途已达到预算的情况；其他错误保持原有处理。
- Search 的 URL 引用只在所属会话中可用。新会话、fork、clone 和只有旧版无归属映射的会话须重新 open；同一会话冷恢复仍可使用新格式引用。
- Goal 流式运行时按 Esc，首次结束结算即为 `paused`，显式 resume 后才继续；重试等待时按 Esc 仍为 `blocked`。
- Skill Mentions 的未命名历史会话在恢复列表中显示原 task，并可按该摘要检索；显式会话名称优先，恢复后的卡片与模型快照保持完整。

## Todo

按以下顺序独立推进。实现项仅在对应 How To Test 的目标行为、反例和成本约束通过后勾选；缺少必要证据时保持未完成。

### 1. Fix known causes

- [x] 修复 MCP `client.ts` 的 progress 注册：启用延期时同时传入 `onprogress`，复用 SDK 的计时机制，保留硬截止、取消及默认不重放行为，不新增每次 progress 的定时器或 I/O。
- [x] 修复 Goal `quota.ts` 的包装解析：以有界处理剥离已核验的 Codex、compaction、summary 包装，精确识别额度错误，保留原始诊断内容和累计统计。
- [x] 修复 Search 引用存储与工具入口：一次捕获 `(sessionDir, sessionId)`，贯穿请求和持久化；按该身份隔离文件及队列，校验格式和归属，清空旧内存映射，并采用同目录临时文件原子替换。保留无归属旧文件且不采纳其引用，保持直接 refId 输入契约；只读取目标会话文件，队列完成后释放条目。

### 2. Resolve remaining causes

- [x] 定位 Goal 流式 Esc 漏暂停的确切事件顺序与运行归属，明确取消应在哪个生产事件提交状态，以及如何区别用户取消、内部取消和过期事件；结论须解释原旅程首次 settled 仍为 active 的原因。
- [x] 修复 Goal scheduler 的取消收尾：绑定有效 ticket 和 signal，在清除运行绑定前幂等提交暂停；保留 owner、goal、generation、runGeneration 校验和终态优先级，一次取消只产生一次有效状态转换，不添加轮询。
- [x] 查明 Pi 1.4.0 启动 `--resume` 与进程内 `/resume` 的扩展注册、列表枚举、显示和检索调用链，确定通用摘要接口的落点与生命周期。结合源码和最小原型，确定单次列表构建与输入检索时的投影次数上界，避免重复解析全部 snapshot。
- [x] 核验当前 pnpm 的 patch 命令、仓库内编辑目录和锁文件规则，明确补丁在开发、CI、发布包消费时实际应用到哪个宿主；产出可复现步骤及未自动覆盖的安装方式，不能把仓库冻结安装成功当作外部宿主已打补丁。
- [x] 实现 Pi 摘要接口、Skill Mentions 严格解码接入及固定版本补丁：首次枚举即生效，显示与检索共用投影，遵守已确定的计算次数上界；损坏或未知 envelope 保留原文，读取不执行 skill、不联网、不重写历史。保存 patch、依赖映射和锁文件，明确补丁适用版本及移除方法。

### 3. Deliver

- [x] 同步受影响 verification skill 的稳定驱动入口、覆盖说明和补丁使用文档，使后续执行者能复跑本次验收；移除临时诊断代码，保留失败与成功证据，缺证据分支仍标为 unverified。
- [x] 清理本任务启动的进程、socket、锁和临时 patch 编辑目录，确认监听端口释放；保留必要验收证据与用户原有未提交文件。

## How To Test

### Preparation and cadence

实施每个扩展前读取其 `.cursor/skills/verify-pi-*/SKILL.md`、相关 feature 和原报告；运行验收前读取 [共享验证说明](../.cursor/skills/verify-pi-ext/README.md)。旧失败证据位于 `.tmp/parallel-verification-TXdlMV/`，具体位置见交接文档 `handoff/handoff-20261027-233407.md`，无需重跑原九任务。

预期明确且反馈快的例子先写失败测试，确认失败来自目标行为，再修实现。Goal Esc 和宿主注册时序先取得真实事件或最小原型证据，再建立回归断言。复用驱动前核对输入及断言，保留原失败状态检查，不能以最终成功替代中间状态正确。

测试 HOME、agentDir、缓存、会话种子和 patch 编辑目录放在仓库内；记录启动的 PID、端口和 socket。确认 Node 与 packageManager 对应 pnpm 的实际版本，Python 使用 `conda run -n codex-py312 python`。

### MCP

- 从原 `mcp/.tmp/test-results/drivers/protocol.mjs` 提炼真实 SSE transport 回归。请求经过生产 manager 和已安装 SDK 到本地服务，确认 progressToken 实际发送，服务每 50ms 发送合法 progress，软截止 150ms、硬截止 1000ms、600ms 完成的调用成功。
- 分别验证持续 progress 到硬截止、无 progress、未知 token、停止发送 progress、用户取消。观察超时或取消后的服务端取消通知，确认调用次数为 1、连接及定时资源释放；参数 mock 不能替代协议验收。

### Goal quota

- 快速用例覆盖两个精确代码、Codex 前缀、compaction/summary 包装及 JSON envelope。裸 429、rate_limit、鉴权、网络、含糊 billing 和普通句子提及 quota 均不得识别为账户耗尽；深层输入确认标准化有界。
- 用合成 SSE 替代远程服务响应，保留已安装 native adapter 的真实解析和 Goal SDK 状态处理。验证 active、在途 budget_limited 及接受恢复确认后的旅程最终进入 usage_limited，目标和累计统计保留，显式 resume 才继续；普通错误仍为 active→blocked，且不覆盖 budget_limited。

### Search

- 通过真实扩展工具入口与本地请求记录验证：A open 获得引用，B 未 open 时对同 URL 执行 find/click/screenshot 在本地拒绝，新增请求数为 0；B open 后只使用 B 引用，切回或冷恢复 A 仍使用 A 引用。fork、clone 也须重新 open。
- 覆盖同会话并行 open 不丢映射、不同会话并发保存、A 请求在切到 B 后才返回、旧文件忽略且保留、损坏文件报错和身份不匹配；直接 refId 输入沿用既有契约。
- 在其他会话文件数量分别为 1、100 时记录文件访问，确认本次工具只访问目标会话文件，不扫描其他会话；并发保存结束或失败后队列条目释放，临时写入失败不破坏原文件。成本依据是独立文件可直接定位，额外会话无需参与本次读写。

### Goal escape

- 在原 `acceptance-tui.mjs` / `acceptance-tui-driver.py` 的 `GOAL_TUI_SCENARIO=stream-interrupt` 中记录 message_start、message_end、agent_end、agent_settled，以及 ticket、signal 和快照身份，查明漏判路径。
- 保留原 PTY 断言连续复跑至少三次：真实按 Esc 后首次 settled 即 paused，目标与累计值保留，无自动新请求；显式 resume 后才继续。通过 SDK 事件测试补验工具中断、重试等待、对话框取消、编辑或替换目标、会话切换、混合用户队列及预算与取消同时发生。
- 重放 agent_end/settled、过期和内部取消事件，确认有效暂停至多一次、旧事件不改变新目标，budget_limited、complete、usage_limited 优先级保持。PTY 与 SDK 证据分别覆盖真实按键路径和事件边界。

### Skill mentions and host patch

- 原型分别从冷启动 `--resume` 和进程内 `/new` → `/resume` 进入首次选择器，记录摘要注册与枚举顺序。输入由扩展正常发送 skill mention 生成 snapshot，经宿主持久化、枚举、摘要接口到列表和检索；手写 envelope 仅用于损坏及边界输入测试。
- 真实 PTY 连续打开两次列表均显示原 task；删除 skill 文件后仍能显示，选择恢复后卡片和模型快照保持。覆盖显式名称、长/中文/多行 task、同文会话、损坏或未知 envelope、native/Codex 普通及 fullscreen、扩展关闭；named/unnamed 筛选语义保持。
- 对 10 和 100 个会话采集摘要解码次数及文件/网络访问。按调查确认的上界建立可失败的次数断言，检出每次搜索按键重新解码全部 snapshot 的实现；摘要投影不额外读取 skill、不新增网络请求、不写历史。未确定成本上界前该实现项不勾选。
- 在仓库内干净安装目录运行 `pnpm install --frozen-lockfile --ignore-scripts`，确认无需手改 node_modules 即应用补丁，锁文件不变，实际加载的宿主包含接口。验证 source/dist 和发布包在补丁宿主下的加载，以及未补丁宿主的明确兼容行为；分别记录仓库安装与外部消费的覆盖边界。

### Final checks

每项完成后在本节记录命令、结果及证据路径；必要分支缺证据时整体不标为通过。全部修复后运行 `pnpm run check`，要求类型检查、测试、构建、发布包和宿主加载检查全部通过，并完成进程、端口和 socket 清理核验。最终交付逐项说明修复结果、补丁适用范围及仍未覆盖事项。

当前状态：五项修复、专项验收、完整检查与最终清理均完成。`pnpm run check` 通过，193 个测试文件、2869 项测试通过；26 个已记录进程全部退出。具体命令、结果和证据路径见 [验收记录](verification-fix-results.md)。

## Notes

- Pi 固定版本补丁路线已经接受。具体 API 及补丁落点由调查决定；若必须改变已约定的产品语义，再说明具体决策。
- 本次默认主代理独立完成，未要求创建 PR、发布或联系上游。工作目录外副作用仍遵循当前 AGENTS 的授权规则。
- 保留现有 `docs/testing.md`、MCP resume helper、`.cursor/` 和修复方案的未提交改动。dist 只由构建生成。
- 本地 SSE、SDK 和 PTY 验收不证明真实远程服务质量、账号额度、计费或物理终端字体、IME、复制行为。
