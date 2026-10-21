import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { registerCodemodeUi } from "../src/codemode.js";

const theme = { fg: (_name: string, value: string) => value, bold: (value: string) => value } as Theme;
function harness() {
  const handlers = new Map<string, Array<(event: any, context: any) => void>>();
  const commands = new Map<string, any>();
  let resolve: (name: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined;
  const pi = { registerTool: vi.fn(), registerToolRenderer: (resolver: typeof resolve) => { resolve = resolver; }, registerCommand: (name: string, config: any) => commands.set(name, config),
    on: (name: string, handler: any) => { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); } };
  const ctx = { mode: "tui", cwd: "/repo", sessionManager: { buildContextEntries: () => [] }, ui: { notify: vi.fn() } };
  registerCodemodeUi(pi as unknown as ExtensionAPI, { nativeRenderers: new Map() });
  const renderer = resolve!("codemode", () => undefined)!;
  const emit = (name: string, event: any) => { for (const handler of handlers.get(name) ?? []) handler(event, ctx); };
  return { pi, ctx, renderer, emit, commands };
}

test("registration is display-only and ordinary tool renderers pass through", () => {
  const h = harness(); assert.equal(h.pi.registerTool.mock.calls.length, 0); assert.equal(h.commands.has("inspect"), true);
});

test("real event-shaped data drives a mounted row, and late callbacks cannot restore a removed branch", () => {
  const h = harness();
  const context: any = { toolCallId: "p", args: { code: "text(1)" }, state: {}, cwd: "/repo", executionStarted: false, argsComplete: true,
    isPartial: true, expanded: false, showImages: false, isError: false, outputPad: 0, invalidate: vi.fn() };
  const call = h.renderer.renderCall!(context.args, theme, context);
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p", toolName: "codemode", args: context.args });
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p/1", toolName: "bash", parentToolCallId: "p", args: { command: "false" } });
  h.emit("tool_execution_end", { type: "tool_execution_end", toolCallId: "p/1", toolName: "bash", parentToolCallId: "p", isError: true, result: { content: [{ type: "text", text: "denied" }] } });
  h.emit("tool_execution_end", { type: "tool_execution_end", toolCallId: "p", toolName: "codemode", isError: false, result: { content: [{ type: "text", text: "handled" }] } });
  assert.match(call.render(120).join("\n"), /Script completed/);
  assert.match(call.render(120).join("\n"), /1 failed/);
  h.emit("session_tree", {});
  h.renderer.renderResult!({ content: [{ type: "text", text: "STALE" }], details: undefined }, { expanded: false, isPartial: false }, theme, context);
  assert.doesNotMatch(call.render(120).join("\n"), /STALE/);
});

test("inspect without current branch history gives a clear message", async () => {
  const h = harness();
  await h.commands.get("inspect").handler("", h.ctx);
  assert.match(h.ctx.ui.notify.mock.calls[0][0], /No codemode execution/);
});
