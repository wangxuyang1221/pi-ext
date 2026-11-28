# Testing

## Setup

使用 `package.json` 指定的 Node 和 pnpm 版本。宿主测试使用仓库锁定的原版 Pi。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run hooks:install
pnpm run hooks:check
pnpm run check
```

`check` 校验脚本与文档链接、密钥、编译产物、源码和夹具类型、离线测试与发布清单，并用宿主分别加载两个插件的源码和 dist 入口。全新检出时先构建，再单独执行 `typecheck:tests` 或 `host:check`。

## Commit gates

`--ignore-scripts` 不会自动安装 hooks。首次检出后显式运行上述安装命令；安装仅设置本仓库的 `core.hooksPath=.githooks`。已有其他 hooks 路径或可执行钩子时，安装拒绝覆盖，需先整合。该配置由同一仓库的 worktree 共享，相对路径始终指向当前 worktree 的 `.githooks`；切换到未包含门禁文件的旧版本后，应运行 `hooks:check` 核实状态。

`pre-commit` 调用 `pnpm run check:staged`。它直接读取整个 Git index 中的 blob，检查以下内容，不修改暂存区或工作区，也不自动 stash、修复或增加提交文件：

- Secretlint 推荐扫描规则识别的 provider token、私钥、Basic Auth 和含密码的数据库连接串。测试、文档、`.env.example` 和锁文件同样扫描，源码中的 `secretlint-disable` 不生效。扫描整个暂存快照也覆盖 amend 时未改动的文件。
- 暂存版 `.gitignore` 排除的文件，以及明确禁止的本地配置、依赖、构建输出、日志和缓存。`.env.example` 可以提交，但仍检查其内容。个人全局 ignore 配置不参与这项判断。
- 冲突标记、未解决的 index entries，以及相对于 HEAD 的新增空白错误。历史空白错误无需在无关修改中清理。
- 暂存版 `package.json` 的脚本路径和 Markdown 本地文件链接。仅存在于工作区而未暂存的目标不能满足引用；删除引用目标也会失败。

符号链接只检查目标字符串，不读取链接指向的本地文件；gitlink 等不支持的条目会失败。检查结束时再次核对 index，期间若发生变化则拒绝通过。类型检查、测试和构建仍在交付前及 CI 中运行，不随每次 commit 全量执行。

`pnpm run secrets:check` 扫描工作区内的已跟踪文件和未被忽略的新文件。它用于开发时提前发现问题，不能替代暂存区门禁。`pnpm run secrets:history` 另行扫描本地所有 refs 可达提交中的完整文件版本，包括后来删除的文件；它不自动 fetch，也不覆盖 reflog 或不可达对象，不在每次 commit 时运行。

所有扫描离线运行，输出路径、规则、行列和命中内容的 SHA-256，不输出凭据值。扫描器缺失、规则配置损坏或内容读取失败均阻止通过。规则只能识别已覆盖的凭据特征，不能保证发现任意短密码、个人数据、编码或拆分后的秘密；二进制仅检查其中可直接识别的文本，不解压归档或识别图片、音频。扫描通过不表示这些内容已完成人工审查。

误报例外维护在 [secret-exceptions.json](../config/secret-exceptions.json)，必须同时匹配具体路径、规则、message ID 和命中内容哈希，并记录原因。现有条目供历史扫描识别旧提交中的合成 Basic Auth 测试数据。新增误报先核实来源，再添加最小范围例外；不要添加整个目录的豁免。真实凭据应移出文件并撤销或轮换，历史扫描的命中不能靠删除当前文件解决。

门禁自身的验证通过真实临时 Git 仓库运行，包括拒绝提交、部分暂存、首次提交、改名与删除、worktree、安装冲突、脱敏和 CI 失败汇总：

```bash
pnpm test test-support/__tests__/repository-gates.test.ts
```

Git 允许用户跳过本地 hooks；CI 会独立执行暂存快照检查。只有远端分支保护将汇总 `Check` 设为必需检查后，才能强制阻止失败合并。仓库中的 workflow 文件本身不会启用远端保护，配置前需确认账号套餐和管理权限。

## Focused runs

`pnpm test` 使用隔离的 HOME、Pi 配置和临时目录。通过该入口执行 Vitest，例：

```bash
pnpm test extensions/codex-ui/__tests__/components.test.ts
pnpm run test:codex-ui
pnpm run test:claude-code-ui
```

## Terminal acceptance

Linux 和 macOS 的终端旅程使用 Python 3.12 及 pyte。

```bash
conda create -n codex-py312 python=3.12
conda run -n codex-py312 python -m pip install pyte==0.8.2
```

`pnpm run tool-status:check` 在普通与全屏终端验证 Read、Bash、Edit 和 Write；`pnpm run codemode:check` 验证嵌套调用检查面板。Claude 的安装、布局、工具和会话恢复由[Claude Code UI 验收](../.cursor/skills/verify-pi-claude-code-ui/SKILL.md)覆盖。两条命令均会构建扩展，须串行运行。Working、编辑器、Thinking、print 和 RPC 的入口及证据位置见[验收指引](../.cursor/skills/verify-pi-codex-ui/SKILL.md)。

Pi 1.7.0 已移除安装遥测。两个插件的[宿主边界验收](../.cursor/skills/verify-pi-codex-ui/scripts/README.md#pi-170-host-boundary)覆盖配置目录优先级、OSC 7577、模型配置告警、Bash 上下文估算与 Alt+Enter。普通与全屏分别运行。Codemode 的[自定义按键旅程](../.cursor/skills/verify-pi-codex-ui/features/codemode.md)、Claude 的[改键与重载旅程](../.cursor/skills/verify-pi-claude-code-ui/features/terminal.md)和 [Working 旅程](../.cursor/skills/verify-pi-codex-ui/features/working.md)核对改绑后的提示和实际动作。

## CI

CI 在 Linux 和 macOS 上执行基础检查及打包检查。Linux 还运行终端验收。汇总检查 `Check` 要求两类任务全部通过。
