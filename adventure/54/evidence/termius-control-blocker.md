# Native control blocker

## Acceptance

主代理核对独立提交 `2bc5fd37b85bcb5505c61a964d0dd1002b9076dc` 的[报告](termius-selection-verification.md)和[索引](termius-selection-verification.json)。37份来源、19份artifact哈希全部一致，五个记录PID再次查询均不存在。receiver六项自测、四个doctor和64份消费JS字节核对支持准备工作通过；本轮没有启动实机旅程，不能据此新增物理通过项。

累计仍为54 passed、0 failed、4 unverified，#66不关闭。既有输入框与生产 `/copy` 修复通过结论保留。

## Parent control probe

主线程存在直接的 `mcp__cua_repl.js` 接口，因此实际检查了子线程缺工具之外的恢复可能性：

1. 调用 `cua.getApp("com.termius-dmg.mac")`，返回 `Sky Computer Use native pipe startup failed`，没有取得应用状态。
2. 调用 `mcp__cua_repl.js_reset`，返回 `js kernel reset`。
3. 重建连接后再次调用相同getApp，仍返回 `Sky Computer Use native pipe startup failed`。

这是原生控制连接启动失败，不是Termius手动输入故障，也不是安全审批拒绝。没有发送键盘、鼠标或粘贴动作；没有读取系统剪贴板、启动Pi/tmux或创建测试标签。没有通过其他UI自动化技术绕过当前通道。

## Continuation

恢复原生Computer Use连接后，先确认getApp能返回Termius的新鲜状态，再派新的gpt-6.1-sol/high独立任务验证该上下文也具备native CUA。随后从隔离copy-on-select与受限receiver继续，具体入口保留在[前次主代理验收](termius-repair-review.md)和progress。没有新控制能力证据时，不重复派发同样任务。

其余未验证边界保持：物理选区/窄列/图片等、远程provider授权条件、Write/Edit精确await阶段。既有系统剪贴板样本写入授权仍有效；恢复控制连接不需要再次申请该授权。代码、安装和用户原型保留。
