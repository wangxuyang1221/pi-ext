# Skill input API audit

## Result

Pi `0.86.0` 的公开扩展 API 足以让插件在输入框中间、后续行的 token 边界输入 `$` 时弹出 skill 候选，并把提交的引用转换成真正加载 skill 正文的请求。无需替换 codex-ui 的编辑器，也无需修改 Pi 才能解除“skill 只能在消息开头调用”的用户侧限制。

这不等于已经完成插件，也不代表所有位置都默认自动触发。`请用 $adventure` 可走现成触发逻辑；`请用$adventure` 中 `$` 紧邻普通汉字，默认编辑器不会弹出候选。后者是否需要支持，属于 [输入规则 Planning #5](https://github.com/wangxuyang1221/pi-ext/issues/5)，不是已确认行为。

## Version and sources

- 项目 `package.json` 和本 worktree 安装的 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui` 均为 `0.86.0`。
- 官方 tag `v0.86.0` 指向 [`ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`](https://github.com/earendil-works/pi/commit/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc)，通过 GitHub API 实际核验。
- Context7 `/earendil-works/pi` 返回了 `addAutocompleteProvider`、`input`、`getCommands` 的文档和示例，但未提供 `0.86.0` 版本化 ID，返回来源是 main。版本结论因此以发布包及 tag 源码为准。
- 已完整读取安装包 `docs/extensions.md`、`docs/tui.md`、`docs/skills.md`，以及 `github-issue-autocomplete.ts`、`input-transform.ts` 示例。
- 在线读取 [v0.86.0 官方补全示例](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/examples/extensions/github-issue-autocomplete.ts)，并通过 GitHub contents API 比对三份源码与已安装包 source map 的 `sourcesContent`，逐字节一致：

| Source | SHA-256 |
| --- | --- |
| `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | `01ebf39a2ce0b8939076fbd5cc78e9cad6f49f642a608cd3b2adb8d215e6c0f0` |
| `packages/coding-agent/src/core/agent-session.ts` | `3ea88a751cd830db66ae9348be9f8dfbd5218a01e74b445f3aee9fb87ad3e865` |
| `packages/tui/src/components/editor.ts` | `241695859d48f49c6aaba9b9cfc14c6cd28639c6c247adb4fe2c202a9e2c6e20` |

## Public integration points

### Skill inventory

`pi.getCommands()` 返回 extension、prompt 与 skill 三类 command。过滤 `source === "skill"` 后，可以取得名称 `skill:name`、描述和 `sourceInfo`。这是复用 Pi 已发现资源的入口，不必扫描另一套目录而偏离 Pi 的信任、去重和来源规则。

证据：[agent-session.ts 的 `getCommands`](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/src/core/agent-session.ts#L2685)，本地 `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2090-2110`。

注意，TUI 构建 slash 菜单时检查 `enableSkillCommands`，而 `getCommands()` 的 skill 列表没有同样的过滤。这意味着 `$` 是否跟随该设置，需要在输入规则中明确，不能认为两个列表天然相同。带 `disable-model-invocation` 的 skill 是显式选择的合理对象，不应仅因为它不进入默认模型提示就过滤它。最终策略尚未确认。

### Autocomplete composition

`ctx.ui.addAutocompleteProvider(factory)` 将 provider 叠加在原生 slash 与文件补全之上。provider 设置 `triggerCharacters: ["$"]`，按光标所在行和列返回匹配项，其他情形委托原 provider。

Pi 将所有 wrapper 的 trigger characters 合并，再把组合后的 provider 设置到默认编辑器与当前自定义编辑器。codex-ui 的 `CodexEditor` 继承 `CustomEditor`，没有覆盖 `setAutocompleteProvider`，所以可以直接共存。

证据：

- [扩展文档 Autocomplete providers](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/extensions.md#autocomplete-providers)。
- [interactive-mode.ts:754](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L754) 的 provider 合并，以及 [同文件:2514](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2514) 的公开 UI 方法绑定。
- [editor.ts:418](https://github.com/earendil-works/pi/blob/v0.86.0/packages/tui/src/components/editor.ts#L418) 读取 provider 的触发字符；[同文件:2338](https://github.com/earendil-works/pi/blob/v0.86.0/packages/tui/src/components/editor.ts#L2338) 扩充默认触发集。
- 项目 `extensions/codex-ui/src/components.ts:79` 与 `extensions/codex-ui/src/index.ts:137`。

补全 API 提供候选的 value、label、description 及插入处理，足以复用原生候选菜单。它不提供任意替换候选列表组件的 renderer；若后续希望彻底重绘候选菜单，需另核验编辑器定制成本。本次还没有确认这种要求。

### Activation is separate from completion

补全只插入文本，不能单独让 skill 正文进入模型。可以在公开 `input` 事件中识别用户引用，返回 `action: "transform"`。

单 skill 的最小候选路线是把 `请用 $adventure 帮我规划` 转为 `/skill:adventure 请用 $adventure 帮我规划`。原生链路随后读取 skill 文件、去掉 frontmatter、加入绝对路径和相对引用目录，构造 `<skill>` 内容。这个转换只证明可行性，并非最终输入表示或展示设计。

证据：[扩展文档 Input](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/extensions.md#input)、[agent-session.ts:1267-1336](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/src/core/agent-session.ts#L1267-L1336)、[原生 skill 展开:1481](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/src/core/agent-session.ts#L1481)。

原生 `_expandSkillCommand()` 只处理以 `/skill:` 开始的一条调用。它不递归展开多个 skill。多 skill 不应通过简单串联 slash 命令实现，见 [渲染调研](skill-rendering-api-audit.md)。需要在后续规划决定消息表示、注入次序和去重。

### Queue and attachment boundary

`input` 事件在 skill 展开及 steer/followUp 入队之前发生。`_runInputHandlers` 对只返回 text 的 transform 保留原 images。因此不用通过 `sendUserMessage()` 再投递一遍，就可以保留当前原生队列路径和图片。

源码证据：[agent-session.ts:1517-1532](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/src/core/agent-session.ts#L1517-L1532)。实验只使用替代队列接收端，没有实际启动模型，不能据此宣称完整流式 session 生命周期已通过。

## Executed probes

代码：[skill-input-feasibility.test.ts](../experiments/skill-input-feasibility.test.ts)。运行：

```bash
pnpm exec vitest run --config adventure/experiments/vitest.config.ts
```

结果：11 项通过。

- 原生 Editor 和项目真实 CodexEditor 均能在句子中间触发 `$ad` 候选，Tab 选中后保留光标之后的文本。
- 两种编辑器均能在后续行触发 `$` 候选。
- 两种编辑器经过 provider 包装后仍能使用原生 slash 补全。
- 不安装 provider 时，原生 Editor 不弹出 `$` 候选。
- `$` 紧邻普通汉字时，默认触发逻辑不弹出候选。
- 实际 Pi `_expandSkillCommand()` 验证 prefix-only 行为、读取文件正文、去掉 frontmatter 和保留用户任务。
- 实际 Pi `_queueUserInput()` 在替代 host 中验证 steer/followUp 两条路径都先 transform 再展开，并保留图片。

实验使用真实上游类和真实 codex-ui 编辑器；renderer、资源加载器及队列接收端使用受控替代对象。访问私有方法只用于核验上游当前行为，不是产品路线建议。第一次运行 9 项通过、2 项因测试资源加载器缺少 `getPrompts` 失败，补齐夹具后全部通过。这是实验夹具修正，不是产品缺陷的 Red/Green 记录。

未执行 PTY 视觉验收、完整 session 恢复、真实模型请求、生产插件生命周期测试。未批准任何具体候选菜单、用户可见文案、转义或多 skill 策略。

## Repository checks

已按要求安装依赖：`pnpm install --frozen-lockfile --ignore-scripts`。

执行 `pnpm run check`：类型检查通过；139 个测试文件通过、3 个跳过，1953 项测试通过、5 项跳过；1 个 suite 在收集阶段因基准仓库缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 失败。该缺失路径在基准 `28656ed` 未跟踪，主工作区也不存在，本次未修改相关代码。完整输出见 [check.log](check.log)。

随后单独执行 `pnpm run build`，通过，见 [build.log](build.log)。执行 `pnpm run package:check`，因缺少 `docs/goal-descendant-acceptance.md` 失败，见 [package-check.log](package-check.log)。两个问题与本次仅新增的规划证据和实验无关，未擅自扩大范围修复。后续产品交付前仍需处理或与用户明确这些基准缺口，不能声称全仓 check 已通过。
