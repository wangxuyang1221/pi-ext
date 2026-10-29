---
name: verify-pi-codex-compact
description: "Verify pi-ext codex-compact through Pi TUI /compact and /codex-metadata, provider request and session resume. Use after changing its core behavior or investigating a regression."
---

# Verify Pi codex-compact

先读 [行为索引](features/README.md)，按本次变更选择所有受影响入口。压缩要求 provider/API 同时为 `openai-codex` / `openai-codex-responses`。配置命令使用 faux CLI；专用 PTY 使用真实 CLI、Codex adapter 和生产扩展，以固定服务响应验收客户端行为。[场景配方](journeys.md) 提供可重复的组合、自动压缩、选择器和旧历史命令。线上接受性和摘要质量需要另行实跑。

## Launch

从仓库根目录运行。首次准备与隔离规则见 [共享运行说明](../verify-pi-ext/README.md)。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run metadata
```

这是短生命周期验证。驱动创建空配置、会话和临时目录；同一验证生命周期可以停止并重开 Pi，结束后保留证据、删除 scratch。资源发现完成后才输入命令，再等待对应终端提示与会话结果。共享 `tui codex-compact` 只适合配置命令，它的 faux provider 无法触发 Codex 压缩。

## Doctor

运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor`，核对实际 Node、pnpm、Pi 版本、构建入口与 Python/pyte。`lockPresent: true` 时先读取对应锁中的 PID，等待当前验证退出，不双重驱动。专用 PTY 在每次启动 Pi 前运行 doctor，并核验锁属于自己。失败后检查本次 summary 的 PID 和清理结果，再运行 doctor；重新启动新实例，不继续操作失败的终端状态。

## Drive

- [Model metadata configuration](features/metadata.md)
- [Manual and automatic compaction](features/compaction.md)
- [Checkpoint continuation and model switching](features/resume.md)
- [History, media and budget preservation](features/retention.md)

每个 feature 的自动入口只证明文件注明的范围。补充步骤必须逐项执行并记录，不得把全部单元测试通过写成全部用户旅程通过。

专用压缩旅程在仓库根目录执行，证据目录必须位于 `.tmp` 且尚不存在：

```bash
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-compact/scripts/compact-pty.py .tmp/compact-pty-proof
```

省略第二参数运行 `combination`。它先完成手动压缩、Esc 取消、metadata 保存/reset 和重试，再用同进程 `/new` → `/resume` 搜索选择旧会话、调用工具、添加工具声明和更新系统提示，最后退出并以 `--session` 冷启动续聊。`/resume` 选择器和冷启动分别留存动作、画面及后续实际请求。

`/fixture-history` 经 `pi.sendUserMessage` 提交固定文本和 PNG；`fixture_read` 返回固定工具内容并注册一个新工具，用于观察真实宿主的工具执行和系统声明更新。它们不替换生产的输入转换、压缩和历史恢复逻辑。模型目录、普通回复及压缩 SSE 是内存响应，不启动 HTTP server；synthetic checkpoint 仅用于验证客户端转发，不能用于线上续聊。驱动不读取真实凭据，拒绝未预期的 fetch 地址，并强制普通请求使用 SSE。

## Evidence

记录 feature ID、入口、命令/按键、前后状态、实际文件或会话副作用。helper 在 `.tmp/test-results/verify-<case>-<id>/` 保留 `summary.json`、`output.log` 和可用的 `artifacts/`；命令 PTY 另有 `journey.json`、`terminal.ansi` 与隔离文件副本。共享说明定义证据边界。一次 smoke 不能作为整个行为索引通过。

专用压缩 PTY 将证据写到指定目录：`summary.json` 记录命令、动作、PID 和清理状态，`screens.json` / `terminal.ansi` 保存画面，`state/events.jsonl` 保存目录查询及实际请求 payload，`state/sessions` 保存真实 session。每个 Pi 进程另有 `doctor-start-*.json`。这些文件含夹具长文本，不含真实凭据。

## Cleanup

自动 helper 在成功、失败及可处理取消后清理所启动进程和 scratch，最后应为 `cleanup: removed`。专用 PTY 还要求 `passed: true`、`stopped` 全为 true，证据副本存在，验证锁已释放。失败时先关闭 PTY 再回收进程，避免等待未排空的终端输出。交互路径发送 `/quit`，等待外层 helper 返回，再检查 evidence 仍存在。清理未核实或缺少前置条件时不得记为通过；按 [共享清理规则](../verify-pi-ext/README.md#cleanup) 处理。

## Helpers

配置命令运行共享 `metadata` 和 `metadata-project` 后，将各自返回的 evidence 路径传给本 skill 的通知检查器：

```bash
pnpm exec node .cursor/skills/verify-pi-codex-compact/scripts/check-metadata.mjs <evidence-directory>
```

它检查当前通知中的完整版本、来源及 Usage 尾行，避免旧通知的 Usage 被误当成当前绘制完成。`compact-pty.py`、`check-metadata.mjs` 为可执行入口，[transport.mjs](scripts/transport.mjs) 和 [seed-legacy.mjs](scripts/seed-legacy.mjs) 仅由专用 PTY 加载。场景参数、断言范围和未覆盖分支见 [场景配方](journeys.md)。SDK 补充入口仍是共享 `run compact`，源码与其他 case 见 [共享 helper](../verify-pi-ext/scripts/verify.mjs)。后续使用 `/maintain-verification-skill` 同步行为索引与实现。
