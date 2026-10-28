# Repository Commit Policy

## Scope

本 policy 约束 agent 执行的本地 Git 提交，包括普通提交和 amend。是否允许提交、如何拆分提交以及历史改写权限，遵循用户授权和其他适用规则。提交信息另按 `commit-message-policy.md` 执行。

## Check Target

检查本次实际写入提交的路径及暂存版本，包括新增、修改、重命名和复制的文件。读取暂存内容，不能以工作区副本代替；密钥和敏感信息检查应覆盖这些文件的完整暂存内容，而不只检查新增行。删除的内容不作为本次新增泄露阻断项。

若提交命令会改变提交集合，先确定实际提交集合，再检查；尚未检查的内容不得随提交命令自动纳入。检查后暂存内容发生变化时，重新检查受影响的项目。已有跟踪状态不构成豁免。

## Core Gates

| Gate | Check | Action |
| --- | --- | --- |
| Secrets and credentials | API key、token、私钥、密码、会话凭据、含认证信息的连接串及真实认证配置 | 命中后暂停提交；确认真实凭据时阻止提交并移除或替换，确认误报后按例外规则处理 |
| Personal and customer data | 真实身份信息、联系方式、地址、客户数据、会话记录和业务数据导出 | 未经明确授权纳入仓库的真实敏感信息阻止提交；无法判断是否真实或是否允许纳入时，暂停并询问 |
| Build and local artifacts | 构建输出、依赖副本、缓存、运行日志、临时文件、本机配置 | 默认阻止；仅允许仓库明确需要版本管理的具体文件或路径 |
| Conflict markers | 未解决的合并冲突标记 | 阻止提交；用于文档或测试的字面示例按精确例外处理 |
| Large and opaque files | 单文件超过 5 MiB，或新增、修改的压缩包、数据库文件及其他无法完成内容检查的文件 | 暂停并确认用途、检查方式及是否应纳入版本管理；无法读取不等于检查通过 |

测试目录、示例文件和 `.env.example` 不自动免检。判断手机号、邮箱等内容时，结合字段、用途及数据来源区分真实数据、公开联系信息和虚构样本。

## Repository Configuration

### Execution and review

本仓库仅安装 agent 策略，未配置自动 Git hook 或自动密钥扫描器。以下检查由执行提交的 agent 完成；普通手工提交不会被本 policy 自动拦截。人工审查可能遗漏密钥，不得把完成审查报告为自动扫描通过。

1. 在仓库根目录用 `git diff --cached --name-status -z` 确认暂存变更，用 `git ls-files --stage -z` 获取对应文件的 mode、blob OID 和冲突 stage。按 NUL 分隔解析路径；非零 stage 表示冲突未解决，阻止提交。amend 还须核对相对于被替换提交的父提交的完整变更，不能只看 index 相对于 HEAD 的差异。
2. 对实际提交集合中新增、修改、重命名或复制的文件，用 `git cat-file blob` 读取各自 OID 的完整内容，用 `git cat-file -s` 获取字节数。逐文件审查凭据、个人或客户数据及冲突标记；检查测试、示例、配置、锁文件和补丁中携带的上下文，不因其用途而免检。符号链接审查目标，gitlink 或不可读内容暂停确认检查方法。
3. 密钥审查覆盖 token、私钥、密码、认证 header、含凭据 URL、连接串和认证配置。结合调用方式、数据来源判断示例是否虚构，并检查日志、截图、会话导出、图片和音频中的真实信息。关键词搜索只能辅助定位，不能代替完整内容和上下文审查。只报告路径、类别和脱敏位置，不回显凭据。
4. 检查路径、文件大小和下述例外；无法检查的压缩包、数据库或二进制暂停确认。对已列明的媒体例外，完成对应来源与内容核验后可继续；哈希匹配本身不能证明内容安全。
5. 完成已有验证，再核对暂存 OID 与实际提交集合未变化。部分暂存时确认测试覆盖的内容与暂存版本一致；若不一致，验证暂存快照，不自动纳入工作区其他修改。不得用 `git commit -a` 等方式带入未检查的内容。

### Paths and size

路径按 Git 中的仓库相对路径、区分大小写匹配。目录名规则匹配任意层级的完整目录段；明确标注根目录的规则只匹配根目录。文件名规则匹配任意层级的 basename。

默认阻止以下本地产物进入提交，必要例外只按下一节的具体范围处理：

