# Codex UI Residual Fixes

本文保留 Pi `0.84.3` 的第二轮记录。原问题 4 后续已在 Pi `0.86.0` 上通过逻辑记录与视图分离修复；当前边界及验证见 [Read history grouping fixes](codex-ui-read-history-todo.md)，下文“仍保留限制”指本轮当时的范围。

## Understanding

处理 `fix/codex-ui-review` 分支提交 `6fe4b308d3f333c6c741ed571279fbff08260653` 的三项已复现残余，顺序为原问题 1 → 2 → 7。原问题 1 采用用户接受的“配置异常时工具报错、不执行”方案，不实现宿主保留旧配置继续执行的行为。

三项均已实施，验证结果见下文。依赖基线为 Pi `0.84.3`，运行环境为 Node.js `22.22.2`、pnpm `11.9.0`。不修改宿主、不增加宿主内部兼容层、不升级依赖；原问题 4 仍为已接受的 Read 历史重建显示限制。

## User Visible Changes

- 默认文件配置路径下，全局或受信任项目 settings 读取、解析失败时，Bash 和 Read 调用返回明确错误，不启动 shell 或执行文件读取工具，不静默回退配置。Pi 和会话继续运行，聊天、Edit、Write 不因本插件的配置检查被阻止。文件不存在仍采用其余有效配置或默认值；未受信任项目配置不读取。修复文件并 `/reload` 后恢复，显式注入配置和自定义 factory 路径保持原有契约。
- diff 隐藏终端控制序列，但不再误删序列之后的普通源码。CRLF 展示修复保持有效，磁盘内容和持久化 patch 不变。
- 重复 Bash ID 即使跨越 low-power/full 模式或先前未绑定，也不能把旧命令和结果搬入新消息；显示顺序和额外组件独立展示保持不变。

## Todo

### 1. Locate

- [x] 确定公开 SettingsManager 错误信息到工具错误的转换位置，以及成功、失败快照的生命周期；核对 Bash 组件首次出现、模式锁定、绑定与历史重建之间的归属关系，选择不会跨消息接管的判定方式。明确控制序列解析范围和不完整序列的处理规则，不扩大为终端模拟器。

### 2. Implement

- [x] 调整 `execution-settings.ts` 与 `tools.ts`，将应读取范围的配置失败缓存为错误快照，在调用默认 Bash/Read 执行器之前报错。区分缺失文件与读取、解析失败，不回退默认或旧配置，不输出配置正文或命令前缀。保留项目优先级、信任边界、显式注入、自定义 factory 和权限钩子；失败快照同样不逐次读文件，修复后须 `/reload` 更新。
- [x] 替换 `tools.ts` 中 diff 使用的净化逻辑，按完整 CSI 结束边界处理光标序列，并保留对 OSC 等终端控制序列及回车的防护。先净化原始显示文本，再高亮、计算宽度和补齐背景；不动文件或 patch 原文，不清除渲染器生成的颜色。复用既有解析缓存，单次处理随输入长度线性增长。
- [x] 修正 `bash-groups.ts` 及必要的工具渲染接入，使绑定阶段也能拒绝跨消息或跨重复位置接管。此前 low-power 或未绑定的 ID 不能被新的同 ID full 行挂回旧 candidate；旧组和旧行保持原位。保留正常流式追加、缺失组件屏障、单次调用模式锁定和真正重复组件独立显示，不在每次绑定时扫描全部历史，不新增脱离会话生命周期的成员缓存。

### 3. Deliver

- [x] 更新 README 与上轮记录，纠正“损坏配置与宿主一样被忽略”的表述，说明异常工具拒绝、恢复步骤及适用范围；记录三项回归和成本验证的实际结果。保留上轮已接受限制，不将本轮写成完整 SDK 配置兼容。

## How To Test

### Workflow

三项依次按 Red → Green → Refactor 推进：先在 `extensions/codex-ui/__tests__/` 加入对应失败用例，确认命中目标问题，再修改实现。新测试不得依赖 `.tmp` 中的复现脚本或缺失的 prototype。正式测试优先使用真实工具、SDK reload 和工具组件，远端模型用离线夹具，不访问在线服务。

### Behavior Checks

