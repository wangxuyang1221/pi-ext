import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import codexUi from "../src/index.js";
import { reasoningPipeline } from "./fixtures/reasoning-pipeline.js";
import { ReasoningStatus } from "../src/reasoning-status.js";
import { ToolExecutionComponent, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";

const statusText = (pipeline: Awaited<ReturnType<typeof reasoningPipeline>>) =>
  stripTerminalSequences(pipeline.widgets.get("codex-ui-reasoning")!.render(120).join("\n")).trim();

test("incremental thinking titles do not repeatedly match the accumulated body", async () => {
  const pipeline = await reasoningPipeline(codexUi, process.cwd());
  const original = String.prototype.match;
  let matchedCharacters = 0;
  const match = vi.spyOn(String.prototype, "match").mockImplementation(function (this: string, expression: RegExp) {
    if (expression.source === /\*\*([^*]+)\*\*/u.source) matchedCharacters += this.length;
    return original.call(this, expression);
  });
  try {
    await pipeline.begin();
    let text = "";
    for (const delta of [...Array<string>(32).fill("plain body ".repeat(100)), "*", "*Closed", " title*", "*"]) {
      text += delta;
      await pipeline.update(text, delta);
    }
    assert.equal(statusText(pipeline), "• Closed title");
    assert.ok(matchedCharacters <= text.length * 2, `Matched ${matchedCharacters} characters for ${text.length} input characters`);
    const previous = pipeline.stats();
    for (let index = 0; index < 100; index++) {
      text += " body";
      await pipeline.update(text, " body");
    }
    assert.equal(pipeline.stats().requests - previous.requests, 100, "Only the host update may request rendering");
    assert.equal(pipeline.stats().widgetInstalls, 1);
  } finally { match.mockRestore(); await pipeline.dispose(); }
});

test("status shows only model titles and removes its gap during text and tool phases", async () => {
  const pipeline = await reasoningPipeline(codexUi, process.cwd());
  const hidden = () => assert.deepEqual(pipeline.widgets.get("codex-ui-reasoning")!.render(120), []);
  try {
    for (const type of ["text_start", "text_delta", "toolcall_start"]) {
      const message = await pipeline.begin();
      hidden();
      const requests = pipeline.stats().requests;
      await pipeline.update("No title yet", "No title yet");
      hidden();
      assert.equal(pipeline.stats().requests, requests + 1, "Untitled thinking must not request a widget render");
      await pipeline.update("**Inspecting**", "**Inspecting**");
      assert.equal(statusText(pipeline), "• Inspecting");
      await pipeline.emit("message_update", { message, assistantMessageEvent: { type, contentIndex: 1 } });
      hidden();
      await pipeline.update("**Late thinking**", "**Late thinking**");
      hidden();
      await pipeline.emit("message_end", { message: { ...message, stopReason: "toolUse", content: [
        { type: "toolCall", id: "read-1", name: "read", arguments: {} },
        { type: "toolCall", id: "bash-1", name: "bash", arguments: {} },
      ] } });
      hidden();
      for (const [event, toolCallId, toolName] of [
        ["tool_execution_start", "read-1", "read"], ["tool_execution_start", "bash-1", "bash"],
        ["tool_execution_end", "bash-1", "bash"], ["tool_execution_end", "unknown", "read"],
        ["tool_execution_end", "read-1", "read"],
      ]) {
        await pipeline.emit(event!, { toolCallId, toolName });
        hidden();
      }
      await pipeline.emit("agent_end", { messages: [] });
      await pipeline.update("**Late update**", "**Late update**");
      await pipeline.emit("tool_execution_start", { toolCallId: "read-1", toolName: "read" });
      hidden();
    }
  } finally { await pipeline.dispose(); }
});

test("new thinking parts and replacement snapshots cannot be overwritten by older parts", async () => {
  const pipeline = await reasoningPipeline(codexUi, process.cwd());
  try {
    const message = await pipeline.begin();
    const update = async (index: number, text: string, delta: string) => {
      const content = Array.from({ length: index + 1 }, (_, i) => i === index
        ? { type: "thinking", thinking: text } : { type: "text", text: "Earlier output" });
      await pipeline.emit("message_update", { message: { ...message, content },
        assistantMessageEvent: { type: "thinking_delta", contentIndex: index, delta } });
    };
    await update(0, "**First**", "**First**");
    await update(2, "**新", "**新");
    assert.deepEqual(pipeline.widgets.get("codex-ui-reasoning")!.render(120), []);
    await update(2, "**新的\n标题**", "的\n标题**");
    assert.equal(statusText(pipeline), "• 新的 标题");
    await update(0, "**First** stale", " stale");
    assert.equal(statusText(pipeline), "• 新的 标题");
    await update(2, "**Replaced**", "**Replaced**");
    assert.equal(statusText(pipeline), "• Replaced");
    await update(2, "**Unclosed", "**Unclosed");
    assert.deepEqual(pipeline.widgets.get("codex-ui-reasoning")!.render(120), []);
    await pipeline.emit("message_update", { message, assistantMessageEvent: { type: "text_start", contentIndex: 3 } });
    await update(2, "**Late thinking**", "**Late thinking**");
    assert.deepEqual(pipeline.widgets.get("codex-ui-reasoning")!.render(120), []);
  } finally { await pipeline.dispose(); }
});

test("status resets on failure, retry, compaction, tree navigation and session replacement", async () => {
  const pipeline = await reasoningPipeline(codexUi, process.cwd());
  try {
    for (const name of ["agent_end", "agent_settled", "session_before_compact", "session_tree"]) {
      const old = await pipeline.begin();
      await pipeline.update("**Old title**", "**Old title**");
      await pipeline.emit(name, { messages: [], reason: "threshold" });
      assert.equal(statusText(pipeline), "");
      await pipeline.emit("message_start", { message: old });
      await pipeline.update("**Late title**", "**Late title**");
      assert.equal(statusText(pipeline), "");
      const fresh = await pipeline.begin();
      await pipeline.update("**Fresh title**", "**Fresh title**");
      await pipeline.emit("message_update", { message: old, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "late" } });
      assert.equal(statusText(pipeline), "• Fresh title");
      await pipeline.emit("message_end", { message: { ...fresh, stopReason: "error" } });
      assert.equal(statusText(pipeline), "");
    }
    for (const reason of ["new", "resume", "fork", "reload"]) {
      await pipeline.begin();
      await pipeline.update("**Before switch**", "**Before switch**");
      const previous = pipeline.widgets.get("codex-ui-reasoning")!;
      await pipeline.emit("session_shutdown", { reason });
      assert.ok(!pipeline.widgets.has("codex-ui-reasoning"));
      assert.deepEqual(previous.render(120), []);
      await pipeline.emit("session_start", { reason });
      assert.equal(statusText(pipeline), "");
      await pipeline.update("**Late title**", "**Late title**");
      assert.equal(statusText(pipeline), "");
      assert.notEqual(pipeline.widgets.get("codex-ui-reasoning"), previous);
    }
  } finally { await pipeline.dispose(); }
});

