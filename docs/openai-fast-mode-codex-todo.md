# OpenAI Codex Fast Mode todo

## User Visible Changes

- `/fast on` 对 `openai-codex` 的现有及未来模型请求 Fast，不再要求扩展逐个收录模型 ID。`/fast off` 保持不注入 Fast；其他 provider 的现有行为不变。
- 若某个 `openai-codex` 模型明确报错表示不支持 Fast，本次请求按原有错误流程结束；扩展显示英文提示：`Fast mode is not supported for openai-codex/<model>. This request failed. Retry to use standard mode for this model in this session.` 此后本会话对该模型不再请求 Fast，切换到其他模型仍可请求 Fast。
- footer 的 `fast` 仍表示扩展对当前模型**请求** Fast，不代表服务端确认使用 Fast；被本会话排除的模型不再显示该状态。

## Todo

- [x] 核对 Pi 0.87.0 中 `before_provider_request`、`message_end` 的实际调用顺序与最终错误内容，确定如何把明确的 Fast 不支持错误归属到对应的 `openai-codex` 模型；如果仅凭错误文本无法可靠识别，就不自动排除模糊错误。
- [x] 将 `openai-codex` 的匹配从固定模型名单改为 provider 规则，使新模型无需改默认配置即可请求 Fast，同时保留全局开关、现有 `openai` 行为及既有配置的读取兼容性。
- [x] 为明确不支持 Fast 的错误加入会话内按模型 ID 隔离的排除状态，并更新英文通知与 footer；只影响后续请求，不增加扩展层的自动重发、持久化排除或过期机制。
- [x] 更新 `README.md` 的匹配规则、失败提示和 footer 含义，不再把 `openai-codex` 描述为依赖精确模型名单。

## How To Test

- 先写失败测试：`/fast on` 时，`openai-codex/gpt-6-sol`、`gpt-6-luna` 和一个测试用未来模型都应注入 `service_tier` 并显示 `fast`；`/fast off` 不注入。`openai` 既有模型和非 OpenAI provider 的行为保持原样。
- 通过扩展注册的生产事件路径测试失败处理：请求注入 Fast 后产生与该模型关联的明确不支持错误，验证本次保留错误结果、只通知一次、footer 清除，后续对该模型不再注入；其他模型仍注入，新会话重新尝试。限流、网络故障及不含明确 Fast 不支持信息的 400 错误不得触发排除。若 Pi 的事件无法携带足够的模型或错误信息，记录该限制，不用宽松的字符串匹配冒充可靠识别。
- 验证每个请求的匹配与排除查询不需要遍历整个模型目录、不发网络探测、不读写配置文件；会话内的排除状态使用按模型 ID 索引的集合。
- 运行 `pnpm run check`，确认类型检查、测试、构建及发布包校验通过。

验收结果：新模型匹配、默认名单清理、会话内排除及结构化错误码识别均先出现预期失败，再通过相应测试。真实 Pi 0.87.0 宿主的离线 Codex SSE 用例确认了事件顺序、英文提示和后续请求不带 Fast。`pnpm run check` 通过：2437 个测试通过，12 个按仓库设置跳过；类型检查、构建及发布包校验通过。

## Notes

- `after_provider_response` 只暴露状态码和响应头，当前 `message_end` 不暴露服务端实际的 `service_tier`。本次不增加“已确认 Fast”显示。
- OpenAI 不保证每个未来 GPT 模型都支持 Fast，因此首次尝试仍可能失败；本次不承诺预先判断支持情况。
- 不修改工作目录外的 Pi 用户配置，也不通过官方 Codex CLI 的 `/fast` 或 `config.toml` 代替 Pi 扩展实现。
