# Goal Footer Prototype

## Question

分钟级 goal footer 是否足够清楚，同时避免为了跳秒而持续触发 TUI 渲染？通过真实 Pi 界面观察跨分钟更新、暂停、完成和详情里的精确耗时。

## Run

在仓库根目录的交互式终端执行：

```sh
pnpm run prototype:goal-footer
```

依赖仓库已安装的 Node.js 22.19+、pnpm 11.9.0 和 Pi 0.84.3，不使用全局 Pi。

| Command | Behavior |
| --- | --- |
| `/goal` | 打开详情，读取精确到秒的当前快照。详情没有秒级计时器。 |
| `/goal boundary` | 设置为 12m 58s，两秒后从 12m 变成 13m。 |
| `/goal pause` | 暂停计时，立即更新 footer 并清除计时器。 |
| `/goal resume` | 从冻结的耗时恢复。 |
| `/goal complete` | 标记 fixture 完成，冻结耗时并清除计时器。 |
| `/goal fresh` | 从零开始，显示 `<1m`。 |
| `/goal hour` | 设置为 59m 58s，两秒后显示 1h 00m。 |
| `/goal reset` | 恢复初始的 12m 55s。 |
| `/quit` | 使用 Pi 内置命令退出，清理本次隔离目录。 |

详情内支持 `p`、`r`、`c`、`b` 操作和 `Esc` 关闭。操作只影响内存 fixture，完成后也可恢复，便于反复比较，不代表正式 goal 的状态转换规则。

可增加真实渲染的历史消息，或使用 Pi fullscreen 模式：

```sh
pnpm run prototype:goal-footer --history 1000
pnpm run prototype:goal-footer --fullscreen
```

`--history` 表示增加的用户/助手消息对数，范围为 0 到 5000。它用来手动观察长会话渲染，不能模拟所有工具输出、图片和流式消息负载。

## Landing Map

- **Target**: Pi footer 的 goal 区域，位于现有 codex-ui 模型、上下文和分支信息下方。
- **Context**: 真实 Pi CLI、原生会话恢复和对话渲染、正式 `codex-ui` 的 header、editor、Markdown 转换与 `CodexFooter`。
- **Contract**: 原型通过 `ctx.ui.setFooter()` 挂载包装组件，通过 `tui.requestRender()` 请求刷新；复用生产 footer，不改生产源文件。计时数据来自内存 fixture，`session_shutdown` 和 footer dispose 清理定时器。

## Design

目标占一行，状态、分钟耗时和 token 统计占下一行。状态使用主题色，其余统计弱化；文本按终端显示宽度截断，不让中文长目标挤出布局。

计时器直接预约下一个累计耗时的分钟边界，不是每秒检查是否跨分钟。回调根据单调时钟重新计算耗时，延迟执行时不逐 tick 累加。暂停和完成立即刷新，没有周期性唤醒。详情的精确耗时在打开时读取，之后保持快照。

生产 footer 的缓存不包含原型目标时间；原型行按宽度、主题、状态和显示分钟缓存。没有动画、进度条或任务完成百分比。

## Isolation

- 只在 `prototypes/goal-footer-prototype/.tmp/run-*` 中创建配置、HOME、临时目录、workspace 和会话。正常退出后删除本次 run 目录。
- 不加载用户配置、凭证、skills、上下文文件或正式 goal extension；只显式加载原型扩展和仓库主题。
- `codex-ui` 源文件继续原样运行，只把最后挂载的 footer 替换成包装组件。
- 目标、token 数、初始耗时和对话内容均为 fixture。模型名称来自选定的模型元数据，但没有模型执行。
- 输入事件被消费，用户 shell 命令被拦截，自动压缩禁用；provider 请求钩子和预加载的 fetch 拒绝函数阻止误触模型网络请求。这里不是针对恶意扩展的系统级网络沙箱。
- 不启动服务或监听端口。强制 SIGKILL 无法执行清理，残留 run 目录位于忽略的 `.tmp/` 下。

## Verification

```sh
pnpm run prototype:goal-footer:check
pnpm run check
```

原型检查需要 `codex-py312` conda 环境内的 `pyte`，正常运行原型不需要 Python。

已通过的原型验证：

- 类型检查和 4 个单元测试，覆盖分钟边界调度、暂停/恢复/完成、延迟回调无累计漂移、dispose、小时格式与窄终端中文宽度。
- 真实 Pi 0.84.3 regular-mode PTY smoke，覆盖入口、fixture、详情、分钟与小时切换、暂停/完成、40 列宽度、输入拦截和正常退出。
- 同一 PTY smoke 额外在 `--history 500` 和 `--fullscreen` 两种启动条件下分别通过。
- 跨分钟更新后，1.4 秒空闲观察窗口内终端输出为 0 字节。最近一次测试结果和终端文本快照保存在 `.tmp/last-smoke.json`。

这不是 CPU 基准测试。没有验证真实长会话的每次渲染成本、终端模拟器 CPU、流式输出或真实工具等待；没有据此得出“无性能开销”的结论。

仓库总检查没有全部通过：类型检查通过，1122 个测试通过、2 个跳过，但现有 `extensions/mcp/__tests__/status-ui-prototype.test.ts` 引用了缺失的 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`，导致测试阶段失败。单独运行构建通过；单独运行发布校验又因缺少 `docs/goal-descendant-acceptance.md` 失败。这两个缺项不属于本次原型，未修改。

## Transfer

可以复用分钟格式、宽度测试和此次视觉决定。原型的 clock、fixture 状态转换与隔离 launcher 是试验代码，不应直接接入正式 goal。

正式实现应从 `GoalLease` 获取与已入账耗时一致的计时基准，保留现有 active、budget wrap-up、暂停和恢复语义，避免重复累计或显示倒退；不要为了刷新 footer 而调用持久化 mutation。正式挂载还需处理与其他 footer 扩展的兼容。
