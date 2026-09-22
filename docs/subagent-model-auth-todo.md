# Subagent model and authentication fix

## User Visible Changes

- 显式填写 `subagent_spawn.model` 时必须使用 `provider/model`，例如 `deepseek/deepseek-flash`。短名称、缺少 provider 或 model 的输入，以及不存在的完整模型名，在创建子进程前返回明确的参数错误，不再以鉴权失败呈现。
- 省略 `model` 时继续继承父模型；内部使用完整名称。父会话没有可继承模型时，在启动前明确报错。
- 使用有效完整名称或默认继承时，子代理按实际选中的 provider 获取父进程中的对应环境凭据，保留 Pi 既有凭据优先级。

## Todo

- [x] 在 `extensions/subagent/src/tools.ts` 的 spawn 入口统一校验模型并确认存在性，再调用 manager。显式参数按第一个 `/` 分隔 provider 与 model，二者均须非空；model ID 本身可以包含 `/`。仅接受完整模型引用，不支持短名称补全、模糊匹配或歧义回退。省略参数时使用父模型生成完整引用。实施前核对 Pi 0.86.0 已安装源码及对应文档中的精确查询接口。
- [x] 将确认后的模型信息贯穿 `tools.ts`、`manager.ts`、`index.ts` 和 `auth-environment.ts`，使子进程启动参数与凭据选择使用同一 provider/model。消除短名称导致凭据传递静默跳过的路径；保留 `env -i`、所选 provider 的环境变量筛选及现有私有临时文件通道。每次 spawn 只解析一次模型，不为存在性检查增加网络请求、凭据刷新或重复扫描。
- [x] 更新工具参数约束、说明和 README 中的调用示例，明确完整名称要求及省略时的继承行为。格式错误提示使用英文并给出 `provider/model` 示例；不存在的模型与缺少可继承模型分别给出明确错误。

## How To Test

- 执行顺序：先在对应 `__tests__/` 中写出失败测试，再实现并整理代码。复用现有工具、鉴权、manager 和 production integration 测试设施，不调用付费模型服务。
- 参数校验：`deepseek-flash`、空字符串、`/deepseek-flash`、`deepseek/` 均在启动前被拒绝；格式错误包含完整名称示例。未知 provider、未知 model 返回不存在错误。合法的 `provider/org/model` 通过精确存在性检查，避免把模型 ID 内的 `/` 错当成非法字符。
- 继承与选择：`deepseek/deepseek-flash` 成功选择 DeepSeek；省略参数时得到与父模型一致的完整名称；无父模型时明确失败。父子选择不同 provider 时，启动参数和传递凭据都对应子模型。模型查询不得仅以“有无凭据”判断模型是否存在，缺凭据仍走原有鉴权失败路径。
- 副作用与成本：拒绝无效参数时，manager 启动、容量预留、目录创建、凭据文件写入和 tmux 调用均未发生。有效请求仅执行一次模型解析，并将结果复用于启动与凭据选择；用调用计数检出重复解析，不用脆弱的耗时阈值。
- 鉴权回归：验证仅环境凭据、仅存储凭据、两者都有、两者都没有四种情况；两者都有时保持 Pi 原有优先级，无凭据时仍返回绑定当前投递的鉴权拒绝。其他 provider 的密钥不传递，旧 tmux server 的环境不重新混入。
- 生产链路：运行显式启用的真实 Pi/tmux 离线 integration，用完整名称和省略模型两种方式完成 spawn 与离线回复，并确认短名称被提前拒绝。更新 fixture，使模型存在性检查经过真实或等效的 registry。检查命令参数、session、管理状态和日志不含测试密钥，临时凭据文件正常清理。
- 最终验证：运行定向测试及 `pnpm run check`，要求类型检查、测试、构建和发布包校验通过。生产 integration 默认跳过，须另行显式执行并记录结果。确认本次启动的进程、tmux socket 和监听端口已清理；仅由构建生成 `dist/`，不手改产物。

## Notes

- 已定位现场：session `01a0c7ca-5d7e-7097-a80b-a65b0d6baa1a`，delivery `96419296101c`，调用传入 `model: "deepseek-flash"`。修复前 `providerEnvironment()` 对不含 `/` 的参数返回空环境。
- `91745a5` 引入 `env -i` 以清除旧 tmux server 环境；`2628240` 补上内置 provider 的环境凭据传递，但遗漏短名称。此次按已确认方案拒绝短名称，不实现自动补全。
- 不修改用户认证配置，不移除环境隔离，不扩展自定义 provider 或 AWS/ADC 等既有未支持的凭据继承范围。完整名称存在性校验不等于新增这些鉴权能力。
- 2026-09-22 已完成实施与验收。保留工作区已有改动，未创建 commit。

## Verification Results

- 接口依据：已安装的 Pi 0.86.0 `ModelRegistry.find(provider, modelId)` 经 `ModelRuntime.getModel()` 查询当前模型目录；使用同步精确查询，不进行鉴权或网络请求。Context7 提供了同名接口文档，版本行为以本地 0.86.0 源码为准。
- Red → Green：格式错误、未知模型、缺少父模型先出现预期行为失败，随后通过；完整名称、包含斜杠的模型 ID、默认继承均只查询一次 registry，并传递选中的结构化模型身份。参数预处理测试先失败，再接入格式提示后通过，避免调用方只得到通用 schema 错误。
- 定向测试：tools、index、manager、auth-environment 共 50 项通过；生产源码入口的 5 项鉴权离线集成测试通过。
- `pnpm run check`：类型检查、2407 项测试、构建、发布包检查全部通过；12 项默认跳过，其中生产离线集成测试已单独显式执行。
- 构建产物集成：以下命令 11/11 通过，覆盖完整名称、继承、凭据优先级、无凭据拒绝、无效输入无启动副作用，以及既有延迟启动、fish 和生命周期场景。

```sh
PI_SUBAGENT_ISOLATED_INTEGRATION=1 PI_SUBAGENT_FIXTURE_DIST=1 \
PI_SUBAGENT_TEST_CLI="$PWD/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" \
pnpm exec vitest run extensions/subagent/__tests__/production-integration.test.ts extensions/subagent/__tests__/isolated-integration.test.ts
```

- 运行环境：Node.js 22.22.2、pnpm 11.9.0、Pi 0.86.0。离线 fixture 禁止网络模型请求；未调用真实付费模型服务，未改动用户认证配置。
- 清理：集成测试记录的进程均已退出，独立 tmux socket 已不可用，临时测试目录与凭据文件已移除；没有遗留由这些进程占用的监听端口。`git diff --check` 通过。
