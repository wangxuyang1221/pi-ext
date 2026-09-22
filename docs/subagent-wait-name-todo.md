# Subagent wait name fix

## User Visible Changes

- 对已识别的 subagent，等待中、正常结束、超时、中断及调用失败的标题均显示已保存的名称；新代理显示英雄名，旧代理保留原名称。
- 修复后产生的失败结果，重新打开会话或刷新界面仍显示同一名称。只有尚未取得目标身份信息时，才回退为缩短后的 agentId。

## Todo

- [x] 核验 Pi 0.86.0 的工具异常、取消、结果持久化和历史重建链路，确定携带 agent 显示信息且保持工具失败标记、原始错误正文和取消语义的实现方式。重点确认宿主直接生成错误结果的分支，避免仅保存组件内状态而遗漏历史重建。
- [x] 在 manager.wait 完成所属父会话及目标校验后，复用已读取的 child 提供显示信息；等待更新使用持久化名称，移除 tools.ts 中的 name: params.agentId 占位。名称传递不增加状态读取、列表扫描或轮询，不延长原有超时预算。
- [x] 为已识别目标的失败结果保留可持久化的 agent 显示信息，并让 renderer 在缺少新名称时保留当前调用已知的名称。错误结果仍按失败呈现，不伪装成正常 timeout；名称状态限定在当前工具调用内，不串入其他目标或父会话。

## How To Test

- 执行顺序：先在对应 __tests__/ 中写出会失败的行为断言，再修改 src/，按 Red-Green-Refactor 推进。覆盖生产工具 execute、onUpdate 与 renderer 的组合，不只向 renderer 手工注入带名称的固定结果。
- 等待过程：阻塞实际等待流程，在最终结果返回前检查 onUpdate 与标题，均应使用已持久化名称。覆盖英雄名与旧自定义名称。
- 结束与失败：分别触发 settled、timeout、interrupted、closed、已取得身份后的异常和取消；名称应保持一致，outcome、失败标记、错误正文及取消行为符合原有契约。目标不存在或校验失败且未取得身份时，应安全回退为短 ID，不暴露未授权目标的名称。
- 历史重建：经真实宿主写入失败工具结果，再用全新的 renderer state 重建或重新打开会话，名称与错误均应保留；同时检查刷新、默认/展开和窄宽度截断。只复用当前组件状态不能算通过。
- 隔离与兼容：连续对不同目标执行 wait，名称不得串用；不同父 Pi session 可各自持有同名代理。原有名称分配、占用释放和重载测试应继续通过。
- 性能验收：以受控等待序列记录 store/runtime 调用，确认新增名称传递不引入额外读取、list 调用或轮询。名称已在 requireDirectSession 读取的 child 中，因此每次身份通知只需固定大小的显示信息；renderer 不执行 I/O，不建立跨会话缓存。保留零超时、截止时间和取消的现有测试。
- 最终验证：运行 pnpm exec vitest run extensions/subagent/__tests__，随后运行 pnpm run check。使用真实 Pi 的场景须记录并清理本任务启动的进程、socket 和监听端口。执行后记录结果；相关行为未通过时，对应 Todo 保持未完成。

## Notes

- 依据：[Spec #25](https://github.com/wangxuyang1221/pi-ext/issues/25) 要求英雄名用于显示、agentId 用于操作，并验收重载和六类工具名称一致。本任务修复实现及验收遗漏，不改变命名规则。
- 已定位：tools.ts 的等待更新直接把 agentId 作为 name；renderers.ts 无条件覆盖 details，失败结果缺少 agent 时退回短 ID。正常 waitDetails 已使用真实名称。
- 范围为 wait 的名称传递与必要的共享 renderer 修复。其他工具须做受影响回归，不扩展成所有工具的状态管理重构。仅修改 src/ 和对应 __tests__/，不手工编辑 dist/。
- 不追补修复前未保存 agent 详情的历史错误记录；这些记录仍可能显示短 ID。未取得身份的参数或所属关系校验失败也不会猜测名称。

## Verification

2026-09-22 完成实施。实际环境为 Node.js v22.22.2、pnpm 11.9.0、Pi 0.86.0。

- 接口依据：Context7 提供的 [Pi extension 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) 为 main，未提供 0.86.0 专属内容；已核验本地 0.86.0 的 agent-loop.js 和 extension 类型。宿主会丢弃抛错时的详情，因此已识别目标的 execute 返回包含名称的错误详情，tool_result 钩子设置 isError；未识别目标时仍抛出原错误。
- Red → Green：真实等待中的名称断言先得到 agentId；游标错误的持久化结果先缺少 agent；宿主无详情错误先丢失已知名称。三个失败均在对应修改后通过。
- 新增 wait-display.test.ts 共 13 项通过。测试使用真实 SubagentManager、Pi agent loop、SessionManager 文件写入/重开及 ToolExecutionComponent，模型流和 runtime 探测由离线 fixture 提供；未启动交互式 CLI，也未调用在线 provider。
- 覆盖等待中、settled、timeout、interrupted、closed、游标错误、取消、缺失目标、所属关系不匹配、同父并发目标、跨父会话隔离、刷新、展开和 0/1/12/40/80/120 列。取消的原始正文和持久化 isError 均通过断言。
- 性能对照通过：提供 onAgent 与不提供时，状态读取序列相同；身份只通知一次，没有增加列表扫描或 runtime 探测。名称仅保存在单次调用及其持久化结果内。
- pnpm exec vitest run extensions/subagent/__tests__ 通过；最终新增的 13 项名称回归也全部通过全量检查。
- pnpm run check：类型检查通过，2419 项测试通过、12 项原有跳过；仅 quality-report.test.ts:125 因发布清单引用已删除文档失败，构建和发布校验因此未在该命令内执行。
- 单独执行 pnpm run build 通过，生成产物已更新。单独执行 pnpm run package:check 失败于原有缺失的 docs/skill-mentions.md。保留用户原有文档删除，未扩大修复范围。
- git diff --check 通过。本次名称测试临时目录已清理，无常驻服务或新增监听端口；既有 runtime 集成测试的进程清理断言通过。
