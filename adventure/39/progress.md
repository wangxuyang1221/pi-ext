# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

Goal 的三个工具已正式接入 summary 展示，产品提交 `a8249404b5adaded97dee4929423160bbf59dda7` 已推送，Implementation #43 与整体验收通过。当前等待用户最终确认交付，Map #39 与 Spec #40 保持 open，不继续实施。

## Evolution

用户认为 Goal 功能工作良好，只要求 UI 与 codex-ui 工具统一，并确认不改 footer 和 `/goal`。在真实 TUI 比较原型后，用户选择 summary、要求收敛。随后审核唯一实施切片，并指定 subagent 使用 expert。

expert 执行者 Thor 完成产品实现、正式组合验证和证据。主代理独立核对源码及测试路径，复跑组件与工具测试并核对结构化证据，第一次验收通过，关闭 #43。未创建 PR、未合并 main、未部署。

## Agreed Decisions and Constraints

- 完整规格只维护在 [Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40)，所有延期验证已注明验证结论与证据入口。
- 固定 summary：操作与目标状态、单行目标预览、tokens/可选预算和耗时；使用 Pi 原生展开查看完整详情。无密度配置或原型命令进入产品。
- 产品改动只有 `extensions/goal/src/renderers.ts` 与 `extensions/goal/src/tools.ts` 的 renderer 接入。执行、schema、description、response、存储/调度/计量、footer 和其他工具均未修改。
- 仓库 `wangxuyang1221/pi-ext`，分支 `adventure/goal-tool-ui`，worktree `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/goal-tool-ui`，资料 `adventure/39/`。
- 用户允许创建更新本场 Issues、提交和推送本分支。禁止纳入原工作区已有改动，不创建 PR、不合并、不部署。远端分支清理由用户决定。
- 主代理负责协调与 Acceptance；用户要求执行 subagent 为 expert，执行者不得再委派。源码和测试按 TDD 修改，不手动改 dist。

## Established Facts and Required Context

- [Map #39](https://github.com/wangxuyang1221/pi-ext/issues/39) 当前为等待最终确认；[Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40) 已实施；[Implementation #43](https://github.com/wangxuyang1221/pi-ext/issues/43) 已关闭，保存完整 slice、执行计划、交付、验证和第一次 Acceptance。
- [slices.md](slices.md) 是已获审核的唯一切片；Planning #41/#42 均已通关。
- [执行者验收矩阵](evidence/implementation-verification.md) 按 Spec 7 项 Acceptance 和全部 Deferred verification 提供正式代码证据，包含运行命令、失败修正、输入替代边界与资源清理。
- [协调者验收](evidence/coordinator-acceptance.md) 记录独立源码/证据核对和 9/9 组件/工具测试复跑。实现没有改变执行与数据路径，组合/独立 SDK、两个真实 PTY 模式的路径覆盖充分，无返工项。
- 完整 `pnpm run check` 通过，2604 tests passed、13 个既有 tests skipped，类型、构建和发布包检查通过。组合/独立 SDK 各 45 次离线模型请求；regular/fullscreen PTY 覆盖三个 Goal 工具和真实 Bash/Write/Edit、展开、窄屏、主题、reload 与双进程恢复。
- 模型使用 faux provider，Goal 的生产执行/存储/计量/调度未替换。非法 details 用组件边界注入；明确取消用正式 execute 的 AbortSignal guard 产生，再验证真实组件，未声称实际 Esc 能稳定命中瞬时 I/O。未扩大到 RPC、其他 Pi 版本或所有终端。
- 测试运行时进程已退出，隔离目录删除，无遗留监听端口。协调者新增测试隔离目录也已删除。
- 运行版本为 Pi 0.87.0、Node v22.22.2、pnpm 11.9.0。当前 harness 的 Pi 文档是 0.87.1，后续改动仍须核对目标接口版本。
- 原型保存在 [README](prototypes/goal-tool-ui/README.md)，可追溯选择依据，不再是最终实现入口。不要把原型内存 GoalAccess 当作正式路径。
- 可复用的 expert 执行者 Thor：agentId `01a0eb0b-d85e-7176-b089-dc1d2c38a344`，最后一轮已 settled。当前保留上下文供用户审阅后可能的调整；续接先核对 runtime 状态和工作区，避免重复施工。

## Current Assumptions

无未决技术方案或已知验收失败。技术验收通过不等于用户最终确认。未经用户要求，不合并或删除分支。

## Continuation Point

等待用户最终确认交付，停止推进。

1. 用户提出调整时，先明确受影响的要求与关卡，优先复用 Thor expert，传递新增目标、范围和验收条件。设计变化先重开 Planning；局部修复重开 #43，完成后重新核对受影响证据。
2. 用户确认交付后，按 adventure 更新 Map、Spec 与存档，将交付、验收和最终存档链接固定到已推送的提交，核验远端可读后关闭 Map 和 Spec。
3. 远端分支是否删除另由用户决定，不把删除作为自动清理。不创建 PR、不合并、不部署，除非用户另行明确授权并处理相应流程。
