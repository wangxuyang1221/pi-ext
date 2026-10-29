# Text region verification map

此索引是新增能力的验证入口。先执行 [Launch 和 Doctor](../SKILL.md)，再选择下面对应的用户路径。普通/全屏、补丁/原版是四种不同入口，某一种通过不能代替其他三种。

## Baseline preconditions

- 从当前 worktree 成功 build，使用本次 RUN 和新证据子目录。
- doctor 确认实际 CLI、构建入口、固定 Pi 和 API 状态；没有共享进程或用户配置。
- PTY 使用离线 provider，真实工具在自己的空 workspace 执行。provider 及摘要替身不覆盖权限或宿主生命周期。
- 安装和 CPU 旅程从本次安装结果取路径，不引用他人的 `.tmp` 安装。

## Driving conventions

命令均在仓库根目录执行；Python 固定 `conda run -n codex-py312 python`，pnpm 加命令级 `pnpm_config_verify_deps_before_run=false`。先等 ready，再发键盘输入。自动旅程按文件内顺序覆盖该入口全部操作，单独跑契约单测只作补充。失败先 doctor，每轮都 Cleanup。CPU 测量串行运行，停止本任务其他测量负载，不关闭用户进程。

## Proof and reporting

保留动作、ANSI/单元格、公开事件、真实副作用、退出码、PID/进程组和清理证明。按 feature ID 与入口逐项记录 `passed / failed / unverified`，未执行的入口和未满足的前置条件不能算通过。声明最终完整覆盖时须覆盖下表全部入口和人工边界；生成阶段的单 feature 自证只证明 skill 可用。

## Features

| Feature | Entrances | Evidence |
| --- | --- | --- |
| [Text region example](regions.md) | 示例命令、普通/全屏、原版回退 | 独立/同时变化、草稿、真实历史、替换与退出 |
| [Working and lifecycle](working.md) | 提交 prompt、权限批准、Esc、设置页、new/reload | 生产 spinner/rate、文件副作用、retry/compaction/settled |
| [Interaction boundaries](interactions.md) | overlay、输入、搜索、滚动、选择、图片、物理终端 | 自动资格/回退及独立物理边界 |
| [Performance](performance.md) | 同一用户动画/内容更新的 CPU 对照 | 三轮全部样本、原生调度、预算与字节/哈希 |
| [Installation and fallback](installation.md) | 冻结补丁宿主、原版、正式发布安装 | lock、probe、包内容比对、四入口实际 TUI |
