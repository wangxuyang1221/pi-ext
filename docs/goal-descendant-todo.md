# Goal direct child accounting todo

## Understanding

C13 已确认，原拓扑阻塞解除。本关只归集主代理及直接受管子代理，不改变单层编排、容量、权限或 direct-only 关闭语义。原调查保留在报告历史章节。用户已确认另一会话完成修复并提交，旧共享写者阻塞解除。恢复基准为 `3972c9e` 加保留未提交 goal #4 至 #8；不覆盖或重复实现已提交修复。旧停点证据见 [handoff](goal-descendant-handoff.md)。

## User visible changes

- 根目标统计包含为该目标启动或重新投递任务的直接受管子代理用量。重复读取、结束和重放不重复收费。
- 子代理触及根预算时根回合只收到一次收尾提示，不强杀子进程，不新增自动 goal 回合。替换目标后的旧报告不污染新目标。

## Todo

### 1. Locate

- [x] 重新读取 #8、#3 计费契约和 C13，核对保留单层编排。
- [x] 完整读取固定 0.84.3 扩展文档与 event-bus 示例，Context7 核对事件接口。Context7 无固定版，只作定位，安装源码及双版本运行作证据。
- [x] 完成实现所需固定版其他文档、源码及实际协作路径核验。

### 2. Implement

- [x] TDD 增加独立子代理 source 检查点，与根累计原子提交，继承快照不复制活动订阅。
- [x] TDD 接入任务投递归属、finalized usage 累计报告，报告不保存目标或 provider 凭据。
- [x] TDD 根订阅与生命周期清理、替换隔离、读活动去重和一次软收尾。
- [x] 建立双版本真实 Pi SDK 受管 OS 进程离线夹具，验证启动、报告、关闭与根检查点一致；transport 为 IPC，不宣称真实 tmux 验收。

### 3. Deliver

- [x] 停止前已运行 #7/#6 双版本回归、完整 pnpm check 和 diff check；60 个记录进程全部退出，无遗留监听端口。日志基于混合源码，不代表当前稳定基准通过。
- [x] 按用户授权恢复，读取已提交源码 diff 与 own-code.patch，核验 beforePrompt 和 usage hooks 保留，goal 四个主文件哈希与停点一致。
- [x] 补真实 tmux transport 最小离线受管进程夹具，双版本验证投递回执、用量落盘、根归集及显式关闭；修正 observer 的关闭参数并加外层 isError 断言，Red/Green 后重新运行全部受管场景。
- [x] 对当前稳定基准执行双版本受管与 #6/#7 回归，完整 pnpm check、diff check，保存新检查点与进程清理证据，见 [acceptance](goal-descendant-acceptance.md)。
- [x] 更新当前验收报告和 [#8证据评论](https://github.com/wangxuyang1221/adventure/issues/8#issuecomment-5605066251)、正文并 GET 核对，保持 OPEN、待独立验收，交回写权。
- [x] 更新本地报告及 [#8 评论](https://github.com/wangxuyang1221/adventure/issues/8#issuecomment-5603967497)，读最新正文再修改并 GET 核对，保持 OPEN，按集成阻塞交回写权。

## How to test

- 先测试 root 与多个 child 累计交错、同一累计重放、旧 goal 报告及复制快照，再最小实现。
- 真实受管进程覆盖 root/direct child、重复消息及读取、结束、目标替换和晚到用量；两版本 SDK/TUI 回归保留 C11/C12，不调用付费模型。
- 正常响应只写固定大小累计报告，按明确登记的 source 读取，不扫无归属会话；根事件驱动，不增自动轮询。记录订阅与响应数量增长、清理 watcher，并以重复读取不增写盘/计费断言限制高频路径成本。

## Notes

C13 取消 grandchild 与中间父退出验收，不是本 worker 降级。确认 https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5603155660 。
