# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。遇到上下文缺口先读取所指来源，仍不足时明确缺口。
>
> 开始工作前，按当前任务识别本文适用的约束、未完成事项和必读材料。交付前逐项核对这些条件是否落实，保留影响结论的例外、未验证范围与停止条件；未落实的内容说明原因。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

按 adventure 流程推进 goal 的多 provider 与私有化模型适配。用户首先想知道只修改 extension 是否可行，不预先承诺所有模型均可运行。

- [Map #11](https://github.com/wangxuyang1221/adventure/issues/11) 管理进度与关卡关系。
- [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12) 是规格唯一维护位置，当前形成中。
- [Planning #14](https://github.com/wangxuyang1221/adventure/issues/14) 是当前关卡，核验 extension-only 可行性与支持边界。

## Evolution

用户指定 adventure 仓库托管 Issues，代码仍在 pi-ext。已获准创建独立分支和 worktree，并只推送该分支。

[Planning #13](https://github.com/wangxuyang1221/adventure/issues/13) 已通关关闭。用户明确选择方案 1：Pi 负责私有化模型配置，goal 复用当前模型。由此排除 goal 自建模型接入入口；有效要求已移交 Spec。

## Agreed Decisions and Constraints

沿用 Spec 的 Scope、Behavior 与 Working agreement。核心边界是复用 Pi 当前模型，不另存 base URL、API key；不得把后续候选保护策略或旧调研建议当作已确认需求。

代码仓库为 `wangxuyang1221/pi-ext`，冒险分支为 `adventure/goal-all-providers`，worktree 为 `/Users/wangxuyang/Code/t3code/pi-ext-goal-all-providers`。不改 main，不创建 PR、不合并、不部署，不记录密钥。当前主工作目录之外的该 worktree 写入和本次 Issue、冒险分支推送已获用户“同意”。

创建材料遵循仓库 `docs/agents/repository-language-policy.md`。产品文案写入前仍须询问。实施必须先完成规划并提交 slicing 审核，之后主代理协调 worker，一次实施一关。

## Established Facts and Required Context

- 起点提交为 `870cf4961436e8252a61c00d29a300a5a4b53760`，未修改产品源码。
- `extensions/goal/src/capability.ts` 直接检查 openai-codex，并要求根会话、TUI 和持久化会话。这是本次当前代码已核验事实。
- `package.json` 固定开发依赖 Pi 0.84.3；会话提供的宿主文档位于 Pi 0.85.1 包中。尚未完成双版本契约复核。
- Node 为 22.22.2，pnpm 为 11.9.0，与项目要求匹配。尚未在新 worktree 安装依赖或运行检查。
- `docs/research/pi-goal-any-provider-assessment.md` 已完整读取，可作为检索入口，但其白名单代码定位已过时。技术判断须复核相关当前源码与固定版本上游。
- Map 的子 Issues 为 Spec #12、Planning #13 与 #14。#14 原生依赖 #13；后者已关闭。
- 未启动服务或后台进程。

继续前完整读取 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md` 及其 `references/issue-templates.md`。保存使用 `/Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md`，存档固定写在本文件。

## Current Assumptions

旧评估认为 Pi 已提供 provider-neutral 的响应、事件和 usage 契约，可在 extension 层适配合规且支持工具的模型。该判断尚待本轮复核；无工具、缺失 usage、额度分类等行为尚未形成用户确认的方案。

## Continuation Point

首关自动保存后继续 #14，不等待用户重复确认接入职责。

1. 阅读当前 goal 调度、工具和计量代码，核对 Pi 0.84.3 与 0.85.1 文档和源码；按项目规定使用 Context7 定位，固定版本官方来源补证。
2. 以必要的只读核验或离线实验判断 extension-only 路线，将证据保存在 `adventure/evidence/`。不要求用户提供密钥或真实服务。
3. 向用户提交有证据支持的范围选择，一次只问一个决策。纯事实自主查证，运行保护和预算规则拆为有独立结论的 Planning。
4. 更新 Planning 正文；通关后移交 Spec，处理后续关卡，更新本存档并提交推送，核对远端与 Map 后继续。
5. 规划收敛后使用 slicing 提交实施切片审核，再派 worker 实施。最终须运行 `pnpm run check` 并整体验收；Map 与 Spec 在用户确认交付前保持 open。
