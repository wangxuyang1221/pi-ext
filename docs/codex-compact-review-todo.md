# Codex Compact Review Fixes

## Understanding

修复针对提交 `2b06fd6b71e7ae0dd168d3ef5e7101ebb7e58376` 审查中已核实的第 1–6 项问题。先消除默认测试和发布策略对历史实验材料的依赖，再修复运行时问题；第 7 项评估脚本遗漏 WASM 不在本轮范围。

核验基线为 Pi `0.84.3`。下面保留原审查编号；checkbox 表示工程动作的完成状态，实际验证与无关阻塞见 Results。

## User Visible Changes

- 压缩期间切换模型时，旧请求被取消，不再发送缺少 checkpoint 的历史尾部，也不提交旧目标模型的 checkpoint；切换后的请求仍可正常准备。
- 已有 checkpoint 的会话遇到纯文本模型下的图片历史、带 namespace 的工具调用或 grammar 工具时，可以继续回放，不再被误判为历史发生变化。
- 关闭 thinking 后，压缩请求不再发送 `reasoning.effort: "off"`；转换压缩使用旧模型时，按该模型支持的等级构造参数。
- 同一用户轮次的工具续答和重试保留 `x-codex-turn-state`，新用户轮次不继承上一轮状态。
- 默认测试不再依赖未提交的历史实验材料，发布清单不再要求发布被校验规则禁止的 fixture 路径。

## Todo

### 1. Locate

- [x] 确定 Pi `0.84.3` 中请求 signal、模型切换和用户轮次的实际边界，明确工具循环、重试、steering、queued follow-up、会话导航各自如何影响操作取消及 turn-state 生命周期。
- [x] 确定 Responses 转换和 thinking 归一化的复用方式，核验 Pi extension loader 能否加载候选接口；不能复用时，限定本地兼容层的职责。检查历史重复转换及失效操作重复请求的成本，确定本轮实现约束。

### 2. Implement

- [x] **问题 4、5：恢复可复现的测试与一致的发布策略。** 为 `quality-report.test.ts` 提供可提交、不含敏感数据的小型 fixture，保留失败尝试、部分 usage、报告重建和无效输入断言；历史报告重建移到显式入口，并明确缺少材料时的行为。同步 `package.json`、`scripts/check-package.mjs` 及相关引用，移除本轮涉及的未提交材料发布要求，继续禁止发布测试 fixture 和日志，不伪造历史实验结果。
- [x] **问题 1：取消旧请求并阻止过期提交。** 在 `index.ts` 和 `session-coordinator.ts` 中统一处理请求准备期间的模型切换和操作失效；取消关联的普通 provider 请求及远端压缩，在提交 checkpoint 或 bypass 前校验会话、模型和操作代次。失效操作不得再次发起压缩，也不得清除新操作的状态；仍未取消且缺少 checkpoint 的请求不能靠返回 `undefined` 放行。
- [x] **问题 2：对齐历史转换语义。** 集中处理模型图片能力、工具 namespace、grammar 调用及结果配对、调用 ID 和孤立调用补全，使插件重建结果与 Pi 实际请求一致。保留 fail-closed 检查及完整历史回放保证，不通过忽略字段或吞掉比较异常规避问题；同一准备操作内复用相同历史、模型和工具条件下的转换结果，避免新增重复扫描。
- [x] **问题 3：归一化压缩请求的 thinking 参数。** `off` 不生成 reasoning；没有可复用 provider payload 时，也按目标压缩模型的 reasoning 能力、支持等级和映射规则构包。旧模型转换路径不得沿用新模型专属设置，并保留合法的已转换 payload 参数。
- [x] **问题 6：按用户轮次管理 turn-state。** 将状态重置从每次 Pi `turn_start` / `turn_end` 移到经核实的用户轮次边界；同轮工具循环、重试及压缩保留首个状态，新轮次重置。覆盖 steering 和 queued follow-up，忽略旧操作迟到的状态响应，并在会话导航、关闭时释放状态，避免累计保存历史轮次。

