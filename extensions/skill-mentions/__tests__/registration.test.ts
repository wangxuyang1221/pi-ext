import { expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import skillMentions from "../src/index.js";

function registration() {
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => any>();
  const getCommands = vi.fn(() => []), appendEntry = vi.fn(), addAutocompleteProvider = vi.fn();
  const pi = { on: (name: string, handler: any) => { handlers.set(name, handler); }, getCommands, appendEntry, registerMarkdownTransformer: vi.fn(), registerEntryRenderer: vi.fn() };
  skillMentions(pi as unknown as ExtensionAPI);
  const ctx = { mode: "tui", ui: { addAutocompleteProvider } } as unknown as ExtensionContext;
  return { handlers, getCommands, appendEntry, addAutocompleteProvider, ctx };
}

it.each(["assistant", "toolResult", "custom", "system"])("ignores %s lifecycle messages before resolving any skills", async role => {
  const h = registration();
  const event = { message: { role, content: "$alpha", timestamp: 1 } };
  await h.handlers.get("message_start")!(event, h.ctx);
  expect(h.handlers.get("message_end")!(event, h.ctx)).toBeUndefined();
  expect(h.getCommands).not.toHaveBeenCalled(); expect(h.appendEntry).not.toHaveBeenCalled();
});

it.each(["rpc", "print", "json"])("does not register TUI completion in %s mode", async mode => {
  const h = registration(); await h.handlers.get("session_start")!({}, { ...h.ctx, mode } as ExtensionContext);
  expect(h.addAutocompleteProvider).not.toHaveBeenCalled();
});

it("registers only layered completion and leaves input and queue handling to Pi", async () => {
  const h = registration(); await h.handlers.get("session_start")!({}, h.ctx);
  expect(h.addAutocompleteProvider).toHaveBeenCalledTimes(1);
  expect(h.handlers.has("input")).toBe(false);
  const event = { message: { role: "user", content: "$unknown" } };
  await h.handlers.get("message_start")!(event, h.ctx);
  expect(h.handlers.get("message_end")!(event, h.ctx)).toBeUndefined();
  expect(h.getCommands).toHaveBeenCalledTimes(1);
  expect(h.appendEntry).not.toHaveBeenCalled();
});
