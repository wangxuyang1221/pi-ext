# Shared terminal startup repair

## Finding and change

独立 Termius 补验提交 `c0b4b6c0cc3684a721029e141f975631bed87fd1` 发现，普通模式共享 `tui` 入口在 Pi header 前显示字面的 CSI/OSC 终端回复。主代理以 Astra high 按 ub-mode 修复共享驱动；产品 extension、宿主 patches、依赖锁和全局 Pi 未改。

`.cursor/skills/verify-pi-ext/scripts/commands.py` 原先等待扩展 ready 后才对外层终端设置 raw mode。真实 Pi 的能力查询早于 ready，因此外层终端会回显收到的回复；输入也要等 ready 后才转发。新增外层 PTY 回归在修复前两项均失败于启动时 ECHO 仍开启。

现在启动 Pi 前设置 raw mode，等待 ready 时也转发真实输入及终端回复。交互模式不再额外合成光标回复；无物理终端的自动旅程保留合成回复。正常退出、启动中断和 ready 失败都在排空子 PTY 后恢复原终端设置。输出转发与进程退出检查分开，EOF 明确报错，清理期间不再读取用户输入。

## Verification

- `test_commands_terminal.py` 的八项测试通过，含真实 Pi 普通/全屏各三个启动场景，以及实际 pipe/PTY 的转发、无输入轮询、EOF、光标回复、I/O 异常和退出后停止转发。测试从仓库根目录执行；`TERMINAL_TEST_RECORD` 可指定追加逐进程 JSONL 证据的位置。
- 共享 `verify.mjs run metadata` 通过，证据 `.tmp/test-results/verify-metadata-RRLu94/`，正常退出且 scratch 清理。它补证非交互旅程，不代表全部扩展重验。
- `pnpm_config_verify_deps_before_run=false pnpm run check` 退出 0：205 文件、2958 测试；source/dist 各八个入口加载无错误。
- 新增或修改函数 `forward_input`、`relay_output`、`pump` 行覆盖均为 100%，CRAP 分别为 3、7、5。dryer 没有相似度 ≥0.8 的候选。九个选定变异点全部 killed。

首次变异运行使用全部真实 Pi 测试，部分故障变异反复等待 25 秒超时。主代理停止这次低效运行并核对自己的进程，保留日志；随后针对转发协议运行五项实际 pipe/PTY 测试，九个变异全部检出。真实 Pi 的六个生命周期场景另外完整通过。首次 CRAP 未发现放在 `.tmp` 的 LCOV，零覆盖结果无效；将真实报告输出到工具支持的 `target/coverage/shared-terminal-66/lcov.info` 后重算，未改覆盖数据。

原始日志、覆盖率、质量结果、逐进程清理和来源哈希见 [索引](shared-terminal-startup-repair.json)，原始根为 `.tmp/shared-terminal-66/`。本轮未操作真实 Termius；修复后的实机启动画面须由新 Sol high 任务独立复验，不能由外层 PTY 模拟替代。

## Previous evidence review

主代理重新核对上一轮提交的 45 份来源及 322 份 artifact 哈希，全部一致；动态选区实际粘贴为 18 字节，与 expected 完全相同。37 个记录 PID 均已退出、无监听。接受补丁全屏、40 列、light 主题下这一真实复制子证据，完整 ID 计数仍为 54 passed、0 failed、4 unverified。

剩余物理组合、默认搜索键、图片像素、远程 provider 和精确 Write/Edit await 取消继续按独立报告保留缺口。共享驱动的启动回显修复不提前视为实机验收通过。#66、Map、Spec 保持开放。
