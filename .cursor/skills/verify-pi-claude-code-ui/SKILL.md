---
name: verify-pi-claude-code-ui
description: "Verify standalone installation, session lifecycle, composer, Working, messages and tools for claude-code-ui on stock Pi in regular and fullscreen TUI."
---

# Verify Pi Claude Code UI

## Launch

在仓库根目录构建。终端驱动使用 Conda 环境 `codex-py312` 中的 `pyte==0.8.2`。安装和终端旅程各自使用隔离的 Pi 配置，PATH 需提供 `git`、`rg` 和 `fd`（或 `fdfind`）。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:claude-code-ui
```

## Doctor

```bash
conda run -n codex-py312 python test-support/terminal/package_health.py extensions/claude-code-ui
```

核对宿主版本与本包 manifest 的扩展和主题入口。驱动在安装及每次启动前保存 preflight。失败时先检查证据与清理，再从干净配置重试。

## Drive

```bash
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-claude-code-ui/scripts/cli.py regular
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-claude-code-ui/scripts/cli.py fullscreen
```

每种模式都将 Claude Code UI 的发布 tarball 解包到隔离目录，再通过原生 `pi install` 注册该目录。安装清单、欢迎卡、composer 与可发现主题共同证明加载了目标插件。原生按键和斜杠命令驱动 [行为索引](features/README.md)。模型响应来自离线夹具，文件、Bash 和会话由真实 Pi 执行。

## Evidence and cleanup

输出目录在 `.tmp/test-results/claude-code-ui-cli-<mode>-<id>/`。核对 `pack.stdout`、`pack.stderr`、`install.stdout`、`install.stderr`、`journey.json` 内的安装命令与断言、各次启动的 `terminal-*.ansi`、`events.json` 与归档文件。核对每个 Pi 进程的 `stopped`、`groupStopped` 和本次 `scratchRemoved`。报告普通及全屏各自结果，并列出未验证的前置条件。
