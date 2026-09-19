# Subagent runtime reliability

## Scope

本轮修复审查问题 1–6，保留 tmux TUI、Pi 原生 JSONL、root → direct child 和 at-least-once 投递。goal 用量归属时序与 renderer 文案不在本轮范围。

状态协议升级为 v3，不能与 v2 写入者混用。升级前必须用旧扩展关闭 child，停止旧 root，再执行下文的离线转换。不要对仍管理 child 的旧 Pi 直接 `/reload`。

后续锁回收修订仍使用 v3，无需再次转换状态文件，但所有写入者都必须更新。部署时先关闭 child、重启 root，不混用修复前后的锁回收实现。

## Identity and exit evidence

新建 pane 登记随机 `processInstanceId`，同时记录 tmux server PID、启动时间、socket 路径、pane ID 与 pane PID。child 登记时核验当前 Pi PID 等于 pane PID。因此自定义 Pi wrapper 必须使用 `exec` 启动 Pi，不能另起子进程后自己等待。

探测分别返回身份、进程、终端资源和投递就绪状态。server 身份、pane 标记与 PID 均匹配时，session 改名或 pane 移动不改变进程身份；未知身份、替换 PID、无法连接或查询失败不能证明死亡。

只有进程退出与受管终端资源消失均得到确认，关闭才完成。`remain-on-exit` 保留的 dead pane 仍需清理。多 pane window 不属于支持范围，扩展拒绝关闭可能含有其他工作进程的窗口。契约不包含任意脱离管理的后代进程。

PID 已被复用、server 身份无法核验或进程尚未退出时，结果可能保持未知。这是保守占位，不是可自动忽略的故障。tmux 标记用于避免误认资源，不是抵御同一用户恶意修改状态的安全边界。

## State ownership and capacity

默认状态根目录为 `<agentDir>/subagents`：

| Path | Writer and purpose |
| --- | --- |
| `sessions/<rootSessionId>/state.json` | 当前 root 控制者写入成员、进程注册表、reservation、关闭意图及 tombstone |
| `sessions/<childSessionId>/state.json` | child 写入原始生命周期、generation、settledGeneration、当前会话绑定 |
| `bindings/<root>/<namespaceEpoch>/<process>/<session>.json` | child 发布授权进程的会话索引，不复制 transcript |
| `controllers/<root>/` | 跨进程控制锁，owner token 同时作为 `controllerEpoch` |
| `locks/<session>/` | 全部读改写、save、delete 共用的短期记录锁 |
| `deliveries/<root>/<namespaceEpoch>/<deliveryId>.json` | 投递前持久化的身份记录，不保存任务正文或凭据 |

parent 不再把 `closing` 或 `interrupted` 写回 child 的 runtime。读取时将 parent 控制事实与 child 生命周期合并。生命周期事件按队列串行处理，跨进程记录锁保护完整读改写，过期快照不能降低同一进程实例的完成代次。

`namespaceEpoch` 在同一持久化 root 会话重启时保留；`controllerEpoch` 随控制者接管变化。同一 namespace 的第二个 root 只能读取，不能 spawn、prompt 或 close。正常 shutdown 取消在途操作、释放控制锁；root 切换 session 也释放旧 namespace 的控制权。旧回调执行写入或 tmux 命令前必须通过控制权检查。首次取得锁后若 namespace 初始化失败，回滚本次锁与授权注册；并发调用共享整个初始化结果。已经持有控制权后的读取失败不会释放现有控制权。

只读实例在原控制者释放后，可由后续工具调用取得控制权。shutdown 和 root 会话切换按 manager 实际持有的控制权统一收尾，不依赖 session_start 是否曾取得锁。收尾先停止新操作、取消排队与在途操作，等待正在初始化的锁完成或回滚，再释放全部已取得的锁；清理失败必须报错。旧生命周期的迟到工具调用不能重新取得控制权，下一次 session_start 才显式恢复管理入口。收尾控制者不终止仍受管的 child。

