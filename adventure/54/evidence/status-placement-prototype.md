# Status placement prototype

## Scope and status

后续状态：用户已选择 B「footer 右侧」，并要求替换 Working 动画。第一轮记录保留如下；新的动画原型与审阅状态见 [第二轮证据](old-codex-working-prototype.md)。

用户已同意在 Planning #59 制作真实 TUI 原型，以比较速率与 Working 同行或放在 footer。范围为 Working 动画、模拟速率、`-- t/s` 和窄窗口，不调用模型，不改正式功能。原型已可运行，最终布局等待用户体验决定；#59 保持 open。

## Local entry

本 worktree 内入口为 `adventure/54/prototypes/status-placement/README.md`。在 worktree 根目录运行：

```bash
node adventure/54/prototypes/status-placement/launch.mjs
node adventure/54/prototypes/status-placement/launch.mjs fullscreen
```

Tab 切换布局，F3 切换自动模拟/102/无数据/1008，F4 暂停，F10 或 Ctrl+C 退出。可以编辑输入框，Enter 不提交。所有配置和会话在原型目录的临时子目录中创建并在退出时删除。

仓库 `.gitignore` 及 `scripts/check-commit.mjs` 均排除 `prototypes/`。原型本体、README、smoke 驱动和原始终端快照只在本 worktree 保留，没有强制加入 Git 或绕过门禁；本报告为远端可访问的摘要。清理 worktree 前须明确处置此本地原型。

## Real integration and approximations

启动真实固定版本 Pi 1.4.0 CLI，导入生产 codex-ui 初始化、CodexFooter，使用真实聊天、输入框和普通/全屏渲染路径。通过 `setWidget` 与 `setFooter` 替换试验区域，不改 `extensions/`、`patches/` 或全局 Pi。

SessionManager 预置聊天内容；模拟数据包括 Working 状态、速率、时钟、footer 目录/分支/上下文余量。A 在 Working 后保留固定宽度数字，B 在 footer 右端保留固定宽度，再交给现有 footer 规则压缩其余信息。40 列的实际画面中，A 仍可显示分支，B 为速率让出了分支位置。这是候选布局的可观察差异，尚非用户决定。

模型凭据不继承；关闭自动资源发现、工具和模型提交。离线 provider 只提供模型元数据，实际调用计数在退出时核验。原型仍调用宿主现有 `requestRender`，不含局部刷新补丁。

## Verification

Node v22.22.2，pnpm 11.9.0，Python 3.12.13，Pi 四个包版本均为 1.4.0。doctor 确认当前为独立 worktree 和独立依赖，无验证锁；subagent socket 路径过长与本次不启动 subagent 的 PTY 原型无关。

执行：

```bash
conda run --no-capture-output -n codex-py312 python adventure/54/prototypes/status-placement/smoke.py
```

2026-10-29，普通/全屏模式各 17 项，共 34 项断言通过。真实 PTY 驱动覆盖：

- 从 launcher 启动后，预置聊天由真实宿主显示，Working 帧自动变化。
- Tab 将 `≈102 t/s` 在 Working 行和原 footer 行之间移动，旧位置无残留。
- F4 暂停；100、40、32 列缩放；40 列两布局均可显示完整数字；32 列 A 可显示四位数字。
- `-- t/s` 保留位置且旧数字消失；四位 `≈1008 t/s` 不溢出保留槽。
- 输入可编辑，Enter 不提交；两种模式均正常退出，实际 provider 调用数为 0。
- 两个进程组已停止，所有本次 `.run-*` 已删除；没有监听服务。

本地原始证据位于原型目录的 `verification-1793237894228863000/`，包含两个 ANSI 记录与 `results.json` 的按场景字符/颜色快照。`comparison.html` 从真实 40 列快照生成，静态对比已检查，不能替代动画体验。

`pnpm_config_verify_deps_before_run=false pnpm run check` 退出码 0，196 个测试文件、2913 个测试通过；构建、类型、发布包与 source/dist 宿主加载通过。日志为本 worktree 的 `.tmp/status-placement-check.log`。该检查不自动涵盖被忽略的原型，原型行为证据来自上述独立 PTY 驱动。

## Boundaries

本次不判断 CPU 收益，不验证真实 token 统计或 Working 的结束、取消、工具等待、重试、压缩、低功耗行为；这些仍由 #59 的后续决定和正式实施承担。32 列以下及长时间计时后的极窄布局没有覆盖。原型控制说明额外占用两行，不属于正式设计。

布局确认后复用结论，正式实现重新处理生命周期、数据采集和局部刷新接口。不得将此模拟计时器直接视作已完成的产品功能。
