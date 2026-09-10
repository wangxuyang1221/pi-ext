# Goal storage acceptance

## Scope

实施关 [#4](https://github.com/wangxuyang1221/adventure/issues/4)，依据 [spec #3](https://github.com/wangxuyang1221/adventure/issues/3) 的持久化与恢复、持久化变更、首次回复前恢复，以及 V3 基础存储验收。代码基准 `f4a7e44b43070748f082523b7377b165c9471e9e`，实现为该基准上的未提交工作区改动。

## Implementation

- `extensions/goal/src/storage.ts` 保存权威 JSON、revision、generation、tombstone 和归属。记录以最初 owner session ID 的 SHA-256 命名，接管后不改 record ID。
- `extensions/goal/src/lock.ts` 持有单写者锁。唯一 owner 文件名避免两个旧锁回收者误删新锁；仅同主机 PID 明确不存在时自动回收，不以时间判断。
- `extensions/goal/src/index.ts` 注册 `/goal`、`/goal-recover`，绑定时重读权威文件，镜像失败下次安全检查点重试。恢复新会话使用公开 setup、withSession 和 reload，旧 context 不发请求。
- 权威修改顺序为同目录临时文件、文件 fsync、关闭、rename、POSIX 目录 fsync，再确认和追加镜像。rename 后目录同步失败属于提交结果不确定，不报告成功；再次操作须重读 revision。Windows 不执行目录 fsync，未在本机验证。
- `catalog.lock` 只包围记录查找及归属变更，记录锁跨命令保持。遇到并行目录事务会明确失败，不轮询等待。

## Reproduction

Node.js `v22.22.2`，pnpm `11.9.0`，macOS。本机开发依赖 Pi `0.84.3`，宿主 Pi `0.85.1`。Context7 文档没有固定版本索引，接口另以两个已安装版本的官方声明、运行时代码和实测交叉核验。

```bash
pnpm exec vitest run extensions/goal/__tests__
pnpm exec tsc -p extensions/goal/tsconfig.json
node extensions/goal/__tests__/runtime.mjs
node extensions/goal/__tests__/processes.mjs
# 将路径替换为要核验版本的已安装 pi-coding-agent package 根目录。
node extensions/goal/__tests__/runtime.mjs /absolute/path/to/pi-coding-agent
node extensions/goal/__tests__/processes.mjs /absolute/path/to/pi-coding-agent
pnpm run check
```

所有新测试临时目录均以 `.goal-*-test-` 或 `.goal-test-` 开头并位于仓库内，finally/afterEach 清理。SDK 和进程脚本在导入 SDK 前将 agent directory 指向该临时目录，无需账号、网络、真实模型或用户全局配置。进程实验用 SIGKILL 结束本任务 child，并等待 exit。没有启动监听服务。

## Results

已运行的两版本 SDK 实验各 6 项通过，模型请求 `0`，扩展错误 `[]`：

1. 首回复前创建成功，Pi 会话文件仍不存在，权威文件可重读。
2. 重启后取消选择、取消确认不改变记录；确认恢复只接管原 record，新 context 能读取目标。
3. 原会话文件存在时通过真实 AgentSessionRuntime 切换并恢复。
4. 镜像失败后权威状态不回滚；下个摘要检查点修复镜像。
5. 临时文件 fsync 后、rename 前注入异常，旧权威不变，不报告成功。
6. clear 后 reload 和重启保持 tombstone，不恢复旧镜像。

两版本进程实验各 4 项通过，所有 child 已停止：

1. 首回复前提交后 SIGKILL，重启可发现唯一记录。
2. 新 SessionManager 创建后、归属提交前 SIGKILL，原 record 不变。
3. 两个独立进程同时接管同一 revision，恰好一个成功，仍只有一条 record。
4. 获胜进程 SIGKILL 后重新打开，目标及统计不变。

Vitest 目标测试目前 9 项通过，覆盖上述命令及存储边界，另包含 stale revision/generation 拒绝、记录损坏或未知版本拒绝、运行中权威被删除不从内存重建、替换取消及 whole-argument 控制词解析。TDD 中创建、单写者与 stale、接管、写失败、删除权威、命令注册及恢复均先观察失败，再实现并通过；附加已满足行为作为回归保护。

完整仓库 `pnpm run check` 通过：66 个测试文件通过、1 个既有 subagent integration 文件跳过，812 个测试通过、1 个跳过；全部扩展类型检查和构建通过，发布边界检查确认 7 个编译入口、1 个主题、10 个 MCP 模块。另使用临时 tsconfig 将 Pi 类型入口定向到已安装 `0.85.1/dist/index.d.ts`，goal 类型检查通过，临时配置已删除。最后按最终构建产物重跑两版本全部 SDK 与进程实验，结果不变，`git diff --check` 通过。

## Not verified

- 未运行真实终端交互操作，SDK 使用 Pi 的真实命令、SessionManager、AgentSessionRuntime 和受控 UI 回答，不将其当作人工 TUI 验收。
- 未模拟 OS 断电、文件系统崩溃、跨机器共享目录、Windows 目录持久性；不承诺任意断电零丢失。
- 未验证锁目录刚创建、owner 尚未完整落盘时的 SIGKILL。此时保守报告身份不明，需用户停止写入者并人工核验修复，不自动夺锁。
- 自动执行、模型工具、计费、预算、fork/clone 完整隔离与显式继承、附件及 codex-ui/subagent 集成属于后续关卡。

## References

- [Pi extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，Context7 返回的主线文档只作导航，最终接口依据已安装 `0.84.3` 与 `0.85.1` 的官方 `dist/core/agent-session-runtime.js` 和 `dist/core/extensions/types.d.ts`。
- [Upstream reference and license boundary](../extensions/goal/UPSTREAM.md)。
