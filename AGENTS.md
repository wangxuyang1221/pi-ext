# AGENTS.md

- `extensions/codex-ui/` 与 `extensions/claude-code-ui/` 是可独立安装的 Pi 插件。各自在 `src/`、`themes/` 和 `__tests__/` 维护自己的界面、主题与测试。`dist/` 是构建产物。
- 两个插件复用的宿主生命周期、数据模型和工具执行放在 `shared/ui/`。每个发布包在构建时打入所需的共享代码。
- 改动某个插件的用户行为，运行对应的 [Codex UI 验收](.cursor/skills/verify-pi-codex-ui/SKILL.md) 或 [Claude Code UI 验收](.cursor/skills/verify-pi-claude-code-ui/SKILL.md)。改动共享行为时覆盖两个插件。
- Node.js 和 pnpm 版本分别以 `package.json` 的 `engines.node`、`packageManager` 为准。使用 `pnpm install --frozen-lockfile --ignore-scripts` 安装依赖，使用锁定的原版 Pi 宿主。
- 仓库基础设施统一使用 pnpm。添加或修改脚本、文档和 CI 时使用 `pnpm` 或 `pnpm exec`；Vitest 测试通过 `pnpm test` 运行，以使用仓库的配置与凭据隔离入口。
- 首次检出并安装依赖后，运行 `pnpm run hooks:install` 和 `pnpm run hooks:check`。提交门禁及误报处理见 [测试说明](docs/testing.md#commit-gates)。
- 完成前运行 `pnpm run check`，覆盖范围以 `package.json` 的 `scripts.check` 为准。涉及终端交互或其他用户行为时，再按 [测试说明](docs/testing.md) 和对应验证 skill 执行受影响的验收；基础检查通过不代表完整用户流程或联网行为已验证。

## Agent skills

### Verification decisions

| 修改场景 | 验收依据 |
| --- | --- |
| 修改工具渲染缓存时，如何判断主题依赖是否完整？ | 只替换一种相关配色，用同一份内容比较已挂载视图与新建视图。[差异换色回归](extensions/codex-ui/__tests__/codemode-diff-theme.test.ts) |
| 修改终端任务状态时，如何确认用户看到了这次操作的结果？ | 将本次操作的生命周期事件与随后完整绘制的状态区域配对，覆盖普通和全屏模式。[Working 终端验收](test-support/fixtures/working/working_journey.py) |

### Repository language policy

Agent 创建、修改或发布 text artifacts 前，必须先读取 `docs/agents/repository-language-policy.md`。

### Commit message policy

Agent 创建 commit message 前，必须先读取 `docs/agents/commit-message-policy.md`；该 policy 只约束 agent 创建的提交信息，不约束何时提交或如何执行 git commit。