| 问题 | 验证与通过条件 |
| --- | --- |
| 配置异常 | 对全局、受信任项目分别执行“有效配置成功 → 文件损坏 → 真实 `session.reload()` → Bash/Read 工具失败 → 修复 → reload → 恢复”。用 shell 副作用标记和 Read 执行计数证明不是执行后才报错；错误中不含配置正文或前缀值。 |
| 配置边界 | 覆盖首次加载即损坏、读取拒绝、文件缺失、默认值、项目优先级、不信任项目中存在损坏配置、cwd/信任变化和 TUI/print/RPC 执行上下文；正常命令前缀、shell wrapper 和图片缩放仍正确。配置失败时 Edit/Write 可用，会话不退出；显式注入、自定义 factory 和权限拒绝回归通过。读取权限错误可用可控 I/O 夹具，不依赖测试进程权限。 |
| 宿主差异 | 保留宿主在损坏配置 reload 后继续使用旧值的对照，明确插件现在应拒绝而不是与其输出相同。改正 `execution-settings.test.ts` 中将损坏后退回默认值断言为正确的测试；修改文件但不 reload 时仍遵守原快照。 |
| diff 源码完整性 | 真实 Write 和工具组件覆盖 `.txt`/`.ts`，`left\x1b[1Cright marker` 中 `\x1b` 表示实际 ESC 字符，净化后应为 `leftright marker`；代码字符串 `before\x1b[1Cmiddle` 应保留 `beforemiddle`。补充 CSI 的 A/B/C/D 等终结字符，普通源码不得消失。 |
| diff 安全与边界 | 覆盖 CRLF/LF/混合换行、空行、长行、展开/折叠，以及 SGR、OSC、清屏和光标移动序列；明确不完整序列的断言，不让残余控制码操纵终端。磁盘及 patch 保持原始字节，高亮颜色保留。解析层内容断言与组件输出检查分别进行，不用同一个有缺陷的剥离函数验证自身。 |
| Bash 归属 | 第一条消息为 low-power `a`、full `b`，第二条为 full `a/c`。真实组件输出始终为旧 `a → b → 新 a → c`；旧 `b` 的命令、结果与行位置均不变，新 `a` 不包含旧 `b`。另外覆盖先前组件未绑定、段内重复、跨消息重复、流式追加和 text/thinking/其他工具屏障。 |
| Bash 回归 | 正常唯一 ID 分组、乱序完成、缺失或 low-power 组件屏障、折叠/展开、会话清理及既有 reload 行为保持不变。不能用禁止全部分组或改变单次调用模式锁定来绕过问题。 |

### Cost And Resource Checks

- 配置按 cwd/信任状态建立快照。统计成功与失败路径的文件读取、配置解析和执行器构建次数：同一快照连续调用及重绘不重复读取或解析；失败路径不调用底层执行器。reload 后重新读取，恢复或切换上下文不沿用错误范围的快照。不新增监听、轮询或定时重试。
- diff 清理复用现有准备阶段缓存。内容和显示条件不变时重绘不重复全量清理，高亮与布局缓存回归通过。用不同长度及密集、不完整控制序列验证边界；实现不得对每个字符反复搜索剩余全文，避免二次扫描成本。
- Bash 延续 Map/Set 索引。用 100/1000 个调用及多条消息覆盖混合模式和重复 ID，约束绑定不逐次扫描历史、发现阶段单次扫描线性增长。记录归属所需的会话级状态随历史增长是允许的，但重复重绘不得累积新记录，session reset/shutdown 应释放失效归属。
- 测试的配置、会话、标记文件均在仓库内隔离目录，结束后清理。不改真实用户配置；若启动后台进程，结束前停止并确认端口释放。

### Final Verification

- `pnpm exec vitest run extensions/codex-ui/__tests__`。
- `pnpm exec tsc -p extensions/codex-ui/tsconfig.json --noEmit`。
- `pnpm run check`；如因无关测试提前失败，单独执行 `pnpm run build` 与 `pnpm run package:check`，分别记录结果，不宣称全仓通过。
- 对改动及新增文件做空白检查，不手工修改 `dist/`。对应行为、回归和成本验收通过后再勾选实现项。

### Verification Results