- 任意层级目录：`node_modules/`、`dist/`、`build/`、`target/`、`coverage/`、`__pycache__/`、`.pytest_cache/`、`.mypy_cache/`、`.ruff_cache/`、`.cache/`、`.pnpm-store/`、`.tmp/`、`.scratch/`、`handoff/`、`prototypes/`。
- 根目录 `.pi/`；根目录 `adventure/evidence/` 下递归匹配的 `*.json`、`*.jsonl`、`*.ansi` 原始运行证据。其他位置的运行日志、真实会话或导出数据也须按内容门禁检查。
- 任意层级文件名：`*.tsbuildinfo`、`*.pyc`、`*.pyo`、`*.pyd`、`*.log`、`*.tgz`、`.DS_Store`、`DECISIONS.md`、`.env`、`.env.*`。`.env.example` 仅允许无真实凭据的模板内容。

`git ls-files --cached --ignored --exclude-standard` 必须无输出，沿用现有 CI 要求。忽略状态不是内容安全证明；新增例外如与 ignore 或 CI 冲突，须先明确批准并同步规则。发布包中的 `extensions/*/dist/` 仍是生成产物，不提交 Git。

单文件大小严格大于 5 MiB，即 5,242,880 字节时暂停，确认用途、检查方式和纳入版本管理的必要性。此阈值也适用于以下例外，没有目录级大小豁免。

### Maintained assets

以下范围有仓库文档、构建或安装配置支持。批准本 policy 后，它们仅豁免默认的产物、依赖副本或不透明格式阻断；仍检查敏感内容、来源、大小及变更用途：

- `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`patches/*.patch`：复现依赖与独立宿主补丁所需。核对补丁依赖声明和补丁内容，执行 `pnpm run host:check`；不包含全局 Pi 安装副本。
- `extensions/codex-compact/src/media/decoder.wasm`、`manifest.json`、`Cargo.lock`，以及该 media 目录的 `third-party/dependencies.json`、`third-party/licenses/`、`third-party/rust/`、`third-party/source/*.crate`：按 `extensions/codex-compact/src/media/README.md` 保留预编译解码器、归属、许可证和对应源码。执行 `pnpm run codex-compact:media:verify`，核对暂存资产与 manifest、依赖来源及校验和。新增或替换 crate 还须审查归档内容，不能只同步改写哈希；解码器变更按固定工具链重建并验证相关行为。`target/` 和 `dist/` 不在例外内。
- `extensions/codex-compact/__tests__/fixtures/media/` 中 README 描述的 `patch-boundary.{png,jpg,gif,webp,tiff,bmp}`、`large-original.png`、`one-second.{wav,mp3,m4a,webm,ogg}`、`extreme-duration.m4a`：允许按 README 合成的图片、静音和异常时长样本。核对来源、解码内容及元数据，变更后按该 README 更新参考向量并验证；不允许用真实用户图片或录音替换后沿用例外。

其他持久例外：无。测试目录、第三方目录和文档目录均没有整目录的敏感信息豁免。

### Existing verification

继续遵循根目录 `AGENTS.md`：完成前运行 `pnpm run check`，受影响的交互或宿主行为按 `docs/testing.md` 和对应验证 skill 验收。测试使用 `pnpm test` 的隔离入口。验证记录须说明命令、结果及对应内容，不能把工作区测试结果直接用于不同的暂存版本。

保留 `.gitattributes` 的文本与二进制规则、现有 CI 和发布包检查。此次不增加格式化工具、不增加独立全量测试流程，也不将现有完整检查重复挂入 hook。

## Exceptions

例外应限定到具体路径、规则或命中指纹，并记录理由、批准依据及适用范围。区分已确认的扫描误报、虚构测试数据、公开信息和确需版本管理的产物。真实有效的凭据应移出提交，不能以白名单方式保留。

一次提交的批准仅对本次已检查的内容有效。持久例外须明确获准后写入仓库配置；不因一次误报放行整个目录、关闭整类扫描或扩大已有白名单。

## Failure Handling

任一必需检查失败、工具缺失、超时或内容不可读时，报告未完成的检查并暂停提交。AFK 任务同样执行门禁；需要确认而无人回复时保留工作成果，报告阻断项。

报告使用文件路径、规则、必要的位置和脱敏说明，不输出完整密钥或个人信息。扫描报告也须脱敏，临时文件在检查完成后清理。

由 agent 提出修复建议；修复须遵循任务授权。门禁本身不自动删除用户文件、重置暂存区、修改 Git 历史或扩大提交范围。不得自行使用跳过 hooks、禁用扫描或改写配置的方式绕过失败。

## Completion

提交前确认所有必需检查完成、阻断项已解决、例外有依据，且检查结果仍对应实际提交内容。完成检查不等于获得提交授权，也不证明整个 Git 历史无敏感信息。
