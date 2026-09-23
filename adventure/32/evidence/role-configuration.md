# Role configuration evidence

## Scope

本记录核验角色配置方案能接入既有结构，不代表新功能已完成或运行验收已通过。代码基准为 501d395，冒险分支截至本记录只修改规划资料。完整规则维护于 [Spec #33](https://github.com/wangxuyang1221/pi-ext/issues/33)，决定来源为 [Planning #35](https://github.com/wangxuyang1221/pi-ext/issues/35)。

## Existing extension boundaries

- [subagent entry](../../../extensions/subagent/src/index.ts) 解析 PI_CODING_AGENT_DIR，缺省使用 Pi getAgentDir()；支持以用户主目录展开路径。
- 同文件只有 !parent 分支调用 registerSubagentTools，managed child 分支安装认证、usage 与 readiness 逻辑。这为只在 root 加载及公布目录提供已有分支。
- [index tests](../../../extensions/subagent/__tests__/index.test.ts) 存在 keeps managed-child lifecycle hooks without registering orchestration tools 用例。本轮只阅读，未运行。实施须补充角色目录及实际请求上下文的覆盖。

## Spawn and lifecycle

- [tools](../../../extensions/subagent/src/tools.ts) 在调用 manager.spawn 前验证 provider/model 格式和模型注册表。角色解析与合并可以放在该边界前，避免错误调用占用名额。
- [manager](../../../extensions/subagent/src/manager.ts) 用独立进程参数传递 model、thinking，并在 [state store](../../../extensions/subagent/src/state-store.ts) 的 LaunchMetadata 中记录启动信息。
- [runtime host](../../../extensions/subagent/src/runtime-host.ts) 使用 launch 元数据恢复 managed child 的运行身份；角色目录 reload 不应重新解释存活 child 的启动设置。

## Pi interface verification

主工作区安装的 @earendil-works/pi-coding-agent/package.json 显示 0.87.0，与项目声明一致。通过 Context7 查询 /earendil-works/pi，文档来源为 [官方扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。Context7 未提供版本固定的页面，故另外核验本地 0.87.0 发布源码。

- node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js 的 registerTool 按名称替换定义，调用 runtime.refreshTools()。
- 同包 dist/core/agent-session.js 的 reload 触发 shutdown、重新加载资源、重建 runtime，再触发 session_start。
- 这些接口支持启动与 reload 后公布同一角色快照。工具定义最终进入请求的内容，以及 child 不获得目录的行为，仍须用集成证据验证。

## Validation plan

实施至少覆盖同目录合法与错误文件、可选字段、显式 false、覆盖不写回、未知类型启动前拒绝、角色变更前后快照一致性，以及 root 和真实 child 在启动和 reload 后的可见差异。完整验收项及延期验证归属维护于 Spec，本文不重复维护清单。

未安装本 worktree 依赖，未执行新功能测试、构建或 pnpm run check，没有启动服务。
