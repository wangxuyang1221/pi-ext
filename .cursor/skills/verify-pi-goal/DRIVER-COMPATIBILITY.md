# Goal driver compatibility

使用共享 helper 之外的 Goal 旧驱动前读取本文件。以下是 Pi 1.4.0 下实跑确认的夹具限制；保留原始失败，适配放在本次隔离目录并保存 diff，不把整条失败驱动的前段断言记为完整通过。

| Driver | Prerequisite or correction | Acceptance boundary |
| --- | --- | --- |
| content-tui.mjs | 旧 clipboard-native.js/getImageBinary 已不存在；使用当前 pi-tui 的 getNativeClipboard().getImage 边界注入合成 PNG，不能访问真实剪贴板 | 两种 UI 均需重跑原断言、确认附件文件和独立内容包 |
| budget-tui-driver.py | /goal 打开模态详情，后续 slash 命令前先 Esc 关闭并确认面板消失 | 只补 Esc 不证明预算旅程通过，仍须走完预算状态和退出 |
| runtime/lifecycle/execution/budget-runtime | UI mock 缺 custom，部分 noTools=all 又触发工具门禁；按实际 Pi API 提供所需方法并保留门禁 | 固定历史条数或旧标题断言也可能过时；逐个核对原因，不能删除断言使其变绿 |
| execution-tui retry-escape | 重试等待中的 Esc 当前预期为 blocked，原旧驱动期待 paused | 以 acceptance 的 retry-c12 路径验收；流式 Esc 仍应 paused，不混为同一状态 |
| acceptance compact scenarios | 固定模型响应须覆盖 retained turn-prefix summarization，完成后不能额外 resume 改变终态 | 未修正完整响应种子与动作序列前不宣称压缩旅程通过 |
| child-tmux-runtime | 检查路径字节、当前 editor UI 方法与 child 实际加载的 goal 工具 | 只缩短 socket 路径不等于行为修复；缺 child goal 或意外网络尝试仍失败 |
| package/integration runtime | 全扩展 UI mock 需当前 addAutocompleteProvider 等方法 | 本地 pi install checkout 不等于 tarball 发布安装 |
| tui-abort-probe | 源码标明 planning candidate diagnostic | 不能用该候选 scheduler 的失败报告生产队列丢失；生产输入保留用 c11、steer、followup 验证 |

真实流式 Esc 状态和 Codex quota 分类已有产品回归，继续按产品契约期待 paused/usage_limited；不要为了让驱动通过而改为当前错误结果。恢复、原生 /fork、/clone、/tree、/goal-recover 仍需完整用户入口，SDK 前段成功不能替代。
