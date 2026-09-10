# Goal provider feasibility

## Decision supported

[Planning #14](https://github.com/wangxuyang1221/adventure/issues/14) 的查证结论：在复用 Pi 已接入模型的前提下，goal 可以通过修改本仓库 extension 适配其他 provider，不需要为此修改 Pi 核心。这个结论是公开契约与当前源码支持的架构可行性，不是跨 provider 功能已经实现或所有远端模型已验收。

候选支持边界是：Pi 已接入的 provider，包括内置 provider、`models.json` 私有化模型和其他扩展注册的 provider；模型及适配器须能处理普通 function tools、返回合规终止事件。模型不会调用工具、不遵循契约或服务协议尚未适配 Pi，不在“保证能够完成 goal”的承诺内。usage 是否完整影响预算可信度，不宜据此拒绝整个 provider 名称。

此边界尚待用户确认。用户已经确认的只有接入职责，见 [Spec Scope](https://github.com/wangxuyang1221/adventure/issues/12#scope)。

## Baseline and verification method

- 产品代码起点：`870cf4961436e8252a61c00d29a300a5a4b53760`。本轮未修改产品源码。
- `package.json` 开发依赖及本地实际安装版均为 Pi 0.84.3；当前宿主发布包为 Pi 0.85.1。
- 在线查询官方 tag，0.84.3 指向 `4e58f324fae8ebfa98a3d45181fb248072a2afac`，0.85.1 指向 `d981de1229ef899957bbe968bc8dcda02a21f477`。
- Context7 选择 `/earendil-works/pi`，它覆盖 main，未提供本次固定版本。查询用于定位自定义模型和 provider 入口，具体版本结论采用固定 commit 文档和源码。
- 完整读取安装版 0.84.3 的 `extensions.md`、`models.md`、`custom-provider.md`，在线取回两版对应固定 commit 文档，与各自安装包逐字节比较，六项一致。检查版本差异，并在线核对两版 `Usage`、`AssistantMessage`、`Model` 和 `StopReason` 定义。
- 阅读当前 goal 的 capability、scheduler、accounting、tools，以及 index 中的工具启用与执行入口。不是仅根据历史调研推断。
- 没有调用任何真实模型或使用用户模型凭据。基线测试不是兼容性实验。

## Model onboarding

Pi 官方 `models.json` 文档明确支持 Ollama、vLLM、LM Studio 与代理，提供 `baseUrl`、`api`、`apiKey`、headers 和兼容参数。配置入口为 `~/.pi/agent/models.json`，不是 goal 自己的配置文件。密钥可引用环境变量；这里不创建用户配置或保存真实凭据。[P1]

对非标准协议，Pi 允许另一个扩展通过 `registerProvider` 注册完整 Provider 或自定义 `streamSimple`。因此“用户自行接入”不限于某个 provider 名称，但并不意味着填入任意 URL 就能调用任意服务。服务必须兼容已选 API，或已有能履行 Pi 契约的适配器。[P2]

本次 goal 不承担编写任意私有协议适配器、认证流或模型目录服务。该范围是待确认候选，不是技术上禁止用户另写 provider 扩展。

## Extension contracts

`registerTool`、`sendMessage`、`context`、`message_end`、`agent_end`、`agent_settled`、`model_select` 和 `getActiveTools` 都是 Pi 公开扩展接口，不以 openai-codex 为条件。goal 当前正使用这些入口。`agent_settled` 在重试、压缩恢复与排队续跑完成后发出，适合做最终状态收敛。[P3][L2]

goal 的三个工具采用普通 TypeBox object，状态枚举使用 Pi 为 Google 兼容性推荐的 `StringEnum`。不需要引入 Codex 专属工具协议。[L4][P3]

两版 `Model` 定义都没有通用的 `supportsTools` 标志。因此模型是否会可靠调用工具，不能仅靠元数据在启动前证明。检查 goal 工具是否启用只能发现工具缺失，不能认证模型能力。[P4][P5]

## Current coupling and stale assessment

旧报告 [`pi-goal-any-provider-assessment.md`](../../docs/research/pi-goal-any-provider-assessment.md) 不可直接用作实施清单。

| Topic | Current evidence | Consequence |
| --- | --- | --- |
| Provider gate | `capability.ts` 集中检查 openai-codex，并被 index、scheduler、accounting、children 共用；scheduler 的 model_select 另有 Codex 专属警告 | 不能只替换旧报告提到的 scheduler 三处文本；修改应覆盖共享准入、工具可见性、计量、子代理归集与切换测试 |
| Tool visibility | index 的 syncTools 会依据 capability 移除或恢复 create_goal 与 update_goal | 放开执行时必须同时核验模型实际收到 goal 工具，处理与其他扩展工具开关的交互 |
| Loop protection | scheduler 已有空自动续跑保护及 GoalLoopDetector | 旧报告“当前只处理 bash 失败”的描述已过时；只补现有机制确实漏掉的场景 |
| Token formula | goalTokens 当前返回 input + output + cacheWrite，并排除 cacheRead | 旧报告 input + output 的描述已过时，不应通过跨 provider 改造意外丢掉缓存写入 |
| Missing usage | 已有 usageIncomplete；无效或未经证实的全零 usage 不被当作精确零消耗 | 后续应决定缺失时的产品行为，不另造虚构的精确 token 总量 |

来源：[L1] 至 [L5]。异常终止与纯文本续跑的独立复核见 [terminal-contract-review.md](./terminal-contract-review.md)：非空纯文本 stop 序列仍可能无限自动续跑；宿主最终 settled 后的 length/deferred 可能留下 active 且无续跑。这些是静态控制流证据，并非真实模型端到端验证。

## Usage and error boundaries

两版统一 `Usage` 都包含 input、output、cacheRead、cacheWrite，reasoning 是 output 的可选子集。goal 不需要按 provider 再重复加 reasoning。OpenAI-compatible 模型还可能配置 `supportsUsageInStreaming: false`，存在服务不报告 usage 的合法接入场景。[P1][P4][P5]

统一 `AssistantMessage` 提供 stopReason 与 errorMessage，但没有通用的额度耗尽枚举或统一 HTTP status。HTTP response hook 的覆盖取决于 transport。仅修改 goal 无法保证对任意私有化错误文案进行精确的账户额度分类；可行方案是明确识别的额度和无法识别的最终错误分开处理，具体规则尚待 Planning #15。[P3][P4][P5]

`StopReason` 包含 length 与 deferred 等结果。不能在低层 agent_end 一看到异常就抢先停止宿主重试，也不能在最终 settled 后让 active 静默悬挂。具体停止与恢复语义交给 Planning #15。对于根本不发送终止事件或不遵守 abort 的自定义 provider，公开事件驱动保护不等于能够强制修复其实现。

本次核对的 0.85.1 变化包括新增 UI prompt 通知、会话模型选择的文档澄清、providerThinkingLevel 字段和 Anthropic 兼容参数等。没有发现要求 goal 为各 provider 重写调度的契约变化；这不替代双版本运行回归。

## Follow-up ownership

- [Planning #15](https://github.com/wangxuyang1221/adventure/issues/15)：异常停止与恢复，包括工具缺失、纯文本循环、终止结果、额度分类。阈值、paused 或 blocked、是否持久化均未定。
- [Planning #16](https://github.com/wangxuyang1221/adventure/issues/16)：usage 缺失、无预算与有预算运行、计量口径及预算保证。当前公式只是事实，尚未作为本次最终规格确认。
- 后续实施验收候选：按 API 家族而非品牌白名单安排离线协议/契约测试，加 `models.json` 风格私有 provider 与自定义 Provider，保留 Codex 回归。验证矩阵和版本承诺须在规划与切片审核中确定。

## Baseline check

在独立 worktree 使用 Node 22.22.2、pnpm 11.9.0：

1. `pnpm install --frozen-lockfile --ignore-scripts` 成功。
2. `pnpm run check` 成功，类型检查、测试、构建和发布包校验通过。
3. 81 个测试文件通过、2 个跳过；1012 项测试通过、2 项跳过。跳过的是两项 subagent 集成测试。
4. 完整输出见 [baseline-check.log](./baseline-check.log)。没有修改 `dist/` 生成结果的跟踪内容。

该结果只证明当前基线检查通过，不证明新支持范围已经实现；没有执行全 provider 真实服务验收，也没有执行 Pi 0.85.1 的完整运行矩阵。

## Sources

### Current repository

- [L1] [capability.ts](../../extensions/goal/src/capability.ts)
- [L2] [scheduler.ts](../../extensions/goal/src/scheduler.ts)
- [L3] [accounting.ts](../../extensions/goal/src/accounting.ts)
- [L4] [tools.ts](../../extensions/goal/src/tools.ts)
- [L5] [index.ts](../../extensions/goal/src/index.ts)

### Fixed upstream

- [P1] [Pi 0.84.3 models.md](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/models.md)
- [P2] [Pi 0.84.3 custom-provider.md](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/custom-provider.md)
- [P3] [Pi 0.84.3 extensions.md](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/extensions.md)
- [P4] [Pi 0.84.3 types.ts](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/types.ts)
- [P5] [Pi 0.85.1 types.ts](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/types.ts)
- [P6] [Pi 0.85.1 models.md](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/models.md)
- [P7] [Pi 0.85.1 custom-provider.md](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/custom-provider.md)
- [P8] [Pi 0.85.1 extensions.md](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md)
