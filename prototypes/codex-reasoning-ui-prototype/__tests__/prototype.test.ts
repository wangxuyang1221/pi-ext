// PROTOTYPE: Public host integration and deterministic rendering-cost contracts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, ToolExecutionComponent, initTheme, type Theme, type ExtensionAPI, type MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import reasoningLab from "../src/index.js";
import { ReasoningStatus, extractTitle, historyMarkdown } from "../src/status.js";
import { prototypeSettings } from "../src/settings.js";
import { CALLS, MODEL, PROMPTS, PROVIDER, getScene, isFixtureCall, streamFixture, thinkingFor } from "../src/fixture.js";

initTheme("dark");
const loadedVariant = process.env.PI_REASONING_LAB_VARIANT;
const theme = { name: "codex-pi", getFgAnsi: () => "\x1b[90m", fg: (_color: string, text: string) => `\x1b[90m${text}\x1b[39m` } as unknown as Theme;
const model: Model<"openai-responses"> = {
  id: MODEL, name: MODEL, api: "openai-responses", provider: PROVIDER, baseUrl: "http://127.0.0.1:1",
  reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const context = (prompt: string = PROMPTS.standard): Context => ({ messages: [{ role: "user", content: prompt, timestamp: 0 }] });
const assistant = (text: string): AssistantMessage => ({
  role: "assistant", content: [{ type: "thinking", thinking: text }], api: model.api, provider: PROVIDER, model: MODEL,
  timestamp: 0, stopReason: "stop",
  usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } },
});
function harness(variant: string) {
  process.env.PI_REASONING_LAB_VARIANT = variant;
  const transformers: MarkdownTransformer[] = [];
  const events = new Map<string, Array<(...args: any[]) => any>>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  let provider: any;
  reasoningLab({
    getThinkingLevel: () => "medium",
    getSessionName: () => undefined,
    setActiveTools() {},
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerMarkdownTransformer: (transformer: MarkdownTransformer) => transformers.push(transformer),
    registerProvider: (_name: string, value: any) => { provider = value; },
    on: (name: string, handler: (...args: any[]) => any) => events.set(name, [...events.get(name) ?? [], handler]),
  } as unknown as ExtensionAPI);
  return { transformers, events, tools, commands, provider };
}

test("status changes request one render and stable frames reuse their line cache", () => {
  let requests = 0;
  const status = new ReasoningStatus(() => theme, () => requests++);
  assert.deepEqual(status.render(80), []);
  status.setTitle("Computing the ratio");
  status.setTitle("Computing   the ratio");
  assert.equal(requests, 1);
  const first = status.render(80);
  for (let i = 0; i < 100; i++) assert.equal(status.render(80), first);
  assert.equal(requests, 1);
  const h = harness(loadedVariant === "production" ? "production" : "proposed");
  const tool = new ToolExecutionComponent("read", "alignment-read", { path: "metrics.json" }, { showImages: false },
    h.tools.get("read"), { requestRender() {} } as any, process.cwd());
  tool.setArgsComplete();
  tool.updateResult({ content: [{ type: "text", text: "fixture" }], isError: false });
  const toolTitle = tool.render(80).map(stripTerminalSequences).find(line => line.includes("Read metrics.json"))!;
  const statusTitle = stripTerminalSequences(first[0]!);
  assert.equal(statusTitle.indexOf("•"), toolTitle.indexOf("✓"), "Status marker must align with the tool icon");
  assert.equal(statusTitle.indexOf("Computing"), toolTitle.indexOf("Read"), "Status text must align with the tool title");
  assert.equal(statusTitle, "• Computing the ratio");
  assert.ok(!first[0]!.includes("\x1b[3m"));
  status.setTitle("");
  assert.deepEqual(status.render(80), []);
  assert.equal(requests, 2);
});

test("status keeps one content row and an unstyled bottom gap on resize", () => {
  const status = new ReasoningStatus(() => theme, () => {});
  status.setTitle("检查中英文与 emoji 👩🏽‍💻 é 混排 " + "long title ".repeat(20));
  for (const width of [0, 1, 2, 3, 10, 30, 60, 120, 60, 120]) {
    const rows = status.render(width);
    assert.equal(rows.length, width ? 2 : 0);
    if (width > 0) assert.equal(rows[1], "", "Gap must not inherit the editor background");
    for (const row of rows) assert.ok(visibleWidth(row) <= width);
  }
  status.invalidate();
  assert.equal(status.render(120).length, 2);
  assert.equal(status.render(120)[1], "");
});

test("title extraction waits for closed markdown and does not track body deltas", () => {
  assert.equal(extractTitle("**Comp"), undefined);
  assert.equal(extractTitle("**Computing the ratio**\n\nbody"), "Computing the ratio");
  assert.equal(extractTitle("**Computing the ratio**\n\nbody continued"), "Computing the ratio");
  assert.equal(extractTitle("**我现在\n补齐报告**"), "我现在 补齐报告");
});

