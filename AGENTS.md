# AGENTS.md

- 本仓库开发和维护 Pi extensions、主题及配套 skills。
- 扩展源码位于 `extensions/<name>/src/`，对应测试和夹具位于 `extensions/<name>/__tests__/`；`extensions/<name>/dist/` 是构建产物，不要手动编辑。
- 项目验证 skills 位于 `.cursor/skills/`；共享运行脚本和测试支持分别位于 `scripts/`、`test-support/`。按实际职责选择修改位置，不将所有变更都放进扩展源码目录。
- Node.js 和 pnpm 版本分别以 `package.json` 的 `engines.node`、`packageManager` 为准。使用 `pnpm install --frozen-lockfile --ignore-scripts` 安装依赖，保留锁文件、`pnpm-workspace.yaml` 和 `patches/` 以复现宿主补丁。
- 仓库基础设施统一使用 pnpm。添加或修改脚本、文档和 CI 时使用 `pnpm` 或 `pnpm exec`；Vitest 测试通过 `pnpm test` 运行，以使用仓库的配置与凭据隔离入口。
- 完成前运行 `pnpm run check`，覆盖范围以 `package.json` 的 `scripts.check` 为准。涉及终端交互、tmux、宿主记账或其他用户行为时，再按 [测试说明](docs/testing.md) 和对应验证 skill 执行受影响的验收；基础检查通过不代表完整用户流程或联网行为已验证。

## Host patches

- 宿主补丁作为可选增强。问题属于宿主职责，且小范围补丁能减少插件绕行、提供更完整且易维护的方案时，可以采用；否则优先在插件内修复，接受合理妥协。
- 补丁版 Pi 使用独立依赖和启动入口，不修改全局 Pi 的安装、默认命令或升级流程。TUI 可显式选择补丁版，T3 Code 继续使用全局 Pi。
- 插件通过能力检测兼容未打补丁的宿主，缺少补丁接口时走明确的降级路径。分别验证补丁版的增强行为和原版的正常使用，说明降级后保留及缺失的能力。
- 补丁固定宿主版本，升级补丁版时单独验证兼容性；全局 Pi 可独立升级。保持补丁范围小、行为可验证，上游提供等价能力后移除补丁。
- 妥协可以是展示差异、额外操作或增强能力不可用，不能损害数据正确性、会话隔离或取消语义。插件接口不足以可靠实现时，明确报告限制。

## Agent skills

### Repository language policy

Agent 创建、修改或发布 text artifacts 前，必须先读取 `docs/agents/repository-language-policy.md`。

### Repository commit policy

Agent 执行本地 Git 提交前，必须先读取 `docs/agents/repository-commit-policy.md`，完成其中的检查并处理阻断项。

### Commit message policy

Agent 创建 commit message 前，必须先读取 `docs/agents/commit-message-policy.md`；该 policy 只约束 agent 创建的提交信息，不约束何时提交或如何执行 git commit。
