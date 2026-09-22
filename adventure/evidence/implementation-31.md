# Implementation 31

## Scope

关卡 [#31](https://github.com/wangxuyang1221/pi-ext/issues/31)，完整规格 [#25](https://github.com/wangxuyang1221/pi-ext/issues/25)。基准 7493b88d71989b8557eabdb933e62869bed8959f，分支 adventure/subagent-ui-consistency。仅修改本冒险 worktree，不修改主工作区、不创建 PR、不合并、不部署。

## Implementation

内置规格中的 32 个英文漫威英雄称号，使用 Node crypto.randomInt 在未占用裸名中随机选择。裸名耗尽后随机选择称号，追加从 2 开始的首个未占用编号。比较完整字符串，因此旧自定义名称和已有编号都参与避让。

父状态锁中复用已读取的 children 和清理后的 reservations 建立占用集合，分配和预留在同一次持久化更新中完成。新增可选 reservation.displayName，旧 reservation 无此字段仍可读取。注册后沿 launch.displayName、ChildLink.name、Pi --name 和 tmux windowName 传递，重载不重抽。任务 settled 不释放名称，关闭确认后移除关系才可复用；启动失败按原有清理边界释放，清理失败或 launch 结果未知继续占用。

测试发现原流程可能在未启动的 reserved 被超时回收后继续启动进程。现在在启动前的父锁更新中核验 epoch、registrationToken 和 processInstanceId，预留已不存在时直接失败，避免已释放名称被迟到进程使用。

spawn schema 与内部 SpawnSubagentOptions 移除 name，残留旧输入不影响分配；renderer 不再把输入 name 用作预分配显示名，结果到达后使用已分配名称。read 复用已有 child 读取，把 ManagedAgent 交给工具详情，公开 JSON 仍序列化原有 SessionViewResult。其余工具继续使用 agentId。没有添加人格提示或运行时网络。

README 更新命名契约；原型 fixture 移除 spawn.name，保留历史显示名 fixture 以覆盖旧会话。公开工具的其他字段和内容顺序不变。

## Red and green

| Round | Red | Green |
| --- | --- | --- |
| Concurrent reservations | 三个并行 reservation 的名称全为 undefined，唯一值只有 1 | 锁内分配后 3 个名称唯一，失败后未知 launch 仍保留 reservation |
| Public schema | spawn schema 仍公开 name | schema 与内部选项移除，旧输入由真实 manager 忽略 |
| Read display | read details 显示 child-a，未使用返回的 Storm | details 使用持久化名，公开 JSON 无内部 agent 字段 |
| Pending spawn title | 结果尚未返回时显示 caller-selected | 不使用旧输入名称，收到结果后显示 Captain America |
| Reclaimed reservation | 预留被回收后仍发生一次 runtime.launch | 启动前锁内校验使 launch 次数为 0 |

行为已由首轮实现满足的边界测试直接通过，未将其记录成额外 Red。新增验证包括 36 次并发注册得到 32 个裸名及 4 个唯一编号；完整编号避让；跨父会话；关闭复用；settled 占用；失败清理释放及清理失败保留；未知 launch 过期仍占用；旧裸名、旧自定义名和无 displayName 的 reservation；重载及 Pi/tmux 参数一致。

中途修正了测试中的编号正则和 tmux 空格预期，也恢复了误改的无关 ChildLink fixture。这些是测试编写错误，不作为产品行为失败证据。最终完整检查通过。

## Cost

新增分配逻辑对当前父会话的 C 个 children 和 R 个 reservations 建立集合，成本 O(C + R)，32 个裸名检查为常量。编号搜索最多经过该称号已占用的连续编号，不对每个候选执行文件或网络 I/O。没有增加全局会话扫描、计时器或持久缓存，沿用已有锁和清理流程。read 的名称复用已加载 child，不增加状态读取。36 个并发注册与 96 个连续编号分配测试覆盖池耗尽后的增长边界。

## Verification

实际版本 Node.js v22.22.2、pnpm 11.9.0、Pi 0.86.0。未安装依赖或引入第三方 API。真实入口沿用现有 offline-child fixture，无凭据、无付费模型，fetch 明确禁用。

| Command | Result |
| --- | --- |
| pnpm exec vitest run extensions/subagent/__tests__/hero-name-lifecycle.test.ts extensions/subagent/__tests__/manager-capacity.test.ts | 生命周期与预留边界通过，后续新增未知 launch 用例纳入最终 check |
| PI_SUBAGENT_ISOLATED_INTEGRATION=1 PI_SUBAGENT_FIXTURE_DIST=1 pnpm exec vitest run extensions/subagent/__tests__/production-integration.test.ts -t 'with (immediate\|full-package-fast) startup' | 两个真实 Pi + 隔离 tmux 生产场景通过，其余 7 个非本轮场景未运行 |
| pnpm exec node adventure/prototypes/subagent-ui/check.mjs | 40 组信息对照、0/1/2/12/40/80/120 列通过 |
| conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --production | 普通宿主 15 场景通过，验证更新后的正式 schema fixture |
| pnpm run check | 2393 tests passed、11 原有 skipped；类型检查、构建及标准发布包校验通过 |

生产集成直接走正式 index/registerSubagentTools/SubagentManager/TmuxRuntime 构建产物，启动真实 Pi CLI 和独立 tmux server。immediate 与 full-package-fast 均断言 spawn、prompt、list、read、wait、close 返回同一名称，wait 得到 settled；同时核验 ChildLink、launch、原生 session_info 和实际 tmux window 名称。没有以 fake runtime 替代这两个场景的进程验收。

其余颜色、全屏、历史、刷新、主题视觉证据复用 [#30](implementation-30.md)，本关只复跑受参数与名称影响的普通模式入口和文本/宽度对照。没有宣称重新验证全部终端或付费 provider。

## Cleanup and boundaries

真实入口 finally 验证本次启动的 Pi、keeper 和 tmux server 全部退出，livePids 为空，隔离 socket 不可访问，临时目录删除。视觉入口子进程退出；未启动 TCP 服务或监听端口。只保留本地忽略的检查日志和视觉诊断，不将运行日志、会话、认证 fixture 或缓存提交。用户已有原型未操作。

在线 provider、外部认证及不支持 truecolor 的终端不在本轮验证范围。11 个默认跳过项包含需显式开启的集成场景，本轮另行开启其中两个生产入口。历史独立 package-artifact.mjs 的扩展数量/license 断言继续按 #29 的已知边界处理，不在标准 check 内，也不宣称通过。
