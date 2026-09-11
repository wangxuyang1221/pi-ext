# User installation

## Scope and consent

用户要求安装冒险分支以自行验收。说明全局设置修改位置、影响范围及回退方式后，用户回复“同意”。这是试用安装授权，不是最终交付确认；Map 和 Spec 保持 open。

## Change

只将 `/Users/wangxuyang/.pi/agent/settings.json` 的 packages 项由 `../../Code/t3code/pi-ext` 改为 `../../Code/t3code/pi-ext-goal-all-providers`。其余配置未修改，独立 codex-search 入口和 pi-inline-skills 保留。没有复制或提交用户设置、凭据与会话数据。

Pi 使用本地包目录，不复制代码。安装时 worktree HEAD 为 `4bb1225d6e8418d087da5263afe06d6e9cbfc449`，产品代码仍为已验收的 `7bff254d732c769d2e88474da645bf911fc5f6f8`。后续加载读取该 worktree 的实际内容，不是固定到某次提交的副本。

## Verification

- 实际 Pi 0.85.1，Node22.22.2，pnpm11.9.0。
- 切换前重新运行 `env -u PI_SUBAGENT_PARENT pnpm run check`，1067测试通过、2项默认跳过，类型检查、构建、包校验通过。
- 切换后 `PI_OFFLINE=1 pi list` 列出冒险worktree，旧包目录不再作为整包来源。核验7个编译extension入口和1个theme存在；其他两个package条目未变。
- 未向当前会话发送reload，未调用真实模型。用户下一次 `/reload` 或启动新Pi会话后加载新版；安装列表核对不等于当前运行实例已经替换。
- 检查未发现冒险worktree遗留测试进程，仓库源码无新改动。

## Rollback

将同一packages项改回 `../../Code/t3code/pi-ext`，然后 `/reload` 或重启Pi。其他package条目保持不变。试用期间不要删除冒险worktree，否则本地包来源会失效。
