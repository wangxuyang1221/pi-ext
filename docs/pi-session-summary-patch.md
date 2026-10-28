# Pi session summary patch

## Scope

仓库为 `@earendil-works/pi-coding-agent@1.4.0` 维护 [会话摘要补丁](../patches/@earendil-works__pi-coding-agent@1.4.0.patch)，由 [pnpm-workspace.yaml](../pnpm-workspace.yaml) 和锁文件固定。它为 Skill Mentions 提供恢复列表显示与检索所需的宿主接口，不改写历史消息或用户设置的会话名称。

Pi 的默认 bin 指向 `dist/bundle/cli.js`。补丁同时让该入口加载已修复的 `dist/cli.js`，避免 `pnpm exec pi` 继续使用未更新的预打包 runtime。只改未打包模块不足以让默认命令生效；发布包专项也通过消费项目的 `node_modules/.bin/pi` 启动。

在仓库执行 `pnpm install --frozen-lockfile --ignore-scripts` 会自动应用补丁。使用 `pnpm exec pi` 启动仓库内宿主，例如构建后运行：

```bash
pnpm exec pi -e ./extensions/skill-mentions/dist/index.js
```

发布包不包含或自动安装宿主补丁。用户用全局 Pi 加载发布包时，使用的仍是全局宿主。未补丁的 Pi 1.4.0 可继续加载扩展，原有正文、卡片和模型快照功能保留，恢复列表仍可能显示协议正文。外部 pnpm 项目若需要摘要修复，应在自己的根配置中对同一宿主版本登记此 patch 并更新锁文件；仅安装 `pi-ext` 不会传播本仓库的 `patchedDependencies`。

## Interface and lifecycle

扩展在加载阶段调用 `registerSessionSummaryTransformer`，注册同步、无副作用的文本投影函数。函数接收消息文本和 `role`、`sessionId`，返回字符串替换列表中的文本；返回 undefined 或抛出异常时保留当前文本。Skill Mentions 仅处理 user 消息的完整有效 envelope，返回 task；损坏或未知协议保留原文。

`SessionManager.list` 的第五参数和 `listAll` 的带目录重载第四参数接受转换器数组。宿主在读取每条 user/assistant 文本时调用转换器，以同一结果生成 firstMessage 和 allMessagesText。普通搜索、精确短语、正则搜索和列表显示共用枚举结果，输入搜索词时不重新解码 snapshot。显式名称仍由选择器优先显示，named 筛选不变。

进程内 `/resume` 使用当前 extension runner 的注册列表。启动 `--resume` 在首次枚举前进行一次扩展注册加载，不创建模型运行环境、不触发会话事件。该次加载使用启动目录、全局配置、显式 `-e`，以及显式或已保存的项目信任；未获信任的项目资源不加载。选中会话后仍按其 cwd 创建正式运行环境。

因此冷选择器使用启动环境的扩展，不能预先采用另一个尚未选中项目的专属扩展。需要跨项目识别该协议时，将 Skill Mentions 配置在全局，或用 `-e` 显式加载。转换器必须在扩展注册期间提供，不能等到 `session_start` 才注册；宿主会在冷选择器和正式运行环境中分别加载扩展，注册代码应避免启动会话工作。

## Verification

- `session-summary.test.ts` 通过真实 loader 和 SessionManager 验证注册时序、10/100 个会话的转换次数、增量列表、显示和搜索一致性、显式名称、同文/长/中文/多行 task、损坏/未知协议、转换失败以及历史字节不变。
- [resume-summary-driver.py](../extensions/skill-mentions/__tests__/resume-summary-driver.py) 经真实 CLI 生成 snapshot，验证 `/new` 后两次 `/resume`、冷启动 `--resume`、精确搜索、删除源 skill 后恢复卡片和继续请求。使用新的仓库内证据目录运行：

```bash
conda run --no-capture-output -n codex-py312 python extensions/skill-mentions/__tests__/resume-summary-driver.py .tmp/summary-native native
```

将模式替换为 `native-fullscreen`、`codex`、`codex-fullscreen` 并使用不同证据目录，可验收其他终端模式。先执行 `pnpm run build`。

发布包消费专项运行 `pnpm run skill-mentions:acceptance --summary native`：实际 prepack、tarball 安装、编译文件字节比对，再在显式配置补丁的消费项目中执行两种选择器旅程。默认不带 `--summary` 的入口仍使用未补丁宿主及原有完整安装验收。

本轮已在干净嵌套项目中用冻结锁文件离线安装，确认自动应用补丁、锁文件字节不变，以及 source/dist 加载成功。另用原始 Pi 1.4.0 验证 source/dist 可加载且无摘要接口。证据见 `.tmp/regression-fixes/patch-compatibility.json`、`frozen-install.log` 和四种模式的 `summary-*` 目录。

## Maintenance and removal

修改补丁时用 `pnpm patch @earendil-works/pi-coding-agent@1.4.0 --edit-dir .tmp/pi-summary-patch` 提取副本，编辑后用 `pnpm --config.ignore-scripts=true patch-commit .tmp/pi-summary-patch` 生成 patch 和锁文件，再验证冻结安装。流程依据 [pnpm patch](https://pnpm.io/cli/patch) 与 [patch-commit](https://pnpm.io/cli/patch-commit) 文档，并已用 pnpm 11.9.0 实跑。

升级宿主时先确认上游是否提供等价接口及两个选择器的注册时序。移除补丁需删除根配置中的对应映射和 patch 文件，更新锁文件，并运行摘要测试、两种恢复入口和 `pnpm run check`。上游接口名称或语义不同则先适配扩展；未适配就移除补丁会恢复原来的列表行为。