锁仅在本机 owner PID 明确不存在时回收，不按时间过期抢占。只有成功删除该代唯一 owner 文件的竞争者，才能继续删除其锁目录。删除 owner 得到 ENOENT 的竞争者必须重新竞争，不能删除另一个持有者正在初始化的目录。owner 丢失、损坏、属于其他主机或 PID 可能复用时，不自动接管。状态目录应放在本机文件系统，不支持多个主机共享 namespace。

名额绑定 `processInstanceId`，不是 session 状态。会话交接期间即使旧 alias 已 closed、新 alias 尚未写入，也继续占位。空闲 child、未知进程和未完成关闭同样占位。只有明确未启动的过期 reservation 才能直接回收；已进入 launching 而结果不明的 reservation 不因 TTL 自动释放。

## Diagnostics and retry

普通管理仅访问当前 namespace 的明确成员、进程和授权绑定索引，不扫描其他 namespace。无关的损坏 JSON 或旧 schema 不影响健康 child。当前成员读取失败时，`subagent_list` 返回 `diagnostics` 并保留其占位；当前 root 控制记录本身损坏时直接报错，不将它重建为空 namespace。

`diagnostics[].agentId` 可以是会话 ID；没有可用绑定时也可能是进程 ID。状态记录大小上限为 1 MiB。`scan()` 只用于显式诊断，逐文件报告错误，不自动迁移或隔离文件。

close 先持久化关闭意图，确认退出与资源清理后，先终结进程/关系再删除会话状态。重试重新核验资源，因此可继续清理已退出但尚有 pane 的 child。它不保存每次探测的完整历史。`close all` 保留 namespace 关闭意图，未完成时拒绝新 reservation。历史 alias 的单独删除不关闭仍承载其他 alias 的进程。单目标 close 也必须检查终态 child 的终端资源，不能因 list 已将其标记 interrupted 就跳过 dead pane 清理。没有可核验 locator 时保留关闭意图和名额，不报告完成。

若启动结果未知且没有 locator，`close all` 会报错并保留 reservation，不能承诺自动找回所有失联启动。此时检查独立 tmux server、reservation、绑定目录及原生 JSONL，确认进程和资源后再人工恢复。不要仅删除 reservation 或锁目录来获取空位。

投递取消、超时或回执丢失可能发生在任务已被接收之后。错误保留 `deliveryId`，`prepared` 文件只说明曾准备投递，不能证明未执行。可核对原生 user 消息和 delivery receipt；不要自动重发。临时 tmux buffer 使用独立 UUID，即使调用取消也尝试有界清理。

## Environment contract

`new-session` 与 `new-window` 均通过 tmux 多参数执行形式传入 `/bin/sh`、`-c` 和启动字符串，固定 POSIX 解释器，不依赖用户的 `default-shell`。即使默认 shell 为 fish，也不改变该设置。启动命令用 `/usr/bin/env -i` 清除 tmux server 遗留变量，再传入明确的父端配置。允许继承 PATH、HOME、SHELL、TERM、COLORTERM、LANG、LC_*、TMPDIR、XDG_*、Pi 权限模式及容量设置。

扩展显式传入有效 `PI_CODING_AGENT_DIR`、`PI_SUBAGENT_TMUX_PATH`、`PI_SUBAGENT_PI_PATH`、管理元数据和状态根目录。tmux 提供新 pane 的 `TMUX`、`TMUX_PANE`，不复制父 pane 身份。扩展入口、cwd、模型和 thinking level 通过启动参数传递。路径建议使用绝对路径；独立 server 可通过使用 `exec tmux -S <socket> "$@"` 的 wrapper 固定。

child 登记前校验协议版本、实例、agent directory 和 Pi/tmux 配置，parent 再核验登记配置后投递初始任务。握手不调用付费模型。

child 查询时，实例标记可能尚未由 parent 安装。仅空标记允许每 25 ms 重查，单次 pane lookup 的全部查询和等待共用默认 5 秒 deadline，不为每次重试重置预算。已存在但错误的标记立即拒绝；等待期间 server 身份或 pane PID 改变也拒绝。这个预算属于 child 初始化握手，parent 的 spawn 总预算仍独立限制整次创建操作。

API key 不进入允许列表、tmux 命令参数、管理状态或诊断。child 不再意外继承旧 tmux server 中的环境凭据；应使用 Pi agent directory 的既有凭据配置。这不是进程沙箱。

