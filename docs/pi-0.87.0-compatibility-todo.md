# Pi 0.87.0 compatibility todo

## Understanding

把本仓库的 Pi 扩展及版本绑定升级到 0.87.0，修复 `codex-compact` 在新版 `context_edit` 下重放旧内容或取消请求的问题。依据和已复现路径见 [compatibility research](pi-0.87.0-upstream-research.md)。保留工作区已有的文档删除，不手工修改 `dist/`。

## User Visible Changes

- 升级后，已被 `context_edit` 省略或替换的消息不会再次进入模型请求；含有效 Codex 检查点的会话继续请求时，不会仅因插件读取旧历史而报 `history_prefix_mismatch`。
- 切换到非 Codex 模型并恢复较早历史时，模型看到应用编辑后的内容。若编辑触及无法安全重建的加密检查点，扩展明确拒绝使用旧检查点。
- 安装及发布声明锁定 Pi 0.87.0；有效图片仍进入请求，无效图片遵循 Pi 0.87.0 的省略与提示行为。

## Todo

### 1. Locate

- [x] 核对 Pi 0.87.0 的 `buildSessionProjection()`、`context` 和 `context_with_system` 语义，确定如何从完整原始分支恢复历史且保留 `context_edit` 的最后一次编辑，以及检查点前编辑的安全处理方式。
- [x] 逐一标记 `codex-compact` 中读取 `getBranch()` 的用途，区分原始记录、模型可见上下文、压缩输入、前缀校验和 token 估算；确定需要共用的投影结果及源 entry ID。

### 2. Implement

- [x] 在 `codex-compact/src/` 集中构造模型可见历史，使请求、压缩、前缀校验和 token 估算一致应用省略与内容替换；恢复完整历史时保留检查点与源 entry 的对应关系，避免按每条消息重复扫描整段分支。
- [x] 调整 `context` 恢复和检查点处理：切换模型不重放被编辑的内容；检查点之后的编辑可继续请求；检查点之前的编辑先使旧检查点失效，再安全重建或明确拒绝，不能向模型发送含旧内容的请求。
- [x] 将 `package.json` 的 Pi peer/dev 依赖、`pnpm-workspace.yaml` 的相关版本例外和 `pnpm-lock.yaml` 一起更新到 0.87.0，继续使用现有 Node 与 pnpm 要求。
- [x] 更新依赖 0.86.0 版本断言的质量验证脚本和测试，检查其他版本标签是否属于历史证据；把 `skill-mentions` 测试中的假 PNG 改为可验证的真实小图，并更新 README 中当前版本的说明。
- [x] 核对发布清单里已删除文档的用途，修正 `package.json`、`scripts/check-package.mjs` 和 README 的失效引用，使包检查与实际发布内容一致；不恢复用户已删除的无关文档。

## How To Test

- 调查验证：在 0.87.0 环境中先写失败用例，使用真实 `SessionManager` 生成原始 entry、检查点及 `context_edit`，并记录当前插件的取消信号和最终请求内容。单独核对检查点前、检查点后、`replacement: null` 和内容替换的投影结果，确定安全重建条件。
- 目标行为：用真实 Pi session 发起后续请求，让 Pi 生成模型输入，经 `codex-compact` 的 `context`、`before_provider_request` 与压缩路径处理，再捕获送往离线 provider 的最终 payload。断言旧内容不出现、替换内容出现、可用检查点仍生效、前缀校验保留；切换非 Codex 模型后同样检查最终 payload。覆盖 user、assistant、tool-result 的编辑，以及 Pi 自动 length/overflow 恢复产生的 omission。保留原始历史供会话展示，不用单独构造的中间 payload 代替完整路径。
- 回归：重开 0.86.0 创建的会话，验证无 `context_edit` 的已有检查点、模型切换、手动与自动压缩、错误和取消行为。有效 PNG 仍在模型输入中；无效图片测试断言 Pi 的提示文本。旧测试若以原始历史等同模型上下文为前提，修正该预期。
- 性能验收：以不同长度的分支和多个 edit 检查投影调用次数及扫描范围。一次请求只构造所需的历史视图，不在逐条转换时重新扫描完整分支；压缩和计数复用同次请求的投影快照，并在异步等待后重新核验会话版本。
- 最终验证：运行 `pnpm install --frozen-lockfile --ignore-scripts`、受影响扩展的定向测试、`pnpm run check` 和 `pnpm pack --dry-run`。预期类型检查、测试、构建、发布包校验均通过；核对 CI 在 macOS、Linux、Windows 上的结果。若仍有失败，区分升级引入的问题与既有文档删除，并保持相应 Todo 未完成。

## Notes

- Pi 0.87.0 的三个直接依赖仍要求 Node `>=22.19.0`，现有 CI 的 Node 22.19.0 符合要求；无需以升级工具链代替兼容修复。
- 先前隔离复测中，版本断言、无效 PNG 和临时 tmux socket 路径造成的失败已分别定位。正式验收应使用足够短的隔离路径，不把路径长度误判为 Pi 语义故障。

## Verification result

2026-09-23 已完成代码、依赖和发布清单升级。使用真实 `SessionManager` 的测试覆盖检查点前后编辑、重复替换、省略、切换模型，以及 user、assistant、tool-result 的投影。`pnpm install --frozen-lockfile --ignore-scripts`、`pnpm run check`、`pnpm pack --dry-run` 均通过；全量测试 2425 通过、12 跳过。当前尚未执行付费在线模型请求和跨平台 CI；这两项不属于本地通过结论。