## How To Test

### Workflow

- 每个实现项按 Red → Green → Refactor 推进：先提交到本地工作树的失败测试并确认失败原因，再修实现，最后运行相关回归。常规测试属于对应实现项的完成条件，不因已有临时复现而省略。
- 测试使用合成历史、假凭据和 mock 远端响应，不调用真实账号后端。转换差分使用安装版本的真实 Pi converter，不能让比较两侧都使用插件转换器。
- 执行前重新确认依赖版本、工作区改动和现有失败。已有 `.tmp/codex-review-verify/` 仅供参考，不作为默认测试依赖。

### Target Behavior

| 问题 | 失败测试与通过条件 |
| --- | --- |
| 4、5 | 在不提供本地历史实验材料的条件下运行默认质量测试，报告计算和输入校验仍完整通过；用实际发布清单调用发布路径校验，允许的文件存在且通过，测试 fixture 和日志仍被拒绝。显式历史重建入口不得把材料缺失报告成成功。 |
| 1 | 对已有 V2 checkpoint 的模型转换和自动压缩分别延迟远端响应，期间切换模型，随后释放成功或失败响应。断言旧 provider signal 已取消、不提交过期 checkpoint / bypass、不发送缺少 checkpoint 的 payload，新模型请求可继续。补充连续切换及迟到清理不得影响新操作的竞态用例。 |
| 2 | 用真实 Pi converter 输出作为 coordinator 输入，覆盖纯文本模型的用户图片和工具图片、同模型 namespace、grammar 调用及结果、跨模型 ID 处理和孤立调用。断言正常回放保留 checkpoint 与当前输入且无重复；真正修改历史前缀仍触发 fail-closed。 |
| 3 | 对实际模型配置捕获请求体，对照 Pi 正常构包；覆盖 `off`、支持等级映射、非 reasoning 模型、无缓存及有缓存 payload、使用旧模型的转换压缩。断言不发送 `off`，不泄漏新模型专属设置，合法参数不被错误覆盖。 |
| 6 | 首响应返回 `ts-1`，工具续答、同轮重试和压缩请求继续携带该值；同轮后续响应不能替换首个状态。新用户轮次不带旧值。分别覆盖 steering、queued follow-up、导航、关闭和旧响应迟到，按 Locate 阶段核实的边界断言。 |

### Cost And Resource Checks

- 问题 1 使用可控延迟及请求计数断言：操作失效后不得再发起重试或补偿压缩。正常路径保留既有必要请求，不为取消检查增加远端探测。
- 问题 2 用不同长度的合成历史验证转换调用次数：同一准备操作内，相同分支、模型和转换选项的结果不重复计算；不同模型或历史变化不得错误复用。合理实现仅需按必要转换视图线性遍历，不接受随消息数增加的重复全历史转换。
- 问题 6 连续完成多个用户轮次并执行导航、关闭，断言只保留当前活动状态，迟到响应不能重新填入已释放的旧轮次状态。

### Final Verification

- 先运行相关测试及插件类型检查，再执行 `pnpm run check`，检查类型、默认测试、构建及发布校验。
- 如果无关测试失败使完整命令短路，记录失败原因，并在不覆盖用户改动的前提下单独执行尚未覆盖的构建和发布校验；不得把部分通过表述为全仓通过。
- 本轮相关失败全部消除后，才能勾选对应实现项。记录实际命令、结果及未覆盖场景；不以 mock 构包结果宣称已验证远端接受请求。

## Results

### Implementation Decisions