## Deadlines and cancellation

操作共享单调时钟 deadline，底层 tmux 客户端收到剩余预算和 AbortSignal。取消 wait 只取消等待与查询，不关闭 child。取消 spawn、prompt 或 close 不能撤销 tmux server 已执行的操作。

命令执行器默认最多等待 5 秒，受外层剩余预算缩短。取消后向本次命令进程组发送 SIGTERM，100 ms 后必要时升级为 SIGKILL，再等待最多 500 ms 的退出确认。外层最多保留 750 ms 资源清理宽限；调度延迟仍可能增加实际耗时，不承诺硬实时。清理失败附加诊断，不覆盖原始错误。

wait 默认 30 秒，最长 600 秒。`timeoutMs=0` 允许一次最多 250 ms 的状态快照，不进入下一次轮询。已核验 child 后耗尽预算返回 timeout，不附加未完成的活动读取；连初始身份核验都未完成时返回 deadline 错误，不构造虚假的 agent 结果。

JSONL 按块读取并在解析批次间让出事件循环。同一 wait 的结果裁剪复用已读取快照。单条极大 JSON 的 `JSON.parse` 及部分投影仍是同步工作，不能承诺任意输入下的固定取消延迟。

## Offline upgrade

本版辅助函数只支持 **已停止写入且无 child、无 reservation 的 v2 root namespace**。它不是通用迁移 CLI，不转换仍有受管对象的 namespace，也不处理未知 schema。

1. 保持旧扩展运行，用 `subagent_close all` 关闭所有 child。关闭不明时先恢复旧环境，不删除证据。
2. 退出相关旧 root，确认没有旧进程会继续写入。保留 agent directory 的备份。
3. 安装或构建新代码，但暂不打开待转换的 root。运行辅助函数，参数为实际状态根目录与 root session ID：

```bash
node --input-type=module - '/absolute/agent/subagents' 'root-session-id' <<'JS'
import { upgradeOffline } from './extensions/subagent/dist/upgrade.js';
await upgradeOffline(process.argv[2], process.argv[3]);
JS
```

上例在本仓库或解包后的包根目录执行。写入用户目录前仍须自行确认目标。函数验证旧 root PID 已不存在，并通过显式扫描拒绝遗留 child。无法确认旧写入者已停止、记录损坏、备份冲突或版本未知时保留原记录并失败。

提交前保存原字节到 `sessions/<root>/state.json.v2.backup`，再以临时文件原子替换 state.json。schema v3 表示转换已提交；提交前中断可重复执行，已有备份必须与原内容一致。转换后重跑为校验后的无操作。Pi 原生 JSONL 不参与转换。

其他 namespace 的坏记录也可能阻止这次显式离线恢复扫描，但不会阻止 v3 普通管理。修复/备份这些记录后再重试，不以宽松解析跳过不明旧写入者。

## Rollback

回退代码前，用 v3 扩展关闭新建的所有 child，并退出所有 v3 写入者。确认 root 已无 child、reservation 和受管进程，不允许旧版本直接读取 v3 state。

只有已备份的空 root 可直接恢复对应 `state.json.v2.backup` 为 `state.json`，再启动旧版本。恢复会丢弃升级后的 Extension 管理事实，先另行备份 v3 状态；原生 JSONL 不回退。若无法确认资源已清理，不执行文件回退，保留 v3 代码进行诊断和收尾。

## References

- [tmux manual](https://man.openbsd.org/tmux.1)：对象 ID、环境继承及 remain-on-exit。
- [tmux 3.6b spawn.c](https://github.com/tmux/tmux/blob/3.6b/spawn.c)：单命令字符串交给 default-shell，多参数通过 execvp 直接执行。
- [fish variable defaults](https://fishshell.com/docs/current/fish_for_bash_users.html#variable-defaults)：fish 不支持 POSIX 默认值参数展开。
- [Node.js 22 child processes](https://nodejs.org/download/release/v22.19.0/docs/api/child_process.html)：signal、timeout、exit 与 close。
- [Acceptance record](subagent-runtime-reliability-acceptance.md)：本轮实测矩阵和未验证项。
