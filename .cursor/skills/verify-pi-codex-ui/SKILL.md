---
name: verify-pi-codex-ui
description: "Verify codex-ui on stock Pi in regular and fullscreen TUI, print and RPC. Use for changes to the composer, theme, Markdown, Thinking, Working, tools, codemode inspector or execution settings."
---

# Verify Pi codex-ui

从[行为索引](features/README.md)选择受影响的入口。完整验收覆盖原版 Pi 的普通与全屏 TUI、print 和 RPC，各入口使用独立配置与会话。

## Launch

在仓库根目录安装锁定的依赖并构建一次。构建会重写 dist，须在启动任何验收进程前完成。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
```

## Doctor

```bash
pnpm exec node .cursor/skills/verify-pi-codex-ui/scripts/verify.mjs doctor
```

核对 Node、pnpm、Pi 版本、构建产物、Conda 环境 codex-py312 和 pyte。若返回 `lockPresent: true`，读取 `.tmp/verify-pi-codex-ui.lock` 核对正在运行的驱动 PID，等待它退出。失败后重新 doctor，检查本次错误和清理结果，再从新进程重试。CLI 与 headless 驱动会在每次启动前将 doctor 输出保存到证据目录。

## Drive

在 checkout 根目录运行。以下四个 case 分别覆盖 codemode 普通/全屏、流式 Thinking、工具状态。驱动使用真实宿主与隔离文件，等待资源加载或画面就绪。

```bash
pnpm exec node .cursor/skills/verify-pi-codex-ui/scripts/verify.mjs run codex-ui
pnpm exec node .cursor/skills/verify-pi-codex-ui/scripts/verify.mjs run codex-ui-fullscreen
pnpm exec node .cursor/skills/verify-pi-codex-ui/scripts/verify.mjs run thinking
pnpm exec node .cursor/skills/verify-pi-codex-ui/scripts/verify.mjs run tool-status
```

- [CLI 和 headless 旅程](scripts/README.md#run)验证真实编辑、配置拒绝与恢复、会话切换、模型上下文、缓存压力，以及 print/RPC 的文件与图片副作用。
- [Pi compatibility 旅程](scripts/README.md#pi-compatibility)验证 Pi 1.6 起支持的非视觉模型图片提示、diff 文字色、全屏滚动条配色与 `/copy` 回退规则。
- [Working 旅程](features/working.md)通过普通和全屏 CLI 驱动真实工具、取消、输入等待、重试及自动压缩，核对 spinner 和 footer 速率。
- [JSON recipe](RECIPES.md)提供 F3 展开、原生 codemode 工具、文件写入和 inspector 标签页的独立旅程。交互补验使用 `pnpm exec node .cursor/skills/verify-pi-codex-ui/scripts/verify.mjs tui codex-ui`，退出输入 `/quit`。

## Evidence

记录每个入口的 case、命令、按键、动作前后画面，以及文件或 session 的变化。动态 UI 在结束事件后另等一帧，核对 spinner、速率或标题是否复位。物理终端、剪贴板和文件写入期间按 Esc 的证明边界见 [CLI 驱动说明](scripts/README.md)。

`verify.mjs` 将 stdout/stderr、summary 和归档文件存入 `.tmp/test-results/verify-<case>-<id>/`。交互和 recipe 还保存 `terminal.ansi` 与 `journey.json`。核对 recipe 各动作的断言和截图后再给出结论。`cli.py` 和 `headless.py` 输出各自的 evidence 路径。按实际覆盖报告 passed、failed 或 unverified，并写出缺少的前置条件。

## Cleanup

核对 `summary.json` 的 `cleanup: removed`、启动的进程组已退出、scratch 已删除且证据仍在。其他驱动使用[各自的清理字段](scripts/README.md#evidence-and-cleanup)。中断或失败时用本次 summary/owners 的 PID 和命令核对进程身份，回收本次进程；进程归属或归档尚未核实时保留 scratch 和锁。

## Helpers

运行 harness 自身回归：

```bash
pnpm exec node --test .cursor/skills/verify-pi-codex-ui/scripts/runtime-support.test.mjs
conda run -n codex-py312 python -m unittest discover -s .cursor/skills/verify-pi-codex-ui/scripts -p 'test_*.py'
conda run -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/interrupt-regression.py
```

需要为单个进程保存只读 preflight 时，先创建本次 evidence 目录，再运行 `conda run -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/health.py "$PWD" <evidence-dir> <unique-label>`。
