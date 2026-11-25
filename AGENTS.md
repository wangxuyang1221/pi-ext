# AGENTS.md

- 本仓库维护 Pi 的 `codex-ui` 扩展和配套 `codex-pi` 主题。
- 扩展源码位于 `extensions/codex-ui/src/`，对应测试和夹具位于 `extensions/codex-ui/__tests__/`；`extensions/codex-ui/dist/` 是构建产物，不要手动编辑。
- 项目验证 skills 位于 `.cursor/skills/`；共享运行脚本和测试支持分别位于 `scripts/`、`test-support/`。按实际职责选择修改位置，不将所有变更都放进扩展源码目录。
- Node.js 和 pnpm 版本分别以 `package.json` 的 `engines.node`、`packageManager` 为准。使用 `pnpm install --frozen-lockfile --ignore-scripts` 安装依赖，使用锁定的原版 Pi 宿主。
- 仓库基础设施统一使用 pnpm。添加或修改脚本、文档和 CI 时使用 `pnpm` 或 `pnpm exec`；Vitest 测试通过 `pnpm test` 运行，以使用仓库的配置与凭据隔离入口。
- 首次检出并安装依赖后，运行 `pnpm run hooks:install` 和 `pnpm run hooks:check`。提交门禁及误报处理见 [测试说明](docs/testing.md#commit-gates)。
- 完成前运行 `pnpm run check`，覆盖范围以 `package.json` 的 `scripts.check` 为准。涉及终端交互或其他用户行为时，再按 [测试说明](docs/testing.md) 和对应验证 skill 执行受影响的验收；基础检查通过不代表完整用户流程或联网行为已验证。

## Agent skills

### Repository language policy

Agent 创建、修改或发布 text artifacts 前，必须先读取 `docs/agents/repository-language-policy.md`。

### Commit message policy

Agent 创建 commit message 前，必须先读取 `docs/agents/commit-message-policy.md`；该 policy 只约束 agent 创建的提交信息，不约束何时提交或如何执行 git commit。
