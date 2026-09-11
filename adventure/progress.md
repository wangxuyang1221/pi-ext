# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

本次冒险已完成。用户明确表示已试用、确认交付，并要求将 worktree 合并到 main、关闭游戏。没有待实施或待用户验收事项。

- [Map #11](https://github.com/wangxuyang1221/adventure/issues/11) 与 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12) 按交付确认关闭。
- Implementation #17、#18、#19 已验收通过并关闭。
- 本地 main 已从 `870cf49` 快进合并至 `bb46f7a`，本次最终存档继续快进纳入 main；冒险分支推送保存。本次不推送远端 main。

## Evolution

Planning #13 至 #16 形成合规 provider 支持、异常恢复、工具恢复门控、预算与计量规则，完整规格只在 Spec 正文维护。用户审核三关实施后，独立 worker 依次交付，协调者验收通过。

产品交付提交为 `7bff254d732c769d2e88474da645bf911fc5f6f8`，最终本地审计完成后，按用户授权将 Pi 本地包来源切至冒险 worktree。`e0d4c20` 为试用前手动存档。用户之后手动提交 `bb46f7a`，修复 subagent 的 DeepSeek 工具 Schema 兼容性；该提交与本场冒险无关，合并时完整保留，不记作冒险交付。

用户现已完成试用并确认交付，后续合并授权取代此前禁止修改 main 的限制，仅执行本地合并，不创建 PR、部署或发布。

## Agreed Decisions and Constraints

- 完整要求、设计与验收边界以 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12) 为准，不重复开展规划。
- goal 复用 Pi 当前合规且支持普通 function tools 的模型，无 provider 名称白名单；不改 Pi 核心，不建立独立凭据或协议链路。保留根会话、交互 TUI、持久化准入要求。
- Pi 恢复结束后的最终异常按规格停止；必要工具恢复后必须显式 `/goal resume`，不擅自启用工具。
- token 口径为 `input + output + cacheWrite`，排除 cacheRead；缺失 usage 提示不完整并继续，历史缺口不自动清除。预算是观测后的软限制，不保证硬封顶。
- 同目标恢复保留累计、预算和缺口；仅归集可归属根、Pi 提供 usage 的摘要及受管直接子代理。冻结与迟到报告边界见 Spec。
- 保留远端冒险分支和 worktree，保留用户手动提交。未授权删除、部署、发布或改动其他全局配置。
- Pi 安装来源仍为 `/Users/wangxuyang/Code/t3code/pi-ext-goal-all-providers`。本次未改配置，不能直接删除该 worktree；若日后改用 main 安装，应先另获全局配置变更授权。
- 遵守仓库语言政策。产品提示使用英文已获确认；文档正文中文、标题英文，代码和测试名英文，提交信息中文。`dist/` 只能构建生成。

## Established Facts and Required Context

### Delivery and verification

- [完整 Spec 审计](./evidence/slice-3-spec-audit.md)：逐项交付、延期验证、包与文档核验；后续排查行为差异时读取。
- [最终协调者验收](./evidence/slice-3-coordinator-acceptance.md)：双版本独立复验、实际 TUI、包加载和清理结果。
- [正式使用说明](../docs/goal-provider-support.md)：当前支持范围、操作与计量限制。
- [试用安装记录](./evidence/user-installation.md)：原安装来源、用户授权、安装与回退方法。本次未执行回退。
- 本次在合并后的 main 运行 `env -u PI_SUBAGENT_PARENT pnpm run check`，1072 测试通过、2 项默认跳过，类型检查、构建、发布包校验通过。日志见 [game-close-check.log](./evidence/game-close-check.log)。Node v22.22.2、pnpm 11.9.0。相比之前的 1067 项通过，包含用户额外提交的测试。
- 既有验收覆盖 Pi 0.84.3/0.85.1 原生 adapter 离线矩阵、真实受管进程、实际 TUI 与打包加载。未把真实远端付费模型、全部私有服务额度文案或跨平台实测记作已验证；本次用户反馈只确认已试用通过，未提供具体模型或场景，不补造试用记录。
- 本次不派发 worker、不启动后台服务。检查命令已退出；旧 worker 与测试资源的清理证据见最终协调者验收。

### Repository state

- 主工作区：`/Users/wangxuyang/Code/t3code/pi-ext`，分支 `main`。
- 冒险工作区：`/Users/wangxuyang/Code/t3code/pi-ext-goal-all-providers`，分支 `adventure/goal-all-providers`。
- 用户无关提交 `bb46f7a` 保留在共同提交历史中，没有改写、回退或重新实现。
- 本次最终存档提交可从本文件 Git 历史和 Map 获取。远端冒险分支保存最终存档，本地 main 包含同一存档；远端 main 不在本次推送范围内。

## Current Assumptions

无影响结案的未决假设。用户确认试用通过不等同于新增所有远端模型或平台的测试证据。

## Continuation Point

游戏结束。用户已确认交付，本地 main 已合并，最终存档推送至冒险分支，Map 与 Spec 关闭后停止。无需再询问交付确认或派发实施任务。

不自动推送 main、删除分支或 worktree、改 Pi 安装来源、部署或发布。后续用户提出问题时，先读取 Spec 及对应验收证据，再按影响范围恢复关卡；历史中途存档通过本文件 Git 历史查阅。
