import { codexTools } from "../src/tools.js";
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { registerCodemodeUi } from "../../../shared/ui/codemode.js";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { type CodemodeServices } from "../../../shared/ui/codemode.js";
import { TestKeybindingsManager } from "../../../test-support/keybindings.js";

const theme = { bg: (_name: string, value: string) => value, fg: (_name: string, value: string) => value, bold: (value: string) => value } as Theme;
function harness(services: Omit<CodemodeServices, "layout"> = { nativeRenderers: new Map() }) {
  const handlers = new Map<string, Array<(event: any, context: any) => void>>();
  const commands = new Map<string, any>();
  let resolve: (name: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined;
  const pi = { registerTool: vi.fn(), registerToolRenderer: (resolver: typeof resolve) => { resolve = resolver; }, registerCommand: (name: string, config: any) => commands.set(name, config),
    on: (name: string, handler: any) => { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); } };
  const ctx = { mode: "tui", cwd: "/repo", sessionManager: { buildContextEntries: () => [] }, ui: { notify: vi.fn() } };
  registerCodemodeUi(pi as unknown as ExtensionAPI, { ...services, layout: codexTools });
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

test("codemode applies host outputPad symmetrically and drops padding on narrow widths", () => {
  const h = harness();
  const context: any = {
    toolCallId: "p",
    args: { code: "text(1)" },
    state: {},
    cwd: "/repo",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
    outputPad: 1,
    invalidate: vi.fn(),
  };
  const call = h.renderer.renderCall!(context.args, theme, context);
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p", toolName: "codemode", args: context.args });
  h.emit("tool_execution_end", { type: "tool_execution_end", toolCallId: "p", toolName: "codemode", isError: false, result: { content: [{ type: "text", text: "ok" }] } });
  const padded = call.render(80);
  assert.ok(padded.length > 0 && padded.every(line => line.startsWith(" ")));
  assert.ok(call.render(2).every(line => visibleWidth(line) <= 2));
  h.renderer.renderCall!(context.args, theme, { ...context, outputPad: 0 });
  const unpadded = call.render(80);
  assert.ok(unpadded[0]!.startsWith("▸ Codemode"));
});

test("inspect without current branch history gives a clear message", async () => {
  const h = harness();
  await h.commands.get("inspect").handler("", h.ctx);
  assert.match(h.ctx.ui.notify.mock.calls[0][0], /No codemode execution/);
});

test("in-place keybinding reload invalidates nested child and inspector detail caches, and unbound host key omits expand hint", async () => {
  const manager = new TestKeybindingsManager({ "app.tools.expand": "f3" });
  const mutation: ToolRenderers = {
    renderCall: () => new Text("edit"),
    renderResult(_result, _options, _theme, context) {
      return new Text((context as typeof context & { keyText(key: "app.tools.expand"): string }).keyText("app.tools.expand"));
    },
  };
  const h = harness({ nativeRenderers: new Map([["edit", mutation]]), getKeybindings: () => manager });
  const context: any = { toolCallId: "p", args: { code: "await tools.edit({})" }, state: {}, cwd: "/repo", expanded: true, invalidate() {} };
  const rowView = h.renderer.renderCall!(context.args, theme, context);
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p", toolName: "codemode" });
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p/edit", parentToolCallId: "p", toolName: "edit", args: { path: "a.ts" } });
  h.emit("tool_execution_end", { type: "tool_execution_end", toolCallId: "p/edit", parentToolCallId: "p", toolName: "edit", isError: false, result: { content: [{ type: "text", text: "ok" }] } });

  assert.match(rowView.render(120).join("\n"), /f3/);
  // Mutating the SAME manager instance (as Pi does on /reload) must invalidate nested child cache.
  manager.setUserBindings({ "app.tools.expand": "f5" });
  const afterReload = rowView.render(120).join("\n");
  assert.match(afterReload, /f5/);
  assert.doesNotMatch(afterReload, /f3/);

  // Same manager mutation must also refresh cached inspector detail output.
  let inspector: any;
  h.ctx.ui = { ...h.ctx.ui, custom: async (factory: any) => { inspector = factory({ terminal: { rows: 48 }, requestRender() {} }, theme, manager, () => {}); } } as any;
  await h.commands.get("inspect").handler("", h.ctx);
  assert.match(inspector.render(120).join("\n"), /f5/);
  manager.setUserBindings({ "app.tools.expand": "f6" });
  assert.match(inspector.render(120).join("\n"), /f6/);

  // When host reports unbound keyText(""), collapsed tree must omit expand hint even if keyHint returns bare text.
  const collapsedCtx: any = {
    toolCallId: "p2",
    args: { code: "loop()" },
    state: {},
    cwd: "/repo",
    expanded: false,
    keyText: () => "",
    keyHint: (_k: string, d: string) => d,
    invalidate() {},
  };
  const collapsedView = h.renderer.renderCall!(collapsedCtx.args, theme, collapsedCtx);
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p2", toolName: "codemode" });
  for (let i = 0; i < 7; i++) {
    h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: `p2/${i}`, parentToolCallId: "p2", toolName: "read", args: { path: `f${i}.ts` } });
  }
  const collapsedText = collapsedView.render(120).join("\n");
  assert.match(collapsedText, /2 more calls/);
  assert.doesNotMatch(collapsedText, /to expand/);
});