test("completed history preserves paragraphs rather than truncating the latest one", () => {
  assert.equal(historyMarkdown("**Only title**"), "• **Only title**");
  assert.equal(historyMarkdown("**Title**\n\nBody\n\nLast"), "• Body\n\nLast");
  assert.equal(historyMarkdown(""), "");
  assert.equal(historyMarkdown("**Readi"), "• Readi");
  assert.equal(historyMarkdown("**"), "");
  const long = historyMarkdown(thinkingFor(3, true));
  assert.ok(long.includes("这一段故意"));
  assert.ok(long.includes("这是最后一段"));
  assert.ok(!long.includes("`•`"));
});

test("real Pi thinking component hides streaming and renders completed multiline history", () => {
  const h = harness(loadedVariant === "production" ? "production" : "proposed");
  const message = assistant(thinkingFor(3, true));
  const component = new AssistantMessageComponent(message, false, undefined, "Thinking...",
    prototypeSettings(loadedVariant === "production" ? "production" : "proposed").outputPad, h.transformers);
  component.updateContent(message, true);
  assert.equal(stripTerminalSequences(component.render(60).join("\n")).trim(), "");
  component.updateContent(message, false);
  for (const width of [30, 60, 120]) {
    const lines = component.render(width);
    const text = stripTerminalSequences(lines.join("\n"));
    assert.ok(text.includes("English"));
    assert.ok(text.includes("最后一段"));
    assert.ok(lines.length > 2);
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
  }
  assert.equal(h.transformers.length, loadedVariant === "production" ? 1 : 2, "Production must register without the prototype transformer wrapper");
  assert.equal(h.events.has("agent_start"), loadedVariant === "production");
  assert.equal(h.tools.get("bash").renderShell, "self");
  assert.ok(h.tools.get("write").execute);
  assert.ok(h.commands.has("demo"));
});

if (loadedVariant !== "production") test("immutable comparison preserves old streaming thinking and title animation", () => {
  const h = harness("current");
  const message = assistant("**Only title**");
  const component = new AssistantMessageComponent(message, false, undefined, "Thinking...", 1, h.transformers);
  component.updateContent(message, true);
  assert.match(stripTerminalSequences(component.render(60).join("\n")), /• Only title/u);
  assert.ok(h.events.has("agent_start"));
});

if (loadedVariant === "production") test("production lifecycle installs a static widget and clears it after settlement and shutdown", async () => {
  const h = harness("production");
  const widgets = new Map<string, any>();
  let requests = 0;
  const ctx = { mode: "tui", cwd: "/fixture", model, isIdle: () => true, sessionManager: { buildContextEntries: () => [] }, ui: {
    theme, setHeader() {}, setFooter() {}, setEditorComponent() {}, setTitle() {}, setStatus() {},
    setWorkingVisible() {}, setWorkingIndicator() {},
    setWidget(key: string, factory: any) {
      if (factory) widgets.set(key, factory({ requestRender: () => requests++ }, theme));
      else widgets.delete(key);
    },
  } };
  const emit = async (name: string, event: any = {}) => {
    for (const handler of h.events.get(name) ?? []) await handler({ type: name, ...event }, ctx);
  };
  await emit("session_start", { reason: "startup" });
  try {
    await emit("agent_start");
    const message = assistant("**Production title**");
    await emit("message_start", { message });
    const status = widgets.get("codex-ui-reasoning");
    assert.ok(status);
    assert.deepEqual(status.render(80), [], "No generic status or gap before a model title");
    await emit("message_update", { message, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "**Production title**" } });
    assert.deepEqual(status.render(80).map(stripTerminalSequences), ["• Production title", ""]);
    const previous = requests;
    for (let index = 0; index < 100; index++) status.render(80);
    assert.equal(requests, previous);
    await emit("message_update", { message, assistantMessageEvent: { type: "text_start", contentIndex: 1 } });
    assert.deepEqual(status.render(80), [], "Reply output must remove the title and gap");
    await emit("tool_execution_start", { toolCallId: "fixture-read", toolName: "read" });
    assert.deepEqual(status.render(80), [], "Tools must not install a generic status");
    await emit("agent_settled");
    assert.deepEqual(status.render(80), []);
  } finally { await emit("session_shutdown", { reason: "quit" }); }
  assert.ok(!widgets.has("codex-ui-reasoning"));
});

