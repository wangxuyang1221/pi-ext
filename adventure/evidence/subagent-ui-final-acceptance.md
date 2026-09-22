# Subagent UI final acceptance

## Result

对照 [Spec #25](https://github.com/wangxuyang1221/pi-ext/issues/25)，#29、#30 已通关，本次 #31 的工程验证通过，交由协调者最终验收。未关闭 #31、未写 Issue Acceptance，也未更新 Map、Spec 或 progress.md。

## Acceptance matrix

| Spec requirement | Evidence | Result |
| --- | --- | --- |
| 六工具调用状态，wait 超时/中断 | [Implementation 30](implementation-30.md) 的 renderer、40 组对照及普通/全屏真实宿主证据 | 通过；标题状态与子任务状态分离 |
| 成功文字 #46E87C，圆点主题 success，正文/辅助层级 | #30 的三主题、历史重建和刷新证据 | truecolor 环境通过；未改全局主题 |
| 默认/展开的信息不丢失或重排，长名称与极窄宽度 | #30 视觉证据；#31 重新运行 40 组对照及 0/1/2/12/40/80/120 列 | 通过；显示名按新契约变化 |
| 随机 32 名、同父唯一、耗尽编号、不同父会话独立 | [Implementation 31](implementation-31.md) 的分配器、36 次并发注册与生命周期测试 | 通过；无运行时联网 |
| settled 保留、关闭复用、失败清理、安全保留 | #31 清理失败、未知 launch、已回收预留禁止迟到启动的测试 | 通过 |
| 重载与六工具名称一致 | #31 manager 重载测试，以及两个真实 Pi/tmux 生产入口 | 通过；原生会话、tmux、launch、ChildLink 与工具结果一致 |
| 旧会话和旧 reservation 兼容 | #31 旧裸名/自定义名占用与缺少 displayName 的 reservation 测试 | 通过；未追溯重命名 |
| 公开 spawn.name 移除，旧输入不能决定名称，agentId 不变 | schema、真实 manager 旧输入与 renderer 测试，README 与原型 fixture 更新 | 通过；无英雄人格提示 |
| 完整检查及遗留失效引用清理 | [Implementation 29](implementation-29.md) 与 #31 最终 pnpm run check | 2393 tests passed、11 原有 skipped，类型检查、构建和标准发布包校验通过 |
| 交付材料与资源清理 | #29/#30/#31 证据和本矩阵；真实入口 finally 的 PID/socket 断言 | 通过；仅清理本任务资源 |

## Deferred verification

生产 renderer、历史重开、刷新和主题兼容已在 #30 完成。本关完成英雄名并发、故障清理、旧状态兼容，以及真实生产入口名称传递，延期项没有影响交付的未决问题。

本关实际生产入口运行构建产物与离线 provider，覆盖独立 extension 和完整 package 加载。它证明真实 Pi/tmux 生命周期及名称链路，不证明在线 provider 或外部认证。#30 精确色值仅在 truecolor 环境验证。默认跳过的在线/其他集成场景没有被描述成已运行。

历史 package-artifact.mjs 旧扩展数量/license 断言仍是范围外已知问题；标准发布校验已通过。保留主工作区原有 adventure/ 删除与用户原型，不创建 PR、不合并、不部署。
