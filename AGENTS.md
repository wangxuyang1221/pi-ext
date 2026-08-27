# AGENTS.md

- 本仓库专用于开发和维护 Pi extensions 与 skills
- 修改 `src/` 及对应的 `__tests__/`；`dist/` 是生成产物，不要手动编辑。
- 使用 Node.js 22.19+，通过 `npm ci --ignore-scripts` 安装依赖。
- 完成前运行 `npm run check`，执行类型检查、测试、构建并校验发布包。

## Agent skills

### Repository language policy

Agent 创建、修改或发布 text artifacts 前，必须先读取 `docs/agents/repository-language-policy.md`；当 artifact 或 partition 未被覆盖时，写入前必须询问用户。
