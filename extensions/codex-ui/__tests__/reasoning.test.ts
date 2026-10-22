import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import codexUi from "../src/index.js";
import { reasoningPipeline } from "./fixtures/reasoning-pipeline.js";

test("equal-height thinking changes never replay static offscreen tool history", async () => {
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


test("stable input reuses native Markdown without transforming thinking again", async () => {
  for (const repeats of [20, 20000]) {
    let transforms = 0;
    const pipeline = await reasoningPipeline(pi => codexUi({
      ...pi,
      registerMarkdownTransformer(transform) {
        pi.registerMarkdownTransformer((text, context) => {
          if (context.messageType === "assistant-thinking") transforms++;
          return transform(text, context);
        });
      },
    }), process.cwd());
    try {
      await pipeline.begin();
      const text = "**Title**\n\n" + "Body. ".repeat(repeats);
      await pipeline.update(text, text);
      await pipeline.finish();
      pipeline.screen.renderNow(); pipeline.terminal.take();
      const before = transforms;
      assert.ok(before > 0, "The counter must observe the initial thinking render");
      for (let index = 0; index < 64; index++) {
        pipeline.editor.handleInput(index % 2 ? "\x7f" : "x");
        pipeline.screen.renderNow(); pipeline.terminal.take();
      }
      assert.equal(transforms, before);
    } finally { await pipeline.dispose(); }
  }
});

test("inline thinking remains static while the independent terminal title animates", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const pipeline = await reasoningPipeline(codexUi, process.cwd());
  try {
    await pipeline.begin();
    await pipeline.update("**Reading the fixture**\n\nBody", "**Reading the fixture**\n\nBody");
    assert.equal(pipeline.widgets.size, 0);
    const stable = pipeline.assistant.render(120);
    assert.match(stable.map(stripTerminalSequences).join("\n"), /Body/u);
    const requests = pipeline.stats().requests;
    for (let index = 0; index < 100; index++) assert.deepEqual(pipeline.assistant.render(120), stable);
    vi.advanceTimersByTime(2000);
    assert.equal(pipeline.stats().requests, requests);
    assert.equal(vi.getTimerCount(), 1);
    const windowTitles = [...pipeline.titles];
    await pipeline.commands.get("lowpower").handler("on", pipeline.context);
    assert.deepEqual(pipeline.assistant.render(120), stable);
    await pipeline.commands.get("lowpower").handler("off", pipeline.context);
    vi.advanceTimersByTime(2000);
    assert.deepEqual(pipeline.assistant.render(120), stable);
    assert(pipeline.titles.length > windowTitles.length);
    assert.equal(pipeline.stats().requests, requests);
    await pipeline.finish();
    assert.deepEqual(pipeline.assistant.render(120), stable);
    assert.equal(vi.getTimerCount(), 0);
  } finally { await pipeline.dispose(); vi.useRealTimers(); }
});
