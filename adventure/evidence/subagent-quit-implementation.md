# Subagent quit implementation

## Result

正式 subagent extension 已接入 root TUI 的 `/quit`。实现使用 Pi 0.86.0 的 editor factory、`onSubmit`、`ui.select`、`abort` 和 `shutdown`，并直接复用 `SubagentManager.list` 与 `close("all")`。一次性规划 adapter 没有进入产品代码。正式 PTY 矩阵加载 build 生成的 `extensions/subagent/dist/index.js`。

实现覆盖以下结果：

- 没有存活或正在启动的 child 时直接退出。
- 存活 child 包括 running 与 settled。此时显示 `End session` 和 `Leave temporarily`，第一项为默认值。
- Escape 返回主 Pi，不中止 main turn。之后可继续提交普通 prompt 或再次 `/quit`。
- `End session` 先中止仍在执行的 main turn，再关闭当前 namespace，并通过第二次 list 确认 active 与 pending 都为 0 后退出。
- `Leave temporarily` 不关闭 child。同一 session resume 后仍按 owner 与 process identity 规则接管。
- diagnostics、pending startup、查询错误、close 错误和关闭后的非空状态都会留在当前 Pi。错误消失后可重试。
- 每个 editor 同时只运行一个 quit flow。session replacement、reload 或 shutdown 会 abort 旧 flow 使用的 signal，旧 context 不能再 select、notify、abort 或 shutdown。
- managed child、RPC、JSON 和 print 模式不安装 adapter。Ctrl+D 与信号退出不经过 adapter，也不调用 close-all。

manager 的 list deadline 为 5 秒，close deadline 默认为 5 秒。close-all 已有 in-flight spawn barrier、持久化 reservation、namespace closing 标志和 process identity 核验。本次增加 prompt delivery 与 close-all 并发回归，关闭完成后 parent 不再包含 child，child state 也不会恢复。

## Automated verification

环境：Node v22.22.2、pnpm 11.9.0、Pi 0.86.0、tmux 3.6b，基准 commit `6ba2e7ce8148ca320a437914ea55b64c8f6f7b54`。

`pnpm exec vitest run extensions/subagent/__tests__`：30 个 test files 通过，3 个按环境跳过；203 tests 通过，5 tests 跳过。新增回归包括：

- 退出选择、无 agent 直退、工作中 main abort、Escape、Leave、End。
- diagnostics、pending startup、query failure、partial close failure 与 cleanup verification failure 后重试。
- 重复 submit 只产生一次 list/select。
- session invalidation abort signal，旧 context 没有后续副作用。
- 现有 editor 的 draft、expanded text、label state、Ctrl+D handler 与普通 submit 保持原样。
- root TUI 才安装；managed child、RPC、JSON、print 不安装。
- prompt 正在投递时 close-all 仍关闭并删除 child。
- 既有 manager capacity tests 覆盖 close-all 等待 in-flight spawn，以及 reservation 注册交错时不重复或遗漏 process。

`PI_SUBAGENT_FIXTURE_DIST=1 pnpm exec vitest run extensions/subagent/__tests__/index.test.ts`：1 个 test file、13 tests 全部通过，确认入口测试可加载构建后的 extension。

`pnpm run check`：全仓 typecheck 通过。Vitest 有 156 个 test files 通过、3 个跳过；2350 tests 通过、5 tests 跳过。唯一失败仍是既有 MCP suite，原因是仓库缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`。check 因此没有进入 build 和 package check。

随后单独运行 `pnpm run build`，通过。生成的 `extensions/subagent/dist` 包含 `quit.js`、声明和 source map。`pnpm pack --dry-run` 通过，tarball 清单包含这些 quit 产物。

单独运行 `pnpm run package:check` 失败，因为 `docs/goal-descendant-acceptance.md` 不存在。基准 commit 的 tree 同样没有该文件，package manifest 与 package check 已在本次改动前要求它。本关没有补写无关 goal 文档。dry-run tarball 也因此缺少 manifest 中多项既有验收文档；不能把 dry-run 成功描述成 package check 通过。

## Production PTY matrix

[Editor matrix data](subagent-quit-product-entry-results.json) 保存 12 组正式入口结果。每组使用真实 Pi、生产 subagent extension、真实 editor 和独立 tmux server：

| Host | Mode | Choices |
| --- | --- | --- |
| native | regular | Leave temporarily, End session |
| native | fullscreen | Leave temporarily, End session |
| Codex | regular | Leave temporarily, End session |
| Codex + skill | regular | Leave temporarily, End session |
| Codex + skill | fullscreen | Leave temporarily, End session |
| skill before adapter | regular | Leave temporarily, End session |

12 组全部先打开选择并按 Escape，确认主 Pi 与 child 保留，再提交普通 prompt。skill 组合还检查 `$alpha` 对应的 `ALPHA_BODY` 进入模型请求。第二次 `/quit` 才选择最终动作。Leave 时 child 在 launcher cleanup 前仍存活；End 时 child 已停止。无关 keeper window 在 12 组都存活。

[Backend matrix data](subagent-quit-product-results.json) 保存 13 组正式后端结果：empty、leave、end-running、query-retry、partial-close-retry、cancel、main-busy、reload、resume、sighup-resume、sigterm-resume、sigkill-resume 和 ctrld-resume。

13 组全部通过。resume 场景在 Leave 后使用相同 session 文件启动新主 Pi，原 child 在第二轮主动 End 前保持存活。四个无选择退出场景也先断言旧主 Pi 已退出、原 child 仍存活、第二轮 session 文件相同，然后才通过正式 `/quit` 回收。SIGKILL 的第一轮没有 session shutdown 记录。SIGHUP 只验证信号路径，不代表所有终端应用的关闭行为。

query failure 注入 tmux display-message 错误，主 Pi 保留，child 不受影响；移除故障后重试成功。partial close failure 使用两个 child，先确认一个已关闭、另一个仍存活且主 Pi 未退出，再移除故障并回收剩余 child。main-busy 使用自然完成时间为 4 秒的受控模型请求，`/quit` 在 386ms 内完成 abort、回收和退出。

## Isolation and cleanup

正式 PTY 使用 worktree 下的临时 HOME、agent dir、session dir、tmux socket、tmux wrapper 和离线 faux 模型。测试不加载日常 Pi 配置，不连接模型网络，也不使用用户 tmux server。

每组在产品动作后先核验 keeper window，再由 launcher 清理隔离 server。结果文件记录的 `livePids` 均为空，`socketUnavailable` 均为 true，临时 root 均已删除。一次失败的测试断言曾留下一个隔离 root；确认没有相关进程后按精确路径删除。任务结束复查没有 `quit-choice-*` 临时 root，也没有匹配的 Pi、offline child 或 probe tmux 进程。

## Reproduce

```sh
pnpm exec vitest run extensions/subagent/__tests__
PYTHONDONTWRITEBYTECODE=1 conda run --no-capture-output -n codex-py312 python adventure/prototypes/quit-choice/product-entry-smoke.py
PYTHONDONTWRITEBYTECODE=1 conda run --no-capture-output -n codex-py312 python adventure/prototypes/quit-choice/product-smoke.py
pnpm run check
pnpm run build
pnpm run package:check
pnpm pack --dry-run
```

## Boundary

本轮不增加遗忘提醒、跨 session 管理入口、idle timeout 或自动回收。未经过 `/quit` 选择时只承诺扩展不会主动 close-all。若 tmux server、child 进程或主机本身同时退出，功能不能恢复不存在的进程。原生 session 历史不会因 End session 被删除。
