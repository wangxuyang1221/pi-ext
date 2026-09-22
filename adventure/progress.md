# Handoff

> 继续当前冒险。只从本存档及明确引用的材料恢复；其他继承的 adventure/ 文件属于历史任务。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

统一 subagent 与 codex-ui 的 UI，并新增 spawn 随机漫威英雄名。Map 为 https://github.com/wangxuyang1221/pi-ext/issues/24，完整有效要求只在 [Spec #25](https://github.com/wangxuyang1221/pi-ext/issues/25) 维护。

视觉方向 #26、视觉规则 #27 已通关。[英雄名 #28](https://github.com/wangxuyang1221/pi-ext/issues/28) 也已通关。用户要求完成本关后保存并暂停。

## Evolution

用户先选择视觉统一、保留信息结构，并覆盖全部六类消息。原型经历颜色比较后，用户明确要求收敛 /after。最后纠正颜色为 #46E87C，取代此前 #40D672；不要再询问颜色或恢复弃用方案。

用户同时扩大目标：每次 spawn 随机英雄显示名。已确认调用方不再决定 name，同一父会话下避免重名，关闭后复用，名单耗尽时加编号。仍用 agentId 操作。名字池已选电影和漫画中的常见英雄。

## Agreed Decisions and Constraints

视觉最终规则见 Spec Tool presentation；英雄名已确认规则见 Spec Hero names。原型已移除 before/neutral/soft/quiet 的 UI 入口与图片，只保留已确认 /after；原版 renderer 仅在技术对照中使用。

用户已批准同一冒险分支和 worktree 的创建、GitHub Issues、提交与推送。不得创建 PR、合并或部署。原型确认不代表实施切片已获批准。

使用简体中文沟通，text artifacts 遵循 docs/agents/repository-language-policy.md。禁止 skill-creator。保留主工作区 adventure/ 下的未提交删除，不能从此 worktree 回写恢复。

规划由主代理独立完成。进入已审核 Implementation 后按 adventure 技能委派 worker，fork_turns none、worker 类型、提供所需技能绝对路径并要求完整读取，worker 不再委派。

## Established Facts and Required Context

工作目录 /Users/wangxuyang/Code/t3code/pi-ext/.scratch/u，分支 adventure/subagent-ui-consistency。产品源码基准 262824026e192e8c421ce1e1796db7b269723038，当前未改生产源码。继续前确认 worktree 和 git status。

[原型入口](prototypes/subagent-ui/README.md) 与 [验收记录](prototypes/subagent-ui/review.md) 保存可运行原型、预览及验证限制。收敛后 40 组文本对照、7 个宽度边界及普通/全屏 PTY 验证通过。成功文字 #46E87C，标题圆点沿用主题 success。

[命名源码调查](evidence/hero-name-baseline.md) 说明集成边界：displayName 写入 launch、Pi --name 与 tmux；reserveSpawn 在父状态锁内预留容量，但旧代码在锁外生成名称。要保证并发不重名，设计是在同一父锁中预留名字，排除已登记名称及有效 reservation 名称。

pnpm run check 已执行，类型检查通过，2376 项测试通过、11 项跳过；唯一失败套件依赖基准缺失的 MCP 原型源码目录。此前独立构建通过，包校验另缺 docs/goal-descendant-acceptance.md。正式交付前需处理这些缺口，不能声称完整 check 通过。清理提交 341c22b 删除了相关资料但留下引用，建议切片审核纳入最小清理，不恢复旧资料或删除生产测试。详见命名证据 Baseline check failure。

本任务验证进程结束后清理隔离运行目录。用户自己打开的原型进程不应被终止。没有为本次任务启动持续服务或端口监听。

继续时读取 /Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md、Spec 与 #28；准备切片时读取 /Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md。

## Current Assumptions

没有阻碍规格成立的未决产品问题。并发唯一、失败释放、旧状态兼容，以及正式主题和历史渲染仍待实施验证。32 个英文英雄称号由代理按用户确认范围整理，Marvel 官方正文已通过 MultiFetch 取得，来源可从命名证据恢复。

## Continuation Point

用户要求完成本关后保存并暂停，去吃饭。本次已通关 #28、移交 Spec、收敛原型并提交推送。保存后停止，不继续形成切片或派发 worker。Map 与 Spec 保持 open，规格已确定可用于实施。

恢复后读取 Spec 和命名证据，使用 slicing 形成完整切片，交用户审核。可考虑遗留检查引用清理、六类 UI 正式集成、英雄命名三个结果，但这仅是接续建议，尚未形成或批准切片。批准后才创建 Implementation 并按 adventure 依次委派独立 worker，最后一关负责整体验收与清理。完整 pnpm run check 通过且用户确认交付后才关闭 Map/Spec。

无需再询问颜色、name 覆盖、去重或名字池范围。生产代码未改，用户自己打开的原型进程保留。
