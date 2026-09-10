# Pi goal storage design

## Decision and authority

C10 已确认：用户选择保留新会话直接使用 goal，插件独立保存目标并提供恢复入口。Pi 会话 custom entry 改为历史镜像，不是状态的唯一来源。这替代了早期候选方案的唯一存储假设，不改变 C7 会话级目标或 C8 显式继承规则。

依据：[七项双版本存储实验](./pi-goal-storage-probe.md)。本设计为文件存储，不引入数据库，不调用 Pi 内部强制 flush，不伪造 assistant 消息。当前尚未实现，也未在用户全局目录写入目标文件。

## Record and ownership

建议运行目录为 Pi agent directory 下的 `goals/`，测试必须注入仓库内临时目录。通过宿主公开的 getAgentDir 定位，不硬编码用户 HOME。

独立 record ID 标识一份可恢复状态；内部 goal ID 标识当前目标。普通会话以 session ID 查找所属 record，显式继承创建新 record 并复制 goal ID 与累计快照，后续分别累计。替换目标生成新 goal ID 和 generation。清除目标保存 tombstone，而不是读取旧镜像将其复活。

记录包含 schemaVersion、recordId、ownerSessionId、cwd、预期 sessionFile、goal 快照、revision、continuationDeferral 和恢复归属。goal 快照保存 objective、六种状态之一、可选 tokenBudget、tokensUsed、elapsedSeconds 及创建/更新时间。附件引用和可诊断错误采用有界字段，不保存凭据或 provider 原始敏感响应。

独立文件存在但镜像缺失，以独立文件为准。独立文件损坏或版本不支持时停止该目标，不从可能过时的镜像自动复活；向用户报告并提供显式恢复途径。不能将普通历史消息中的目标文字当作状态。

## Durable mutation

一个 record 同时只允许一个写入者。锁带 record、进程实例与 owner 信息；并发打开同一会话时第二个实例不得开启同一目标的自动循环。不能仅凭超时自动夺锁，进程身份不明确时要求显式恢复而非并行运行。

mutation 在单写者内串行进行，核对期望 goal ID、generation 和 revision。向同目录临时文件写入完整新快照，完成写入后替换正式文件。只有独立状态提交成功，才向用户或模型确认成功并允许调度。随后追加 Pi 历史镜像。镜像失败不回滚权威状态，但应提示并在下次安全检查点修复。

写入失败时保留此前已提交状态，停止新的自动续跑并报告存储错误。文件替换的实现须包含资源关闭及适用平台的同步处理；原子替换不等于已证明任意断电场景零丢失，验收必须区分异常退出与系统断电。

## Goal-first recovery

当 Pi 尚未写出 sessionFile，目标仍可独立持久化。正常首条 assistant 写盘后继续沿用同一 record，不做二次创建。

提供独立 `/goal-recover` 入口，列出当前项目中可恢复但未被活跃写入者占有的记录，显示目标与状态。不得自动选第一条或启动全部记录。

- 原 Pi sessionFile 存在：切换到该会话并使用新的 context 绑定目标，按已保存状态恢复。
- 原文件不存在：明确告知只能恢复目标与已保存统计，不能还原未落盘对话。用户确认后在新的持久化模式会话接管同一个 record，更新 ownerSessionId，不复制成第二份可同时运行的记录。
- 恢复界面本身不发起模型请求；确认接管后仍检查状态和继承门禁。paused/blocked/usage_limited 需要用户明确恢复；complete/budget_limited 不自动运行。
- 进程在会话替换与归属提交之间退出时，原 record 仍是唯一恢复来源。恢复再次读取最新 revision，不能依赖旧 UI 快照。

此入口不恢复文件系统或数据库副作用，不把已消耗 token 清零。

## Fork and clone

普通 fork/clone 新 session ID 不拥有源 record，即使历史镜像被复制也不继承。

显式继承先对源 record 做检查点，捕获目标快照，再创建新会话和新 record，初始续跑门禁与快照一起提交。失败不得让新会话自动跑一个未持久化的目标，也不得清除源目标。最坏可留下没有 goal 的新会话，并明确提示继承失败。

继承 active 不等于 paused。门禁随记录持久化，直到用户显式启动回合或明确恢复；状态仍须允许运行。其他目标停止状态不会仅因清除门禁而变成 active。

## Scenario review and gates

以下为设计推演，文件协议尚未运行验证。

| 故障位置 | 预期结果 |
| --- | --- |
| 创建 goal 的独立文件提交前失败 | 不报告创建成功，不开启自动续跑 |
| 独立文件已提交，Pi 尚无首条回复就退出 | 恢复列表可找到唯一记录，不依赖 JSONL 存在 |
| 独立文件成功，镜像失败 | 独立文件仍是当前状态，恢复不回退 |
| 同一孤立记录被两个窗口同时恢复 | 单写者与 revision 检查只允许一个接管 |
| 替换新目标后旧 usage/continuation 到达 | goal ID 和 generation 不匹配，不能污染新目标 |
| 清除目标后打开旧分支或旧镜像 | tombstone 阻止复活 |
| 显式继承写入失败 | 源目标不变，新会话不自动开跑 |

延期验证 V3 由持久化与恢复切片负责，最晚在其验收前完成并发接管、异常退出、写入失败和镜像失败测试。若公共 session 切换接口无法支持上述接管规则，必须回到规划关，不得偷偷缩减 C10 为“先聊一轮才能用”。