test("status sanitizes model ANSI and invalidates colors without retaining a disposed title", () => {
  let color = "\x1b[90m";
  const theme = { getFgAnsi: () => color, fg: (_key: string, text: string) => color + text + "\x1b[39m" } as Theme;
  let requests = 0;
  const status = new ReasoningStatus(() => theme, () => requests++);
  status.setTitle("\x1b[1m\x1b[3m检查 👩🏽‍💻 é\n新的标题\x1b[0m");
  const first = status.render(120);
  assert.equal(stripTerminalSequences(first[0]!), "• 检查 👩🏽‍💻 é 新的标题");
  assert.doesNotMatch(first[0]!, /\x1b\[(?:1|3)m/u);
  color = "\x1b[91m";
  const second = status.render(120);
  assert.notEqual(second, first);
  assert.match(second[0]!, /\x1b\[91m/u);
  status.invalidate();
  assert.deepEqual(status.render(120), second);
  for (const width of [NaN, Infinity, -1, 0]) assert.deepEqual(status.render(width), []);
  for (const width of [1, 2, 3, 6, 12, 30, 120]) {
    for (const row of status.render(width)) assert.ok(visibleWidth(row) <= width);
  }
  status.dispose(); status.setTitle("Late title");
  assert.deepEqual(status.render(120), []);
  assert.equal(requests, 1);
});

test("bottom status changes never replay static offscreen tool history", async () => {
  for (const outputPad of [0, 1] as const) {
    const writes: string[] = [];
    for (const history of [0, 20]) {
      const pipeline = await reasoningPipeline(codexUi, process.cwd(), history, true, outputPad);
      try {
        await pipeline.begin();
        await pipeline.update("**First title**", "**First title**");
        pipeline.screen.renderNow(); pipeline.terminal.take();
        const redraws = pipeline.screen.fullRedraws;
        await pipeline.update("", "", "thinking_start");
        await pipeline.update("**Next title**", "**Next title**");
        pipeline.screen.renderNow();
        const output = pipeline.terminal.take();
        assert.equal(pipeline.screen.fullRedraws, redraws);
        assert.doesNotMatch(output, /offscreen-reasoning-marker|\x1b\[(?:2J|3J)/u);
        assert.match(stripTerminalSequences(output), /Next title/u);
        writes.push(output);
      } finally { await pipeline.dispose(); }
    }
    assert.equal(writes[0], writes[1]);
  }
});

test("print and RPC lifecycle events never install or call the reasoning UI", async () => {
  for (const mode of ["print", "rpc"]) {
    const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
    codexUi({ registerTool() {}, registerCommand() {}, registerMarkdownTransformer() {},
      on: (name: string, handler: any) => handlers.set(name, [...handlers.get(name) ?? [], handler]),
    } as unknown as ExtensionAPI);
    const ctx = { mode, ui: new Proxy({}, { get() { throw new Error("Non-TUI code must not access the UI"); } }) };
    for (const name of ["session_start", "agent_start", "message_start", "message_update", "message_end", "agent_end", "agent_settled", "session_shutdown"]) {
      for (const handler of handlers.get(name) ?? []) await handler({ type: name, reason: "startup", message: { role: "assistant" } }, ctx);
    }
  }
});

test("production status and completed history align with real tools at zero output padding", async () => {
  const pipeline = await reasoningPipeline(codexUi, process.cwd(), 0, true, 0);
  try {
    const tool = new ToolExecutionComponent("read", "alignment-read", { path: "metrics.json" }, { showImages: false },
      pipeline.tools.get("read"), pipeline.screen, process.cwd());
    tool.setArgsComplete();
    tool.updateResult({ content: [{ type: "text", text: "fixture" }], isError: false });
    const text = "**检查资料**\n\n我核对资料文件";
    const message = await pipeline.begin(text);
    await pipeline.update(text, text);
    const status = pipeline.widgets.get("codex-ui-reasoning")!;
    for (const width of [30, 60, 120, 60]) {
      const title = tool.render(width).map(stripTerminalSequences).find(line => line.includes("Read metrics.json"))!;
      const rows = status.render(width).map(stripTerminalSequences);
      assert.equal(rows[0]!.indexOf("•"), title.indexOf("✓"), "Status marker must align with the tool icon");
      assert.equal(rows[0]!.indexOf("检查"), title.indexOf("Read"), "Provider title must align with the tool title without translation");
      assert.equal(rows[1], "");
    }
    await pipeline.finish();
    for (const width of [30, 60, 120, 60]) {
      const title = tool.render(width).map(stripTerminalSequences).find(line => line.includes("Read metrics.json"))!;
      const rows = pipeline.assistant.render(width).map(stripTerminalSequences);
      const summary = rows.find(line => line.includes("我核对资料文件"))!;
      assert.ok(summary, "Completed thinking must remain visible");
      assert.equal(summary.indexOf("•"), title.indexOf("✓"), "History marker must align with the tool icon");
      assert.equal(summary.indexOf("我"), title.indexOf("Read"), "History text must align with the tool title");
      for (const row of rows) assert.ok(visibleWidth(row) <= width);
    }
    assert.deepEqual(status.render(120), []);
    assert.deepEqual(message.content, [{ type: "thinking", thinking: text }], "Rendering must not mutate event snapshots");
  } finally { await pipeline.dispose(); }
});

test("production status stays static while the independent terminal title animates", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const pipeline = await reasoningPipeline(codexUi, process.cwd());
  try {
    await pipeline.begin();
    await pipeline.update("**Reading the fixture**\n\nBody", "**Reading the fixture**\n\nBody");
    const status = pipeline.widgets.get("codex-ui-reasoning");
    assert.ok(status, "Production registration must install the reasoning widget");
    const lines = status.render(120);
    assert.equal(stripTerminalSequences(lines[0]!), "• Reading the fixture");
    assert.equal(lines.length, 2);
    assert.equal(lines[1], "");
    assert.doesNotMatch(lines[0]!, /\x1b\[(?:1|3)m/u);
    for (const width of [0, 1, 2, 3, 10, 30, 60, 120]) {
      const rows = status.render(width);
      assert.equal(rows.length, width ? 2 : 0);
      for (const row of rows) assert.ok(visibleWidth(row) <= width);
    }
    const stable = status.render(120);
    const requests = pipeline.stats().requests;
    for (let index = 0; index < 100; index++) assert.equal(status.render(120), stable);
    vi.advanceTimersByTime(2000);
    assert.equal(pipeline.stats().requests, requests);
    assert.equal(vi.getTimerCount(), 1);
    const windowTitles = [...pipeline.titles];
    await pipeline.commands.get("lowpower").handler("on", pipeline.context);
    await pipeline.commands.get("lowpower").handler("off", pipeline.context);
    vi.advanceTimersByTime(2000);
    assert.equal(status.render(120), stable);
    assert(pipeline.titles.length > windowTitles.length);
    assert.equal(pipeline.stats().requests, requests);
    await pipeline.finish();
    assert.deepEqual(status.render(120), []);
    assert.equal(vi.getTimerCount(), 0);
  } finally { await pipeline.dispose(); vi.useRealTimers(); }
});
