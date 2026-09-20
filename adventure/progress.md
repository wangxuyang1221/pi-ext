# Handoff

> 从 Continuation Point 接续。完整规格只在 Spec Issue 正文维护；证据中的历史候选不替代用户已确认要求。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为 Pi 实现 `$` 行内 skill 选择与激活，保留原生 skill 外观。用户已通过本轮 `next` 撤销暂停，要求继续冒险。

- [Map #1](https://github.com/wangxuyang1221/pi-ext/issues/1)
- [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)，已确定，可用于实施。
- [#8 输入闭环](https://github.com/wangxuyang1221/pi-ext/issues/8) 已由协调者验收通过。
- 下一关 [#9 队列与历史](https://github.com/wangxuyang1221/pi-ext/issues/9)，其后 [#10 可安装交付与整体验收](https://github.com/wangxuyang1221/pi-ext/issues/10)。三个切片均已获用户审核，不重新审核同一范围。

## Evolution

首批原计划同时改善输入与发送后折叠块。用户在 #4 选择仅做输入，#6 美化延期关闭，不是验收通过。#5 确定输入规则，#7 确定快照、历史与公开 editor 适配，均已通关并移交 Spec。

早期 input/context 或后置展示实验不是最终路线。用户已确认 message_start 提前展示、message_end 替换同一 user、消费时加载及公开 editor 适配的组合。远端独立复核已合并，没有据此恢复美化范围。

上次暂停存档为 b6c75eb。本轮用户恢复后派发独立 worker 完成 #8，提交 ac9947a 与 f600f08。协调者核对证据及代码入口，独立重跑正式测试 89/89，通过本关验收。当前尚未完成恢复兼容和安装交付。

## Agreed Decisions and Constraints

- 操作位置 `/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`，分支 `adventure/skill-mentions`。用户已批准该 worktree、分支提交推送和本仓库冒险 Issues 维护；仅操作本任务资料与代码，不改 main、不建 PR、不合并、不部署、不改全局 Pi。
- 只用公开 API，不 monkey patch，不改 Pi 上游。既有 slash 入口、历史及 CodexEditor 行为保持原样。
- 完整引用手写、粘贴、菜单等价；双侧仅空格/换行/Tab/输入边界。代码、转义、相邻标点、名称中间光标不触发。重复 skill 去重，不同 skill 按首次出现排序。Tab/Enter 选候选不发送，取消不删除引用。详细规则见 Spec，不再询问。
- TUI 内其他插件的普通 user 也识别；RPC/print 和其他 role 不纳入。未知或不可读 skill 静默作为普通文本保留，不显示激活或失败提示。
- 实际消费时读取文件，队列保持原文；同一 user 保存任务、图片和快照。正常卡片在正文前；恢复不重读。公开 editor factory 适配还原历史原文。
- 仅显示当前分支有效关联卡片，隐藏孤立展示，不补回丢失卡片，不固定或重注入被压缩的全文。历史快照不等于模型当前始终可见。
- 文本写入前读 `docs/agents/repository-language-policy.md`。新增用户可见产品文案须先确认语言，#8 沿用 skill 元数据与原生组件，未新增提示。
- 全仓已有缺文件不在本功能修复范围。若妨碍安装产物验收，先请求额外修复授权，不能跳过测试或造文件宣称通过。

## Established Facts and Required Context

- 当前产品提交 `f600f080f9b3dc66036ca424188bcb92592b9ce8` 已推送，验收时工作区干净。后续提交可能只更新存档，派发下一关使用实际最新 HEAD。
- Node 22.22.2、pnpm 11.9.0、Pi 0.86.0；Context7 未提供目标版本专属文档，版本行为由安装源码与真实执行核验。
- #8 开发入口 `extensions/skill-mentions/src/index.ts`，正式测试在 `extensions/skill-mentions/__tests__/`。已接入 typecheck/build/clean，未接入默认发布入口。
- [#8 实施证据](evidence/skill-input-implementation.md)记录完整协议、测试、性能、版本来源、局限和复现命令。接手 #9 必读。严格版本化封装由 `protocol.ts` 提供 `decodeSnapshot(...).task`，包含 UUID requestId、任务及真实路径/正文。displayType 为 `pi-ext/skill-mentions/display-v1`。
- 输入代码排除使用 Pi 公开 Marked lexer，补全与激活共用规则。一次清单索引，每个不同 skill 一次读取；100 KiB 混合 Markdown 补全中位 7.30 ms。性能只代表记录的本机负载。
- #8 正式测试 89/89，协调者独立重跑一致；源码及测试独立 tsc、build 通过。真实 DefaultResourceLoader、AgentSession、离线 faux provider 与原生组件参与，但 terminal/editor 宿主为替代对象，不是 PTY。
- [最终全仓 check](evidence/skill-input-final-check.log)：typecheck 通过、2042 passed、5 skipped，唯一 suite 失败为既有 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 缺失。[基准](evidence/skill-input-baseline-check.log)为 1953 passed、5 skipped，同一失败。worker 测试子进程清除了 PI_SUBAGENT_PARENT/LAUNCH/ID/SUBAGENT，避免已有 root fixture 误判，未跳过测试。
- [build](evidence/skill-input-build.log)通过；[package:check](evidence/skill-input-package-check.log)因既有 `docs/goal-descendant-acceptance.md` 缺失失败。全仓 check 和发布检查均不能称为通过。
- #9 必读[历史恢复审计](evidence/skill-history-recovery-audit.md)、[生命周期审计](evidence/multi-skill-lifecycle-audit.md)。规划实验共 47/47，日志为 [skill-compaction-policy-tests.log](evidence/skill-compaction-policy-tests.log)，只是方案证据，不替代产品集成。
- 真正 navigateTree(userId) 移到 user 的 parent 并把持久化文本回填，不等于 SessionManager.branch(userId)。公开 editor factory 组合已在实验验证，产品仍需 #9 实现；保留 CodexEditor 外观、callbacks、快捷键和 autocomplete。
- 如需追溯最初 API 选择，读[输入审计](evidence/skill-input-api-audit.md)及[独立复核](evidence/skill-feasibility-second-review.md)。不要从旧 handoff 的渲染路线停点继续。
- #8 未请求真实模型，临时目录已清理，无后台服务及监听端口。

## Current Assumptions

尚未验收的都是后续产品集成，不是待定用户意图。#9 负责实际 steer/followUp、多条队列顺序、消费时版本变化、JSONL 中断/失败、reload/resume/tree/fork、editor 适配与压缩。#10 负责真实 PTY、中文输入、自定义快捷键、扩展组合、安装产物及完整 Spec。

其他 extension 的 message_end、Markdown transformer、editor factory 组合尚无完整产品证据。若公开 API 不能满足契约，重开 #7，不擅改范围或使用内部补丁。

## Continuation Point

#8 已通过，继续 #9，不需要等待用户重新授权恢复。主代理担任协调者，一次推进一个 Implementation；为 #9 派发新上下文独立 worker，不继承整段会话、不继续由 #8 worker 编码下一关。派发前核对工作区及运行中 worker，避免重复施工。

提供 Map、Spec、#9、此存档、实施与恢复证据、实际 HEAD 和 worktree。worker 行动前完整读取以下 skills 与必要引用：

- `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md`

执行计划只维护在 Implementation 正文；worker 提交代码、测试及证据，协调者记录 Acceptance。通关后用 handoff 更新此存档、提交推送、更新并核对 Map，再继续 #10。最终由 #10 worker 核对完整 Spec 与延期验证并清理资源，协调者验收保存后等待用户确认；用户确认前 Map/Spec 保持 open。
