# Goal tool UI prototype validation

## Result

本报告记录原型交付时的技术检查，支持在真实 Pi TUI 中比较两种摘要，不证明正式 Goal 集成已完成。

后续审阅：用户已选择 summary 并要求收敛，[Planning #42](https://github.com/wangxuyang1221/pi-ext/issues/42) 已通关，有效要求移交 [Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40)。入口：[prototype README](../prototypes/goal-tool-ui/README.md)。

## Environment and boundaries

- Node.js `v22.22.2`，pnpm `11.9.0`，Pi coding-agent/TUI/AI `0.87.0`。
- 已在冒险 worktree 执行 `pnpm install --frozen-lockfile --ignore-scripts`。
- Context7 的 SDK 资料用于定位 API，具体启动方式再核对本地 0.87.0 的 session-runtime 示例和仓库现有 PTY 原型。
- 原型复用当前 worktree 的 codex-ui 与 Goal tools/upstream 源码，仅转译至隔离临时目录，不补丁或覆盖生产源码。
- 模型与 Goal 持久化访问使用 fixture；Bash、Write、Edit 真实执行固定操作，仅触及隔离 workspace。
- `git diff --exit-code -- extensions package.json pnpm-lock.yaml` 返回 0。产品源码、依赖声明与锁文件无改动。

## Red and green

四轮组件测试通过真实 `ToolExecutionComponent` 暴露差距后修复：

1. 默认 Goal 展示仍是 JSON，缺少操作标题与摘要，测试失败；添加原型 renderer 后通过，execute、schema 和返回对象保持不变。
2. 切到 minimal 仍显示统计行，测试失败；增加动态密度与展开详情后通过。
3. 失败结果错误显示 Updated goal / No goal，测试失败；区分错误、空结果、运行中结果，并处理长文本与终端字符后通过。
4. 首次 PTY 检查切换密度时，遍历重绘回调集合触发重新注册，导致无限增长和进程内存耗尽。补充回归测试复现 24 个回调而非 1 个；每行仅注册一次，并遍历固定快照后通过。再次完成两种真实 TUI 检查，未再复现。

最终命令：

```bash
node --test adventure/39/prototypes/goal-tool-ui/renderers.test.mjs
```

结果：4/4 通过，见 [unit.log](prototype/unit.log)。组件检查还覆盖 1/4/12/40/80/120 列宽、中文/emoji、终端控制序列清理、结果快照不被展示代码修改。

## Real TUI smoke

```bash
conda run --no-capture-output -n codex-py312 python adventure/39/prototypes/goal-tool-ui/smoke.py
conda run --no-capture-output -n codex-py312 python adventure/39/prototypes/goal-tool-ui/smoke.py --fullscreen
```

两者均通过。终端文字快照与执行信息：[regular.json](prototype/regular.json)、[fullscreen.json](prototype/fullscreen.json)。颜色由 pyte 屏幕属性断言，不从纯文本快照推断。

实际覆盖：

- 固定 Bash/create_goal/Write/get_goal/Edit/update_goal 经 SDK 调用与原渲染同屏显示。
- 三个 Goal 工具默认显示摘要而非原始 JSON；历史行可直接切换 summary/minimal，不重新执行。
- 原生 Ctrl+O 展开/收起，可查看精确 tokens、剩余预算和会话信息。
- 长目标收起截断、展开出现末尾标记；40/80/120 列窗口重排。
- 工具失败为红色，显示原因首行，展开完整错误；无 Goal 的读取为成功。
- 暂停/阻塞目标的成功更新保持绿色，目标状态另用文字表示。
- 无预算和不完整 usage 的显示；不完整 usage 保留警告。
- 运行中的黄色标记，完成后绿色；浅色主题与 codex-pi 之间重新绘制。
- 运行中 `/quit`，宿主与 launcher 正常退出且删除隔离目录。

测试脚本曾在主题重绘未完成时就断言或截图，已改为等待有效标记再稳定屏幕；没有降低颜色或结果断言。

## Repository check

```bash
pnpm run check
```

已通过类型检查、测试、构建和发布包检查，见 [check.log](prototype/check.log)。

- Test files：172 passed，4 skipped。
- Tests：2599 passed，13 skipped。
- 发布包校验：8 个编译后的扩展入口、1 个主题入口及 MCP 模块边界检查通过。

既有 skipped 项未运行，原型测试另行执行，仓库 check 不替代上面的组件与 PTY 证据。

## Cleanup

- 最后两轮 launcher PID 为 55129、55485，均已被 waitpid 回收，退出码 0。
- `pgrep` 未找到本原型的 demo/runtime Node 进程；`lsof` 未发现上述任务进程持有监听端口。
- `.tmp/goal-tool-ui-*` 隔离目录已清空；本原型不启动网络服务，运行时也断言未尝试 fetch。
- 保留的证据只有本目录中的日志与终端快照；没有需要用户手动关闭的后台服务。

## Limits and next decision

原型交付时需等待用户选择信息密度，该决定后来已完成，用户选择 summary。当前等待实施切片审核；以 Spec 保存的收敛方案为准，不将原型验证结论扩大为生产验收结论。

不覆盖正式 Goal 存储、调度、恢复和计量正确性，不证明所有历史数据或 reload/重启路径兼容，也不代替生产性能验证。最终设计确认后，再形成实施切片与相应验收范围。
