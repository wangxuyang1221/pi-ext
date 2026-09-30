# Pi 0.99.1 main check validation

## Result

用户授权修复阻断主检查的 Write 预期和 wrapper 清理问题。两项已修复，`pnpm run check` 连续三次完整通过：`2644 passed / 13 skipped`，`176` 个测试文件通过、`4` 个条件测试文件跳过。类型检查、构建、包校验及源码/dist 各八个入口加载检查均通过。`pnpm pack --dry-run` 另行通过。

只修改测试及 `scripts/test-process.mjs`，没有改变 Write 或其他扩展的生产实现。tmux 空锁按约定未处理，Goal SDK 的队列兼容性差异仍保留。主检查通过不代表这些独立事项已解决，也不把条件跳过计为通过。

本机为 macOS，Node `v22.22.2`、pnpm `11.9.0`、Pi 四个相关包均为 `0.99.1`。未运行实际 Linux/Windows CI。证据根目录为 `.scratch/pi-0.99.1-green-check/`，不纳入发布包。

## Write contract

`extensions/codex-ui/__tests__/write-host-validation.test.ts` 改为验证实际宿主契约，而不是强加生产代码从未承诺的严格拒绝：

- 缺失 content、对象、数组仍须被真实宿主拒绝，执行器不进入，已有文件字节不变，新文件不存在。
- `null` 与数字 `123` 分别转为字符串 `"null"`、`"123"`。同时验证执行器收到的两个值、已有文件覆盖后的确切内容及新文件内容。
- 普通字符串含末尾换行的写入仍精确验收，不在文件断言中裁剪内容。
- 六个场景仍通过真实工具注册、宿主校验、执行、tool result 和 ToolExecutionComponent 渲染。确认成功结果的真实 `Edited`/`Added` 元数据与内容；原始非字符串参数仍使用宿主 fallback 调用标题，不误要求自定义标题。

没有伪造成功结果或手工设置 `isError`。`write-red.log` 记录原两个错误拒绝预期；修正过程中发现原始非字符串参数走 fallback 标题，将渲染断言按已确认路径调整后，Write 六个场景与相邻 43 个 tools 测试全部通过，见 `write-green-2.log`。

## Wrapper failure

最初多次完整套件和二十次单独取消都通过，说明“单独通过”不足以排除失败。将八个真实取消用例并行运行后，四个复现失败，见 `wrapper-load-{1,2,3,5}.log`。这八次每次仍独立创建 wrapper → pnpm → Vitest → listener，使用各自临时目录及受控对照进程。

新增退出码与 stderr 诊断捕获到共同路径：

```text
Error: kill EPERM
    at groupExists (scripts/test-process.mjs)
    at waitForGroup
    at stopGroup
```

错误发生在 SIGTERM 后对 `kill(-pgid, 0)` 的退出探测中。原实现立即抛出异常，按失败策略保留 HOME，并以 1 退出。先前断言只检查“非零退出”，把这种清理失败与正常取消的 143 混在一起，直到目录断言才显示问题。

Apple 的 [kill(2) 文档](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html) 区分两种结果：`EPERM` 表示没有发送权限，`ESRCH` 才表示没有匹配的进程或进程组。信号 0 仅检查，不发送信号。本轮已观测到退出探测期间的 EPERM，但没有定位到特定内核退出或 zombie 交错，不把这一细节当作已证实根因。

### Correction

只调整 `groupExists()`：EPERM 视为尚不能确认组已消失，继续原有有界等待；ESRCH 才返回不存在。不会把 EPERM 当成清理成功。

- 原来的 2 秒优雅退出窗口、3 秒强制确认窗口和轮询间隔不变。
- 发送 SIGTERM/SIGKILL 时真正遇到权限错误仍失败，不吞掉信号发送错误。
- 持续无法确认组消失时仍超时失败并保留目录。
- Unix 真实取消回归现在要求正确退出码 143，失败信息包含完整 wrapper 输出；worker、监听端口、HOME 及无关对照进程的断言全部保留。

### Regression evidence

增加两项确定性回归，仅在信号 0 探测边界注入操作系统错误，命令仍由真实子进程执行：

1. 连续三次 EPERM 后收到真实 ESRCH：收到不存在证明之前目录始终保留，随后成功清理。
2. 始终 EPERM：在原有清理期限内失败，目录保留。

新回归在旧实现上失败，见 `probe-red.log`。修复后 wrapper 十个用例通过，见 `wrapper-green.log`。再次并行运行八个真实取消用例，全部通过，见 `wrapper-load-green-{1..8}.log`。确定性回归和真实进程压力复验相互补充，不用 mock 代替真实取消证明。

## Validation commands

```bash
pnpm test extensions/codex-ui/__tests__/write-host-validation.test.ts extensions/codex-ui/__tests__/tools.test.ts
pnpm test extensions/codex-compact/__tests__/test-wrapper.test.ts
pnpm run check
pnpm pack --dry-run
```

主检查三次完整日志为 `check-green-{1,2,3}.log`，每次均为 `2644 passed / 13 skipped`。打包日志为 `pack.log`。所有失败复现日志保留，没有用后续通过覆盖早期记录。

## Limits and cleanup

Windows Job Object 代码未改，Linux/Windows 尚未实跑；不宣称远端 CI 已通过。PTY 新会话、私有 tmux server 的强杀清理边界仍不在普通进程组保证内。

测试监督逻辑在失败和成功时都关闭受控 listener、worker 及对照进程；端口关闭断言保留。所有本轮并行启动的外层命令均已 wait 完成。结束时未发现 wrapper/worker 相关临时目录或存活命令，见 `cleanup.json`；runner 语法检查及 `git diff --check` 通过。未使用真实凭据或付费模型，未提交、推送或部署。