test("proposed lifecycle uses English UI copy while preserving provider titles verbatim", async () => {
  const h = harness("proposed");
  const widgets = new Map<string, any>();
  const ctx = { mode: "tui", cwd: "/fixture", model, isIdle: () => true, sessionManager: { buildContextEntries: () => [] }, ui: {
    theme, setHeader() {}, setFooter() {}, setEditorComponent() {}, setTitle() {}, setStatus() {},
    setWorkingVisible() {}, setWorkingIndicator() {},
    setWidget(key: string, factory: any) {
      if (factory) widgets.set(key, factory({ requestRender() {} }, theme));
      else widgets.delete(key);
    },
  } };
  const emit = async (name: string, event: any = {}) => {
    for (const handler of h.events.get(name) ?? []) await handler({ type: name, ...event }, ctx);
  };
  await emit("session_start", { reason: "startup" });
  const status = widgets.get("reasoning-lab-status");
  const label = () => status.render(80).map(stripTerminalSequences);
  try {
    const message = assistant("**我核对资料文件**");
    await emit("message_start", { message });
    assert.deepEqual(label(), ["• Thinking", ""]);
    await emit("message_update", { message, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "**我核对资料文件**" } });
    assert.deepEqual(label(), ["• 我核对资料文件", ""], "Provider text must not be translated");
    await emit("message_update", { message, assistantMessageEvent: { type: "text_start", contentIndex: 1 } });
    assert.deepEqual(label(), ["• Preparing response", ""]);
    await emit("tool_execution_start", { toolCallId: "fixture-read", toolName: "read" });
    assert.deepEqual(label(), ["• Running read", ""]);
    await emit("agent_settled");
    assert.deepEqual(label(), []);
    assert.doesNotMatch(h.provider.models[0].name, /\p{Script=Han}/u);
    assert.doesNotMatch(h.commands.get("demo").description, /\p{Script=Han}/u);
    assert.doesNotMatch(widgets.get("reasoning-lab-help").render(160).join(""), /\p{Script=Han}/u);
  } finally { await emit("session_shutdown", { reason: "quit" }); }
});

test("profile history aligns its marker and text with real tool rows without altering message content", () => {
  const variant = loadedVariant === "production" ? "production" : "proposed";
  const h = harness(variant);
  const tool = new ToolExecutionComponent("read", "history-alignment-read", { path: "metrics.json" }, { showImages: false },
    h.tools.get("read"), { requestRender() {} } as any, process.cwd());
  tool.setArgsComplete();
  tool.updateResult({ content: [{ type: "text", text: "fixture" }], isError: false });
  const text = "**检查资料**\n\n我核对资料文件";
  const message = assistant(text);
  const component = new AssistantMessageComponent(message, false, undefined, "Thinking...",
    prototypeSettings(variant).outputPad, h.transformers);
  for (const width of [30, 60, 120, 60]) {
    const toolTitle = tool.render(width).map(stripTerminalSequences).find(line => line.includes("Read metrics.json"))!;
    const summary = component.render(width).map(stripTerminalSequences).find(line => line.includes("我核对资料文件"))!;
    assert.ok(summary, "Completed thinking must be visible");
    assert.equal(summary.indexOf("•"), toolTitle.indexOf("✓"), "History marker must align with the tool icon");
    assert.equal(summary.indexOf("我"), toolTitle.indexOf("Read"), "History text must align with the tool title");
    for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
  }
  assert.deepEqual(message, assistant(text), "Display alignment must not change persisted thinking");
  assert.equal(prototypeSettings("production").outputPad, 0, "Production must use the approved zero-padding profile");
  assert.equal(prototypeSettings("current").outputPad, 1, "Frozen comparison must retain its existing padding");
});

test("fixture allowlist rejects alternate paths, shell commands and extra arguments", () => {
  for (const call of CALLS) assert.ok(isFixtureCall(call.name, structuredClone(call.arguments)));
  assert.ok(!isFixtureCall("read", { path: "../metrics.json" }));
  assert.ok(!isFixtureCall("write", { path: "report.md", content: "other" }));
  assert.ok(!isFixtureCall("bash", { command: "rm -rf ." }));
  assert.ok(!isFixtureCall("read", { path: "metrics.json", offset: 1 }));
  assert.ok(!isFixtureCall("read", null));
});

test("fixture provider emits real thinking and tool events without HTTP", async () => {
  process.env.PI_REASONING_LAB_FAST = "1";
  const stream = streamFixture(model, context());
  const events = [];
  for await (const event of stream) events.push(event.type);
  const message = await stream.result();
  assert.equal(message.stopReason, "toolUse");
  assert.ok(events.includes("thinking_start"));
  assert.ok(events.includes("thinking_delta"));
  assert.ok(events.includes("thinking_end"));
  assert.ok(events.includes("toolcall_end"));
  assert.equal(events.at(-1), "done");
  assert.ok(message.content.some(block => block.type === "toolCall" && block.name === "read"));
});

test("cancellation ends the pending provider delay without producing a tool call", async () => {
  const controller = new AbortController();
  controller.abort();
  const stream = streamFixture(model, context(), { signal: controller.signal });
  const message = await stream.result();
  assert.equal(message.stopReason, "aborted");
  assert.ok(!message.content.some(block => block.type === "toolCall"));
});

test("replay starts a fresh fixture sequence after the most recent user message", () => {
  const ctx = context();
  const message = assistant("old reasoning");
  message.stopReason = "toolUse";
  ctx.messages.push(message, message);
  assert.equal(getScene(ctx).step, 2);
  ctx.messages.push({ role: "user", content: PROMPTS.long, timestamp: 1 });
  assert.deepEqual(getScene(ctx), { long: true, step: 0 });
});
