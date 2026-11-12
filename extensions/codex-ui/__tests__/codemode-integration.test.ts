import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { registerCodemodeUi } from "../src/codemode.js";
import { Text } from "@earendil-works/pi-tui";
import { type CodemodeServices } from "../src/codemode.js";

const theme = { bg: (_name: string, value: string) => value, fg: (_name: string, value: string) => value, bold: (value: string) => value } as Theme;
function harness(services: CodemodeServices = { nativeRenderers: new Map() }) {
  const handlers = new Map<string, Array<(event: any, context: any) => void>>();
  const commands = new Map<string, any>();
  let resolve: (name: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined;
  const pi = { registerTool: vi.fn(), registerToolRenderer: (resolver: typeof resolve) => { resolve = resolver; }, registerCommand: (name: string, config: any) => commands.set(name, config),
    on: (name: string, handler: any) => { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); } };
  const ctx = { mode: "tui", cwd: "/repo", sessionManager: { buildContextEntries: () => [] }, ui: { notify: vi.fn() } };
  registerCodemodeUi(pi as unknown as ExtensionAPI, services);
  const renderer = resolve!("codemode", () => undefined)!;
  const emit = (name: string, event: any) => { for (const handler of handlers.get(name) ?? []) handler(event, ctx); };
  return { pi, ctx, renderer, emit, commands };
}

test("registration is display-only and ordinary tool renderers pass through", () => {
  const h = harness(); assert.equal(h.pi.registerTool.mock.calls.length, 0); assert.equal(h.commands.has("inspect"), true);
});

test("nested mutation renderers use the parent host hints and inspector keybindings", async () => {
  const mutation: ToolRenderers = {
    renderCall(_args, _theme, context) {
      const hints = context as typeof context & { keyText(key: "app.tools.expand"): string };
      return new Text(hints.keyText("app.tools.expand"));
    },
    renderResult(_result, _options, _theme, context) {
      const hints = context as typeof context & { keyHint(key: "app.tools.expand", description: string): string };
      return new Text(hints.keyHint("app.tools.expand", "mutation detail"));
    },
  };
  const h = harness({ nativeRenderers: new Map([["edit", mutation], ["write", mutation]]), getKeybindings: () => ({ getKeys: () => ["f4"] }) });
  const context = { toolCallId: "p", args: { code: "await tools.write({})" }, state: {}, cwd: "/repo", expanded: true,
    keyText: () => "HOST-F3", keyHint: (_key: string, description: string) => `HOST-F3 ${description}`, invalidate() {} };
  const component = h.renderer.renderCall!(context.args, theme, context as any);
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p", toolName: "codemode" });
  for (const name of ["edit", "write"]) {
    h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: `p/${name}`, toolName: name, parentToolCallId: "p", args: { path: "proof.txt" } });
    h.emit("tool_execution_end", { type: "tool_execution_end", toolCallId: `p/${name}`, toolName: name, parentToolCallId: "p", isError: false, result: { content: [{ type: "text", text: "Applied" }] } });
  }
  assert.match(component.render(120).join("\n"), /HOST-F3 mutation detail/);
  assert.doesNotMatch(component.render(120).join("\n"), /f4|ctrl\+o/);
  let inspector: any;
  h.ctx.ui = { ...h.ctx.ui, custom: async (factory: any) => { inspector = factory({ terminal: { rows: 48 }, requestRender() {} }, theme, { getKeys: () => ["f7"] }, () => {}); } } as any;
  await h.commands.get("inspect").handler("", h.ctx);
  assert.match(inspector.render(120).join("\n"), /f7 mutation detail/);
  assert.doesNotMatch(inspector.render(120).join("\n"), /HOST-F3|ctrl\+o/);
});

test("history rows refresh late host keybindings and cached mutation hints", () => {
  let keys: ReturnType<NonNullable<CodemodeServices["getKeybindings"]>>;
  const mutation: ToolRenderers = {
    renderCall: () => new Text("write"),
    renderResult(_result, _options, _theme, context) {
      return new Text((context as typeof context & { keyText(key: "app.tools.expand"): string }).keyText("app.tools.expand"));
    },
  };
  const h = harness({ nativeRenderers: new Map([["write", mutation]]), getKeybindings: () => keys });
  const context = { toolCallId: "p", args: {}, state: {}, cwd: "/repo", expanded: true, invalidate() {} };
  const component = h.renderer.renderCall!(context.args, theme, context as any);
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p", toolName: "codemode" });
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p/write", parentToolCallId: "p", toolName: "write", args: { path: "proof.txt" } });
  h.emit("tool_execution_end", { type: "tool_execution_end", toolCallId: "p/write", parentToolCallId: "p", toolName: "write", isError: false, result: { content: [{ type: "text", text: "Applied" }] } });
  assert.match(component.render(120).join("\n"), /ctrl\+o/);
  keys = { getKeys: () => ["f3"] };
  assert.match(component.render(120).join("\n"), /f3/);
  assert.doesNotMatch(component.render(120).join("\n"), /ctrl\+o/);
  keys = { getKeys: () => ["f4"] };
  assert.match(component.render(120).join("\n"), /f4/);
  h.renderer.renderCall!(context.args, theme, { ...context, keyText: () => "HOST-F7", keyHint: () => "HOST-F7 expand" } as any);
  assert.match(component.render(120).join("\n"), /HOST-F7/);
  assert.doesNotMatch(component.render(120).join("\n"), /f4/);
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
