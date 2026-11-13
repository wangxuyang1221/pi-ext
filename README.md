# pi-ext

简体中文 | [English](README.en.md)

为 [Pi Coding Agent](https://github.com/earendil-works/pi) 提供 Codex 风格的终端界面、远程上下文压缩、Fast Mode、MCP 工具连接和行内技能引用。

一个 package 包含五个扩展和 `codex-pi` 主题。安装后默认加载全部扩展，也可用 `pi config` 单独启停。

| Extension | What it does |
| --- | --- |
| `codex-ui` | 提供 Codex 风格输入框、状态栏、工具预览、完整思考显示和 codemode 调用检查面板。 |
| `codex-compact` | 为 `openai-codex` 模型接入 Codex Remote Compaction V2，以加密 checkpoint 保存压缩上下文。 |
| `openai-fast-mode` | 通过 `/fast` 为支持的模型请求 priority service tier。 |
| `mcp` | 连接 stdio、Streamable HTTP 和 legacy SSE 服务器，将工具注册到 Pi。 |
| `skill-mentions` | 在输入框中补全 `$skill`，提交时加载技能，并保留可编辑的历史原文。 |

## Requirements

- Linux 或 macOS。原生 Windows 不在支持范围内。
- Node.js `>=22.19.0`，pnpm `11.9.0`。
- Pi `1.5.2`。开发依赖与 peer dependencies 均固定为此版本，其他版本需另行验证。
- 建议使用支持 24-bit color 的终端。技能标签的默认图标需要 Nerd Font，也可切换为 `⌘`。

扩展通过构建后的 ESM 文件加载。Codex 压缩使用 Pi 已有的 ChatGPT 认证，不依赖 Codex CLI。其他模型仍可使用界面、MCP 和技能引用。

## Install

先安装上述运行环境，再克隆、构建并安装本地 package。仓库不提交 `dist/`，请使用以下源码构建流程。

```bash
git clone https://github.com/wangxuyang1221/pi-ext.git
cd pi-ext
pnpm install --frozen-lockfile --ignore-scripts
pnpm run hooks:install
pnpm run hooks:check
pnpm run build
pi install "$PWD"
```

`pi install` 将本地目录记入用户设置，不复制文件。安装后请保留该目录，并重启 Pi。

选择本次会话的主题：

```bash
pi --use-theme codex-pi
```

要持久使用此主题，在 `/settings` 中选择 `codex-pi`。它会在 `/new`、`/resume`、`/fork` 和 `/reload` 后继续生效。

要临时加载 package 而不保存安装设置，在构建后的仓库根目录运行：

```bash
pi -e "$PWD"
```

更新源码后，重新安装锁定依赖并构建，然后重启 Pi。代码升级不要只依赖 `/reload`。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
```

## Everyday use

| Action | Command or input |
| --- | --- |
| 启用或关闭 Fast Mode | `/fast on`、`/fast off`；`/fast` 切换状态 |
| 手动压缩上下文 | `/compact` |
| 检查 MCP 连接 | `/mcp status` |
| 重新读取 MCP 配置 | `/mcp reload` |
| 检查最近一次 codemode 调用 | `/inspect` |
| 引用已安装的技能 | 输入 `$`，选择技能，再提交消息 |
| 切换技能标签图标 | `/skill-label-icon command` 使用 `⌘` |
| 展开工具输出 | 默认 `Ctrl+O`，遵循 Pi 的 `app.tools.expand` 绑定 |
| 复制最近一条已完成回复的正文 | 在 Codex 输入框提交 `/copy` |

### Codex UI

`codex-ui` 使用 Pi 品牌，提供实色背景输入框和紧凑的工具显示。状态栏显示模型、思考等级、Fast Mode、工作目录、Git 分支及剩余上下文比例。

- 思考文本在原生消息位置以 `Thinking` 标题和引用块显示。`Ctrl+T` 沿用 Pi 的隐藏切换。
- 连续 Read 按文件分组，默认每个文件预览三行。Bash 显示命令和前三行输出，可原位展开已捕获内容。
- Edit 和 Write 显示变更 diff。工具标题用颜色区分执行中、成功、失败及可识别的取消或超时。
- 运行期间，输入框上方显示 Working 动画和计时，状态栏显示估算接收速率。统计口径见 [Working 与速率说明](docs/codex-working-rate.md)。
- codemode 显示嵌套调用树。`/inspect` 可切换 Calls、Script 和 Output，分别检查子调用与父脚本输出。重启后只能恢复宿主保存的信息，缺失详情会明确标注。

普通回复使用外层列表排版，用户消息沿用原生 Markdown。显示转换不修改会话原文或模型上下文。`/copy` 复制回复正文；终端选择复制则包含显示出的缩进、标记和换行。

若希望减少消息两侧留白，在 `/settings` 中将 `Output padding` 设为 `0`。主题只控制终端单元格颜色，字体、窗口透明度和模糊效果由终端配置决定。

默认 Read 和 Bash 读取 Pi 全局设置及受信任项目的 `.pi/settings.json`，保留 `shellCommandPrefix`、`shellPath` 和 `images.autoResize`。配置损坏或不可读时，这两个工具拒绝执行并提示修复；修复后用 `/reload` 或重启刷新配置。SDK 自定义配置与执行器的接入参数见 [codex-ui 入口](extensions/codex-ui/src/index.ts)。

### Skill mentions

在任意输入行输入 `$` 或技能名前缀，例如 `请用 $research 检查这段代码`。Tab 或 Enter 选择候选；菜单关闭后，再按 Enter 发送。扩展兼容 Pi 默认编辑器和 Codex 输入框。

同一消息可以引用多个技能，重复引用只加载一次。代码、转义文本、未知技能和不可读技能保持原文。补全要求名称两侧是空白或输入边界；提交时也接受 `$research，继续` 这样的右侧标点，`$research.md` 不会激活技能。

提交后显示 Pi 原生技能卡片，并保存当时的技能内容供历史恢复。默认标签使用 Nerd Font 的 cube 图标。缺字时运行 `/skill-label-icon command`，该偏好会保存。

### Fast Mode

Fast Mode 默认关闭。启用后，扩展为所有 `openai-codex` 模型和[内置名单](extensions/openai-fast-mode/src/config.ts)中的 `openai` 模型注入 `service_tier: "priority"`。名单随扩展维护，加载时会同步。

```text
/fast on
/fast off
/fast toggle
```

普通根会话也可用 `pi --fast` 启用并保存状态。全局配置位于 `~/.pi/agent/extensions/pi-openai-fast-mode/config.json`，项目配置位于 `.pi/pi-openai-fast-mode/config.json`。

状态栏中的 `fast` 表示扩展请求了 priority，不保证服务端采用该档位、加速幅度或计费结果。如果服务端明确拒绝某个 Codex 模型的 Fast Mode，本次请求会失败；扩展会提示重试，并在当前会话中对该模型使用标准模式。

### Codex compaction

`codex-compact` 仅接管 provider 为 `openai-codex` 且 API 为 `openai-codex-responses` 的模型。它通过远端服务生成加密 checkpoint，写入 Pi 标准压缩记录。其他 provider 和 API 使用 Pi 原生压缩；从带 checkpoint 的分支切换到非 Codex 模型时，扩展回放原始分支。

手动 `/compact` 和 Pi 触发的压缩沿用原生进度界面。成功写入并校验后显示 `Codex compaction applied`。远端请求或 checkpoint 校验失败时取消本次压缩，不静默改用本地文本摘要。当前 V2 路径不使用 `/compact focus text` 的 focus text，也不支持分段压缩。

全局配置位于 `~/.pi/agent/pi-codex-compact.json`。受信任项目中的 `.pi/pi-codex-compact.json` 按字段覆盖全局值。例如：

```json
{
	"autoCompactTokenLimit": 180000,
	"autoCompactScope": "total",
	"effectiveContextWindowPercent": 95,
	"metadataClientVersion": "0.156.0"
}
```

| Setting | Behavior |
| --- | --- |
| `autoCompactTokenLimit` | 正数。未配置时为模型原始上下文窗口的 90%，自定义值也不超过此上限。 |
| `autoCompactScope` | 默认 `total`，也可用 `bodyAfterPrefix`。 |
| `effectiveContextWindowPercent` | 默认 `95`，取值大于 0 且不超过 100。影响扩展的窗口估算，不改变上述 90% 阈值或 Pi 自身调度。 |
| `metadataClientVersion` | 默认 `0.156.0`，用于查询官方 Codex 模型目录。只接受三段数字版本号，不自动跟踪最新版。 |

扩展在首次实际请求或压缩时，使用 Pi 认证查询并缓存官方模型目录。`/codex-metadata` 显示当前版本和配置来源；`/codex-metadata version <version>` 修改全局版本，`/codex-metadata reset` 删除全局覆盖。项目有效值仍然优先。命令只更新配置，不验证服务端是否接受该版本。

如果在请求之外发起压缩时，扩展无法确认工具可见性，需要显式提供 `manualProjection`。仅在没有隐藏工具或强制提示词的普通配置中使用：

```json
{
	"manualProjection": { "hiddenTools": [] }
}
```

有隐藏工具时，`hiddenTools` 必须列出真实名称；使用强制提示词时，还需提供精确的 `forcedPrompt` 字符串。信息不足或历史投影无法验证时，扩展取消本次压缩并保留旧 checkpoint。压缩期间会话、模型、工具或提示词变化也会取消提交。

### MCP

MCP 扩展将服务器工具注册为 `mcp__<server>__<tool>`。它可独立于 `codex-ui` 使用，并替代 Pi 内置 MCP。为避免重复加载提示，在 Pi `settings.json` 现有的顶层 `extensions` 数组中加入 `"-builtin:mcp"`，然后重启 Pi。

扩展按以下顺序使用第一个存在的配置文件，不合并多个文件：

1. `PI_MCP_CONFIG` 指定的路径。
2. 受信任项目的 `.pi/mcp.json`。
3. 全局 `~/.pi/agent/mcp.json`。

高优先级文件无效时，不回退到下一个文件。配置支持 JSON comments 和 trailing commas。以下示例通过 pnpm 启动文件系统服务器，并允许它访问当前项目目录：

```json
{
	"mcpServers": {
		"filesystem": {
			"command": "pnpm",
			"args": ["dlx", "@modelcontextprotocol/server-filesystem", "."]
		}
	}
}
```

保存后运行 `/mcp reload` 和 `/mcp status`。用 `/mcp reconnect <server>` 手动重连，用 `/mcp logs [server]` 查看诊断，或在受信任项目中用 `/mcp-init` 创建配置。

超时配置单位为毫秒。连接可自动恢复，但工具调用默认不自动重放。历史工具可离线显示，恢复历史不会重新执行调用。文本结果最多 50 KiB、2000 行，超限内容不会另存为完整日志。远程服务器配置、重试策略与诊断说明见 [MCP 使用说明](extensions/mcp/README.md)。

## Compatibility

默认使用原版 Pi `1.5.2`。可选补丁提供两项增强：

- [文本区域刷新](docs/pi-text-region-refresh.md)，让 Working 等动态区域复用已有布局。
- [会话摘要投影](docs/pi-session-summary-patch.md)，让技能消息在恢复列表和搜索中显示用户任务正文。

补丁使用独立依赖树和显式启动入口，不修改全局 Pi。原版 Pi 仍保留五个扩展的主要功能，但使用普通刷新；技能会话的恢复列表可能显示协议封套，搜索可能命中保存的技能正文。安装本 package 不会自动安装宿主补丁。完整范围与验证入口见 [Pi 兼容性说明](docs/pi152-compatibility.md)。

不要同时加载本 package 与独立的 `npm:@yeungkc/pi-codex-compact@0.0.6` 或 `npm:pi-openai-fast-mode`，否则会重复注册命令或 hooks。迁移时先验证本 package，再停用旧入口并重启 Pi。

## Development

修改 `src/` 和对应测试，由构建生成 `dist/`。完成修改后运行：

```bash
pnpm run check
```

该命令检查文档链接与脚本路径、密钥、构建、类型、离线测试、发布内容，以及源码和编译产物在宿主中的加载。默认测试隔离用户配置与凭据，不发送付费模型请求。

定向测试也通过仓库入口运行：

```bash
pnpm test extensions/mcp/__tests__/index.test.ts
```

终端交互需要另外执行对应的 CLI 或 PTY 验收。联网验收 `pnpm run pi152:live` 会产生真实服务端用量，不属于默认检查。测试分组、前置依赖和清理规则见 [Testing](docs/testing.md)。

| Path | Purpose |
| --- | --- |
| `extensions/<name>/src/` | 扩展源码。 |
| `extensions/<name>/__tests__/` | 测试、夹具和用户旅程。 |
| `extensions/<name>/dist/` | 生成的运行产物，不提交。 |
| `themes/` | `codex-pi` 主题。 |
| `scripts/`、`test-support/` | 构建与验证脚本、共享测试支持及独立宿主环境。 |
| `.cursor/skills/` | 项目验证 skills。 |
| `docs/` | 测试、兼容性和维护说明。 |

`codex-search` 在仓库内单独维护和检查，不进入当前发布包或自动加载清单。

使用 `pnpm pack --pack-destination .scratch/release` 构建发布包。`prepack` 会重建五个扩展；包内包含编译产物、主题、双语 README、许可证和来源说明，不包含测试与日志。

## License and attribution

本地代码采用 [MIT 许可证](LICENSE)。随包组件还包含 Apache-2.0、MPL-2.0 和 Unicode-3.0 许可内容，package metadata 声明为 `(MIT AND Apache-2.0 AND MPL-2.0 AND Unicode-3.0)`。

Codex Compact 基于 `@yeungkc/pi-codex-compact` 0.0.6，Fast Mode 基于 `pi-openai-fast-mode` 0.3.0。导入版本、上游来源和本地改动分别记录在 [Codex Compact 来源说明](extensions/codex-compact/UPSTREAM.md)和 [Fast Mode 来源说明](extensions/openai-fast-mode/UPSTREAM.md)。
