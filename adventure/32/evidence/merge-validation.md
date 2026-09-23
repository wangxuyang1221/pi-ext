# Main merge verification

## Delivery confirmation

用户于 2026-09-24 明确表示测试通过，并要求合并 main。将冒险分支 c7ebec8 合入 main 的 a135e19，无冲突；main 上的 goal 修复完整保留。

## Verification

- Node.js v22.22.2、pnpm 11.9.0，合并后运行 pnpm run check：[完整日志](merge-validation/check.log)。172 个测试文件、2599 tests 通过，13 个门控默认跳过；类型检查、构建、发布包校验通过。
- 另行设置 PI_SUBAGENT_ISOLATED_INTEGRATION=1，运行 fast-production.test.ts 和 host-compatibility.test.ts：[集成日志](merge-validation/integration.log)。3 tests 通过，覆盖真实 root→tmux child 的角色/Fast 联动，记录 60 个实际 HTTP 请求。
- 子代理与 Fast 的主工作区构建入口及 roles/tools 文件逐字节匹配已验收 worktree 产物。dist 由构建生成。
- 本轮测试的 13 个 PID 均退出，隔离 tmux socket 不可用，场景目录由测试清理；没有 HTTP 监听服务。运行所需 HOME、TMPDIR、XDG 目录均隔离在仓库 .scratch/merge-32 内。

## Local installation

本地 Pi 0.87.1 的 settings.json 已恢复使用主工作区包来源，撤销临时分流 subagent/Fast 到 worktree 的配置。使用本机 DefaultPackageManager 解析前后配置，确认仅这两个入口切回 main，其他扩展、skills、prompts、themes 的有效集合保持一致，无重复加载。

用户级 expert、worker、explorer 配置保留，通过 main 构建的 loadRoles 校验。现有 Pi 会话需执行 /reload 或重启。冒险分支及 worktree 保留，不自动删除。
