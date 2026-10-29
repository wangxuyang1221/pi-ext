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

## Retry after user request

用户要求再次尝试后，主代理重置CUA并重新getApp，本次成功返回Termius窗口和AX；getAXStateAndScreenshot显示本机Local Terminal的空闲提示符。因此前轮native pipe启动失败在本次未再出现。

随后点击AX输入框，依次检查不含回车的 `T66_RECONNECT` typeText、窗口Raise后的typeText、授权样本文字paste，以及单键t。每次重新读取界面，提示符后均未出现探针文字。最后发送Ctrl+U，截图仍为空闲提示符。只证明接口可读取界面，尚不能确认输入链路或截图更新可靠；没有宣称探针已成功输入或已被shell清空。

没有按Return、执行shell命令、创建标签或启动Pi/tmux；没有访问原剪贴板内容。app.paste使用工具文档规定的临时粘贴及恢复机制，未通过getter读取原内容。当前仍无新增物理验收证据，不派发新的验证代理。下一步请用户手动点选Local Terminal提示符并保持Termius前台，再做一次无回车探针，区分真实焦点与自动控制响应。

## Input recovery

用户按要求手动输入并保留 `T66_MANUAL` 后，主代理新截图明确显示该字符串。随后自动Ctrl+U清空成功；自动typeText输入 `T66_AUTO_READY`，截图显示完整字符串；再次Ctrl+U后截图恢复空闲提示符。整个探针没有按Return或执行命令。

这组连续状态证明当前主线程截图及自动键盘输入可用，解除本轮控制阻塞。AX的隐藏输入字段Value在清空后仍可能保留旧值，不能单凭该Value判断shell当前内容。未确定此前失效的根因，不将用户手动输入视为通用修复方案。下一步由新的独立Sol high任务先确认其native CUA能力，再继续原定实机验收；探针本身不增加产品通过项。