- Node `22.22.2`、pnpm `11.9.0`、安装的 Pi `0.84.3`。真实 Pi loader 分别加载源码和构建产物，均得到 1 个 extension、0 个 error。
- 采用公开 `clampThinkingLevel`；内部 Responses converter 不属于 extension loader 暴露的接口，保留局部兼容层。差分测试通过真实 Pi `streamSimple` 的 `onPayload` 获取请求并在网络发送前中止，覆盖图片、namespace、grammar、跨模型调用与结果 ID、孤立调用、deferred tools、文本签名及 Unicode。未关闭严格前缀校验。
- 同步准备阶段复用相同模型下的历史转换结果，10/100 条历史均只调用一次对应 raw 转换；跨 await 不缓存分支视图。模型切换后的旧操作不再重试或提交，连续切换测试验证旧操作不取消新请求。
- turn-state 的 Pi 适配边界是实际投递的 user message；steering 和 queued follow-up 在投递时重置，排队不重置。工具迭代及无新消息的重试保留首个状态。这里不把 Pi 的每次 turn 当作用户轮次，也不宣称 steering 与 Codex 内部 TurnContext 完全等价。测试包含 20 轮状态隔离及迟到压缩响应。
- 历史证据不进入默认测试或发布包；合成 fixture 不声称是真实实验。显式 `codex-compact:quality:report` 入口测试覆盖缺材料失败、生成/复核报告和拒绝覆盖不同结果。发布路径规则继续禁止 fixture 和日志。
- 两个 goal/coordinator 集成测试的 mock 原先传入 Codex 模型，却在 `ctx.model` 留下默认的其他模型；同步修正 mock，保留原集成断言和新增模型一致性检查。

### Verification

| 命令或检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run extensions/codex-compact/__tests__` | 36 个文件、888 项全部通过。 |
| `pnpm run codex-compact:quality:check` | Python 24 项通过。 |
| `pnpm run check` | 类型检查通过；1893 项通过、5 项跳过。仅 MCP prototype 测试套件因模块缺失无法加载，因此完整命令未通过。 |
| `pnpm run build` | 通过，包含 WASM 复制与校验；未手工修改 dist。 |
| `pnpm run package:check` | 被无关缺失文档阻塞，首个为 `docs/goal-descendant-acceptance.md`。未移除这些其他功能的发布要求。 |
| `pnpm pack --pack-destination .tmp/codex-compact-fixes` | 成功；452 条实际归档路径全部通过安全规则，包含 Codex JS、WASM 和新的质量验证文档，没有 fixture/log 路径。此结果不替代完整 package check。 |
| Pi loader 加载源码及 dist | 均成功，0 个 error。 |
| `git diff --check`（本轮文件） | 通过。 |

MCP 缺失模块为 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`，与修复前一致。发布清单仍有 13 个缺失的 goal/subagent/tool-status 文档，保留用户删除和既有缺失状态，不扩展本轮范围。测试未残留本轮 worker 或服务进程；本轮没有启动持久监听服务。

日志保存在本地 `.tmp/codex-compact-fixes/final-{plugin,check,build,package,pack}.log` 和 `python-check.log`，不纳入发布证据。运行时验证使用 mock 远端响应，未验证真实账号后端接受请求，未运行第 7 项在线评估脚本。

## Notes

- 第 7 项在线评估脚本资源复制暂缓。本轮不运行这些在线评估，也不将其视为质量已验证的依据。
- 上轮 `pnpm run check` 的基线：类型检查通过，1849 项测试通过、6 项失败、5 项跳过；6 项失败来自问题 4，另一个 MCP 测试套件因缺少 prototype 模块而无法加载。执行时需重新核实，MCP 问题不擅自纳入修复。
- 保留工作区已有未提交改动。修改插件 `src/` 和对应 `__tests__/`，`dist/` 只由构建生成，不手工编辑，不顺带恢复用户已删除的无关文档。
- 不关闭 fail-closed，不改变自动压缩阈值、token 估算策略或远端超窗处理，不扩大为通用转换器重构。
- 本清单不授权修改工作目录外文件或执行真实账号远端请求。若需新增或修改用户可见提示文案，先确认文案语言。