| 检查 | 结果 |
| --- | --- |
| codex-ui 回归 | `pnpm exec vitest run extensions/codex-ui/__tests__`，27 个文件、219 项通过，比复审基线新增 8 项测试。 |
| 类型检查 | codex-ui 单独 `tsc --noEmit` 通过；`pnpm run check` 中的全仓类型检查通过。 |
| 全仓检查 | `pnpm run check`，135 个文件通过、1 个 suite 失败、3 个文件跳过；1925 项通过、5 项跳过。失败仍为 MCP 测试缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`，不计为全仓通过。 |
| 构建 | `pnpm run build` 通过，包含七个扩展及静态资源校验；仅通过构建生成 `dist/`。 |
| 发布校验 | `pnpm run package:check` 仍因缺少 `docs/goal-descendant-acceptance.md` 失败，未补造文件或削弱校验。 |
| 真实扩展加载 | `discoverAndLoadExtensions` 分别加载 codex-ui 源码与 manifest 中七个构建入口，无加载错误，顺序正确。 |
| 清理 | 改动及新增文件空白检查通过；没有后台服务，测试子进程退出，没有任务监听端口。 |

- 配置路径的 Red 为真实 reload 后工具仍执行，没有产生预期拒绝。Green 通过公开 `SettingsManager.drainErrors()` 获取失败范围，缓存不含原始诊断的 Error；同一快照中的 Bash/Read 都在执行器创建和调用之前失败。SDK 测试验证 shell 标记未生成、Read/Bash 执行计数为零、模型收到错误结果后会话仍可继续、Edit/Write 可用，以及修复后 reload 恢复。保留原生宿主继续使用旧配置的对照，不将新方案宣称为宿主行为一致。
- 配置边界覆盖全局/项目、首次损坏、受控 EACCES、文件缺失、不受信任项目、TUI/print/RPC 执行上下文和显式注入。成功及错误快照连续调用均不反复读文件，失败路径不构建配置执行器。TUI/print/RPC 不是三个独立 CLI 进程的端到端验收。
- diff 路径先复现光标 CSI 后源码被吞，再修复完整 CSI final byte 边界；随后为 C1 序列补充 Red → Green。真实 Write/组件覆盖 `.txt`/`.ts`，独立内容断言不使用宿主有缺陷的净化函数。新增 `src/diff-source.ts` 仅净化显示源码；不完整 CSI 丢弃已读控制前缀，遇到非法后续字符后恢复普通处理；未闭合的字符串控制序列隐藏本行剩余 payload，不吞下一源码行。完整 CSI 终结范围、C1、字符串控制序列和原有 CRLF 回归均通过。
- diff 成本测试在 100/1000 规模的密集或不完整输入上约束字符扫描次数，未变化 patch 在不同宽度、重绘与展开时不重复净化；渲染器颜色仍在。没有使用 xterm 或实测全部终端平台，断言覆盖解析结果和真实组件输出。
- Bash 路径的 Red 为旧 `b` 组件输出变空。Green 使用会话内歧义 ID 集合：发现重复后，新的绑定不能占用该 ID 的历史槽位，已有 owner 不被移除。未绑定的首个出现位置也可能独立展示，以避免在无法区分出现位置时误认 owner。真实组件覆盖 low-power/未绑定、跨消息与同消息 text/thinking/其他工具屏障、展开及流式追加；100/1000 个历史 candidate 的绑定成本和 reset 后重新分组测试通过。

本地验证日志位于 `.tmp/review-verification/r2-*.log`，不作为正式测试依赖；未调用在线模型或修改宿主、依赖。

## Notes

- 上轮基线为 27 个 codex-ui 测试文件、211 项通过，但未覆盖本轮三种组合条件。独立复现已确认三项残余；复现文件 `.tmp/review-verification/re-review.mjs` 和 `re-review.log` 仅作本地证据。
- 已知全仓测试缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`，发布校验缺少 `docs/goal-descendant-acceptance.md`。实施时重新确认，不补造无关文件或削弱校验。
- 用户已确认新增工具错误提示使用英文。提示只包含失败的配置范围及修复、reload 指引，不包含配置正文、命令前缀或底层读取错误详情。
- 保留正常配置的首次执行快照，不承诺实时发现文件损坏；不自动继承 SDK 内存配置，不引入跨 reload 的全局或磁盘配置备份。
- 本轮只处理上述残余，Read 历史重建分组仍为已知限制。提交和推送须另获用户指示。
