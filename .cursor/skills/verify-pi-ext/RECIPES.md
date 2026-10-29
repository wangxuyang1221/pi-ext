# Journey recipes

共享 `commands.py` 负责真实 CLI、PTY、配置、session、重开和证据收集。JSON recipe 表达场景，不需要另写临时 PTY 驱动。先读取目标 feature，再决定种子、操作和断言；正式场景已有专用 driver 时，优先使用共享 README 的 case。

## Entry points

从仓库根目录执行：

```bash
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs journey permissions --recipe .cursor/skills/verify-pi-ext/recipes/permissions-resume.json
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui permissions --recipe .cursor/skills/verify-pi-ext/recipes/permissions-resume.json
```

`journey` 自动执行动作并退出；`tui` 执行动作后交给操作员，最终输入 `/quit`。两者成功都要求人工按 feature 条件审查，并写 verdict.md。进程退出码只表示动作及显式断言完成。

## Launch configuration

| Field | Meaning |
| --- | --- |
| `extensions` | 附加扩展数组，可用仓库 extensions 下的名字，或仓库相对扩展文件路径；默认加载命令指定的扩展 |
| `provider` | 可选的仓库相对 provider 扩展路径；省略时使用 command-provider.ts |
| `providerName`, `model` | CLI 的 provider/model，默认 faux/faux-1 |
| `cliArgs` | 附加 CLI 参数数组，例如 `["--fullscreen", "--approve"]` |
| `env` | feature 的进程环境配置；HOME、agentDir、TMP、XDG 与证据路径保持外层隔离配置 |
| `settings` | 合并到隔离 agent/settings.json 的顶层字段 |
| `seed` | 启动前创建的文件数组，格式见下节 |
| `responses` | 内置 faux provider 的顺序响应计划，格式见下节 |
| `ready` | 启动就绪条件；默认等待 events.jsonl 的 ready 事件 |
| `timeoutSeconds` | 每次 wait 的上限，默认 30 秒；外层总上限为 15 分钟 |
| `rows`, `columns` | PTY 尺寸，默认 50×140 |
| `actions` | 顺序动作数组，格式见下节 |

字符串中的 `${root}`、`${repo}`、`${evidence}` 分别替换为本次 scratch、仓库和唯一证据目录。provider 与 seed.source 必须位于仓库内。provider 是受信任的本地扩展代码，应与生产扩展一起审查；recipe 不构成代码沙箱。

## Seeds and model responses

种子只能写到本次 scratch 内。三种文件来源如下：

```json
{
  "seed": [
    {"path": "home/.pi/example.json", "json": {"enabled": false}},
    {"path": "agent/skills/demo/SKILL.md", "text": "---\nname: demo\ndescription: Local fixture\n---\nDEMO_BODY\n"},
    {"path": "workspace/image.png", "source": "extensions/codex-compact/__tests__/fixtures/media/patch-boundary.png"}
  ],
  "responses": [
    {"toolCalls": [{"name": "write", "arguments": {"path": "proof.txt", "content": "expected\n"}}]},
    {"text": "Write completed"},
    {"error": "Synthetic service failure"}
  ]
}
```

每次真实模型请求消费一条响应，工具结果之后的请求也消费下一条。响应支持 text、toolCalls 和 error。cursor 在 scratch 中持久化，冷重开后继续消费后续响应。计划用完后恢复默认 faux 回复；无计划时保留 WRITE_PROOF 特例。

需要真实 adapter、流式取消、可控服务响应或自定义模型目录时，使用 `provider` 指向目标 skill 的正式 provider 扩展，并通过 seed/env 提供其配置。该扩展可把请求账本写入 `${root}/events.jsonl` 或 `${evidence}`。默认就绪记录格式为 `{"type":"ready"}`；采用其他记录或可见提示时，显式设置 ready。

## Actions and conditions

每个动作对象恰有一个键，按数组顺序执行。

| Action | Operation |
| --- | --- |
| `{"send":"/fast on"}` | 输入文本并按 Enter |
| `{"keys":["down","enter"]}` | 发送命名按键；支持 enter/escape/up/down/left/right/tab/ctrl-c/ctrl-d/ctrl-o/backspace |
| `{"bytes":"1b5b41"}` | 发送十六进制原始按键字节 |
| `{"wait":{"screenIncludes":"Saved"}}` | 泵送真实终端，直到条件满足或失败 |
| `{"expect":{"file":"workspace/proof.txt","text":"expected\n"}}` | 立即断言；适用于前一个 wait 已确认操作结束之后 |
| `{"snapshot":"after-save"}` | 保存当前真实画面 |
| `{"seed":[{"path":"workspace/state.txt","text":"v2"}]}` | 运行中更新种子并记录动作 |
| `{"capture":{"path":"agent/settings.json","as":"before-restart/settings.json"}}` | 将 scratch 内文件或目录复制到本次 evidence |
| `{"restart":{"resume":"latest"}}` | `/quit` 并等待零退出，重开本次最新 session |

restart 还支持 `resume` 为 scratch 内精确路径、附加 `cliArgs` 和新的 `ready`。不设置 resume 时新建会话。需要 quit 菜单操作时，在 restart 前按真实按键选好退出选项并等待 processExited；restart 自身不会替用户选择菜单。

条件对象中各项同时满足才算成功：

- `screenIncludes`、`screenExcludes` 接受字符串或字符串数组，匹配当前 pyte 画面。
  匹配范围包括弹出菜单背后的正文。筛选恢复会话时，等待目标选中行，例如 `› Target session`，再按 Enter；不要用整屏不含另一个会话正文作为筛选完成条件。选中后核对实际 session 身份、历史未被重写和续问上下文，才能证明恢复正确。
- `eventType` 指定 events.jsonl 的类型，`eventCount` 指定至少几条，默认 1；可用 `eventContains` 进一步匹配该事件的 JSON 字符串。计数涵盖本次 run 中所有重开进程。
- `file` 指定 scratch 内路径，默认要求存在；`exists:false` 验证不存在，`text` 精确比较文本，`json` 比较解析后的完整 JSON。
- `processExited:true` 验证当前 Pi 已退出。

等待 ready、settled 或特定请求之后，再核对文件和 session 身份。一次屏幕匹配不会自动证明冷恢复选中了正确会话；使用精确 session 路径、请求上下文和持久历史共同断言。跨会话工具引用、否定副作用或服务端采用情况仍需目标扩展的对应证据。

## Evidence and cleanup

每次 run 保存 recipe.json、journey.json、owners.json、terminal.ansi、响应计划和 cursor，以及隔离 home/agent/sessions/workspace。journey 记录所有启动、PID、动作、画面与模型事件。restart 共用同一 scratch，退出整个入口后才清理；旧 run 的证据不会被后续运行覆盖。

外层中断会先让 Python 完成 finally，回收独立 PTY 进程组并归档。无法确认进程停止或完整归档时，保留 scratch 和锁，并记录 failed。确认中断资源已回收不等于功能旅程通过。