test("inspector follows remapped navigation/close keys, preserves shift+tab reverse unless occupied, and omits unbound hints", async () => {
  const h = harness();
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p", toolName: "codemode", args: { code: "line1\nline2" } });
  for (let i = 0; i < 3; i++) {
    h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: `p/${i}`, parentToolCallId: "p", toolName: "read", args: { path: `f${i}.ts` } });
    h.emit("tool_execution_end", { type: "tool_execution_end", toolCallId: `p/${i}`, parentToolCallId: "p", toolName: "read", isError: false, result: { content: [{ type: "text", text: "line\n".repeat(40) }] } });
  }
  h.emit("tool_execution_end", { type: "tool_execution_end", toolCallId: "p", toolName: "codemode", isError: false, result: { content: [{ type: "text", text: "done" }] } });

  const customKeys = new TestKeybindingsManager({
    "tui.input.tab": "f6",
    "tui.select.cancel": "f9",
    "tui.select.down": "f7",
    "tui.select.up": "f8",
    "tui.select.pageDown": "ctrl+d",
    "tui.select.pageUp": "ctrl+u",
  });
  let closed = 0;
  let renders = 0;
  let inspector: any;
  h.ctx.ui = {
    ...h.ctx.ui,
    custom: async (factory: any) => {
      inspector = factory({ terminal: { rows: 24 }, requestRender() { renders++; } }, theme, customKeys, () => { closed++; });
    },
  } as any;
  await h.commands.get("inspect").handler("", h.ctx);

  const initial = inspector.render(120).join("\n");
  assert.match(initial, /\[Calls\]/);
  assert.match(initial, /f6\/shift\+tab: view/);
  assert.match(initial, /f8\/f7: call/);
  assert.match(initial, /ctrl\+u\/ctrl\+d: scroll/);
  assert.match(initial, /f9: close/);

  // Old Tab and Esc must not act when remapped away.
  inspector.handleInput("\t");
  inspector.handleInput("\x1b");
  assert.equal(closed, 0);
  assert.match(inspector.render(120).join("\n"), /\[Calls\]/);

  // Remapped F6 advances tab, local Shift+Tab reverses back.
  inspector.handleInput("\x1b[17~"); // F6
  assert.match(inspector.render(120).join("\n"), /\[Script\]/);
  inspector.handleInput("\x1b[Z"); // Shift+Tab
  assert.match(inspector.render(120).join("\n"), /\[Calls\]/);

  // Remapped down/up selects call; remapped F9 closes.
  inspector.handleInput("\x1b[18~"); // F7 (down)
  assert.match(inspector.render(120).join("\n"), /> read f1\.ts/);
  inspector.handleInput("\x1b[19~"); // F8 (up)
  assert.match(inspector.render(120).join("\n"), /> read f0\.ts/);
  inspector.handleInput("\x1b[20~"); // F9 (cancel)
  assert.equal(closed, 1);

  // Conflict: when tui.select.down occupies shift+tab, pressing shift+tab ONLY moves selection and omits shift+tab from view hint.
  const conflictKeys = new TestKeybindingsManager({
    "tui.input.tab": "f6",
    "tui.select.down": "shift+tab",
    "tui.select.up": [],
    "tui.select.pageUp": [],
    "tui.select.pageDown": [],
    "tui.select.cancel": [],
  });
  let conflictInspector: any;
  h.ctx.ui = {
    ...h.ctx.ui,
    custom: async (factory: any) => {
      conflictInspector = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, conflictKeys, () => {});
    },
  } as any;
  await h.commands.get("inspect").handler("", h.ctx);
  const conflictFrame = conflictInspector.render(120).join("\n");
  assert.match(conflictFrame, /f6: view · shift\+tab: call/);
  assert.doesNotMatch(conflictFrame, /f6\/shift\+tab: view/);
  assert.doesNotMatch(conflictFrame, /scroll|close/);

  conflictInspector.handleInput("\x1b[Z"); // Shift+Tab -> must move down, NOT switch tab to Output
  const afterConflict = conflictInspector.render(120).join("\n");
  assert.match(afterConflict, /\[Calls\]/);
  assert.match(afterConflict, /> read f1\.ts/);
});

test("inspect refuses to open a focus-trapped overlay when tui.select.cancel is unbound", async () => {
  const unboundCancel = new TestKeybindingsManager({ "tui.select.cancel": [] });
  const h = harness({ nativeRenderers: new Map(), getKeybindings: () => unboundCancel });
  h.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "p", toolName: "codemode", args: { code: "text(1)" } });
  h.emit("tool_execution_end", { type: "tool_execution_end", toolCallId: "p", toolName: "codemode", isError: false, result: { content: [{ type: "text", text: "ok" }] } });
  const custom = vi.fn();
  h.ctx.ui = { ...h.ctx.ui, custom } as any;
  await h.commands.get("inspect").handler("", h.ctx);
  assert.equal(custom.mock.calls.length, 0);
  assert.match(h.ctx.ui.notify.mock.calls[0][0], /tui\.select\.cancel/);
  assert.equal(h.ctx.ui.notify.mock.calls[0][1], "warning");
});
