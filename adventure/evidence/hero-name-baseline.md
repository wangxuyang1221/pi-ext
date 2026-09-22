# Hero name baseline

## Confirmed intent

spawn 每次随机分配漫威英雄显示名，调用方不决定 name；所有操作继续使用 agentId。同一父会话下不重名，关闭后可复用，名字池耗尽时加编号。名字用于显示，不改变代理角色或任务。

## Existing flow

基准代码为 262824026e192e8c421ce1e1796db7b269723038，未修改产品源码。

- extensions/subagent/src/tools.ts 的 spawnParameters 包含可选 name。
- manager.ts 的 spawnInternal 使用 options.name 或 Subagent N，写入 launch.displayName，传给 Pi --name 和 tmux windowName。
- ManagedAgent 从持久化 launch.displayName 取名，ChildLink 另保存 name。后续工具根据 agentId 找子代理。
- reserveSpawn 在父状态 store.update 内预留容量，但目前 reservation 没有显示名称；displayName 在预留之后、锁之外计算。
- state-store.ts 的 mutate 使用进程内队列和 acquireFileLock，锁中重新读取状态、计算更新、验证锁所有权并写入。
- close 确认进程关闭后移除父会话中的直接子关系并删除状态；这是已确认“关闭后可复用”的合理释放边界。

## Implementation evidence

基于现有锁机制，实施设计为：在父状态锁内结合已登记子代理和仍有效的 reservations 分配并预留名字。仅 UI 随机或仅查询一次 children 后随机都无法保证并发唯一。

为防止编号与旧自定义名字碰撞，应比较完整显示名。旧会话保留原名并占用相同字符串，新生成器不追溯重命名。注册后从 reservation 名字移交到 launch/ChildLink，失败清理随 reservation 生命周期释放；不能对未确认已经停止的孤立进程过早释放名称。

持久化一次名字后，prompt/read/wait/list 和刷新不重新抽取。会话名与 tmux 沿用同一 displayName，agentId 不变。

## Name source

用户已选择电影和漫画中的常见英雄。普通读取返回 403 后，MultiFetch 已成功取得以下 Marvel 官方正文，支持首批 32 个称号。名单由代理依据用户确认的范围整理，不代表用户逐项挑选，运行时无需联网。

- [Avengers](https://www.marvel.com/teams-and-groups/avengers/in-comics)：Captain America、Iron Man、Thor、She-Hulk、Captain Marvel、Black Panther、Ghost Rider、Blade、Black Widow、Doctor Strange、Ant-Man、Hulk、Moon Knight、Scarlet Witch、Vision、Wasp、Hawkeye、Quicksilver、Spider-Woman、Nova。
- [X-Men](https://www.marvel.com/teams-and-groups/x-men/in-comics)：Professor X、Cyclops、Phoenix、Angel、Beast、Iceman、Colossus、Nightcrawler、Rogue、Storm、Wolverine。
- [Spider-Man](https://www.marvel.com/characters/spider-man-peter-parker)：Spider-Man。

上述核验用于确认英雄身份，不声称都是现役团队成员。完整规格见 Spec #25。

## Baseline check failure

只读核验提交 341c22b15035392c8bd8a8cb5df203bd71c61e24，标题“chore: 删除调研文档和原型文件”，删除了 prototypes/mcp-status-ui-prototype 与 docs/goal-descendant-acceptance.md。

extensions/mcp/__tests__/status-ui-prototype.test.ts 仍导入旧原型；package.json 两个 prototype:mcp-ui 脚本仍指向它。package.json 和 scripts/check-package.mjs 仍要求已删报告。这些遗留引用阻断测试和包校验。

建议在切片审核时纳入最小清理，不恢复已删原型或报告，也不删除生产测试绕过失败。本轮未修改基础设施。并发唯一、故障清理和旧状态兼容仍需实施测试。
