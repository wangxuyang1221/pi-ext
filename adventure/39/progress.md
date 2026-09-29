# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

Goal 的三个工具已正式接入 summary 展示，产品提交 `a8249404b5adaded97dee4929423160bbf59dda7`。用户已确认手动验收通过，要求合并 main；代码已合入主工作区并通过最终检查。本场交付完成，归档后关闭 Map #39 与 Spec #40。安装配置回切 main 和分支清理不属于未完成的产品需求。

## Evolution

用户认为 Goal 功能工作良好，只要求 UI 与 codex-ui 工具统一，并确认不改 footer 和 `/goal`。在真实 TUI 比较原型后，用户选择 summary、要求收敛。随后审核唯一实施切片，并指定 subagent 使用 expert。

expert 执行者 Thor 完成产品实现、正式组合验证和证据。主代理独立核对源码及测试路径，复跑组件与工具测试并核对结构化证据，第一次验收通过，关闭 #43。用户后来确认手动验收通过并授权合并 main，同时要求提交主工作区原有改动。已完成合并与单独提交，未创建 PR、未部署。

## Agreed Decisions and Constraints

- 完整规格只维护在 [Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40)，所有延期验证已注明验证结论与证据入口。
- 固定 summary：操作与目标状态、单行目标预览、tokens/可选预算和耗时；使用 Pi 原生展开查看完整详情。无密度配置或原型命令进入产品。
- 产品改动只有 `extensions/goal/src/renderers.ts` 与 `extensions/goal/src/tools.ts` 的 renderer 接入。执行、schema、description、response、存储/调度/计量、footer 和其他工具均未修改。
- 仓库 `wangxuyang1221/pi-ext`，分支 `adventure/goal-tool-ui`，worktree `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/goal-tool-ui`，资料 `adventure/39/`。
- 用户允许创建更新本场 Issues、提交和推送，最终明确批准合并 main，并单独授权提交原工作区全部未提交内容。仍不创建 PR、不部署；远端分支清理由用户决定。
- 主代理负责协调与 Acceptance；用户要求执行 subagent 为 expert，执行者不得再委派。源码和测试按 TDD 修改，不手动改 dist。

## Established Facts and Required Context

- [Map #39](https://github.com/wangxuyang1221/pi-ext/issues/39) 与 [Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40) 已获用户最终交付确认，归档时将材料固定到提交链接；[Implementation #43](https://github.com/wangxuyang1221/pi-ext/issues/43) 已关闭，保存完整 slice、执行计划、交付、验证和第一次 Acceptance。
- [slices.md](slices.md) 是已获审核的唯一切片；Planning #41/#42 均已通关。
- [执行者验收矩阵](evidence/implementation-verification.md) 按 Spec 7 项 Acceptance 和全部 Deferred verification 提供正式代码证据，包含运行命令、失败修正、输入替代边界与资源清理。
- [协调者验收](evidence/coordinator-acceptance.md) 记录独立源码/证据核对和 9/9 组件/工具测试复跑。实现没有改变执行与数据路径，组合/独立 SDK、两个真实 PTY 模式的路径覆盖充分，无返工项。
- 完整 `pnpm run check` 通过，2604 tests passed、13 个既有 tests skipped，类型、构建和发布包检查通过。组合/独立 SDK 各 45 次离线模型请求；regular/fullscreen PTY 覆盖三个 Goal 工具和真实 Bash/Write/Edit、展开、窄屏、主题、reload 与双进程恢复。
- 模型使用 faux provider，Goal 的生产执行/存储/计量/调度未替换。非法 details 用组件边界注入；明确取消用正式 execute 的 AbortSignal guard 产生，再验证真实组件，未声称实际 Esc 能稳定命中瞬时 I/O。未扩大到 RPC、其他 Pi 版本或所有终端。
- 测试运行时进程已退出，隔离目录删除，无遗留监听端口。协调者新增测试隔离目录也已删除。
- 运行版本为 Pi 0.87.0、Node v22.22.2、pnpm 11.9.0。当前 harness 的 Pi 文档是 0.87.1，后续改动仍须核对目标接口版本。
- 原型保存在 [README](prototypes/goal-tool-ui/README.md)，可追溯选择依据，不再是最终实现入口。不要把原型内存 GoalAccess 当作正式路径。
- 原 expert 执行者 Thor 已按用户要求关闭，不能继续复用其 runtime。
- 用户已批准修改 `~/.pi/agent/settings.json`，只禁用主工作区 Goal 并加载本 worktree 的 `extensions/goal/dist/index.js`。用 Pi 0.87.1 的实际 package resolver 核验只有一个 Goal 启用，其他扩展仍来自主工作区。验收后清理 worktree 前必须先处理此安装指向。
- 用户随后报告旧原型无法启动，已复现并修复 prepare 清单漏掉生产 renderers 的回归。启动导入测试先失败后通过，组件和两个真实 PTY 模式均通过，完整 check 仍为 2604 passed / 13 skipped。见[修复记录](evidence/prototype-startup-repair.md)。本次未改产品代码。

## Current Assumptions

无未决技术方案或已知验收失败。用户已明确确认交付并批准合并；尚未要求删除分支。

## Continuation Point

产品交付完成。将本存档和[合并验证](evidence/merge-validation.md)提交推送，在 Map 与 Spec 固定材料链接，核验可读后关闭两者。

1. 集成 main 最新 MCP/恢复改动的提交为 `b004be35d509db1be86083b07d4a1795d6cd0347`。用户原有 33 个删除项和 1 个新增文档单独提交为 `255c14ad94ec08b5d9fd332a23ddc8de3b908ac6`。最终 main 的完整 check 为 2622 passed / 13 skipped，主工作区构建已更新。
2. 本地安装仍指向冒险 worktree。要回切 `~/.pi/agent/settings.json`，先说明工作目录外写入范围并取得用户“同意”；在此之前保留 worktree。分支删除另行确认。
3. 后续若用户提出产品调整，按受影响要求重开关卡，实施使用 expert；原 Thor 已关闭。
