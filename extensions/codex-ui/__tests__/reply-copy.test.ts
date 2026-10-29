import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { type TUI, getKeybindings } from "@earendil-works/pi-tui";
import { createTestUi } from "../../../test-support/pi-ui.js";
import codexUi from "../src/index.js";
import type { CodexEditor } from "../src/components.js";

const { copy } = vi.hoisted(() => ({ copy: vi.fn<(...args: string[]) => Promise<void>>() }));
vi.mock("@earendil-works/pi-coding-agent", async importOriginal => ({
  ...await importOriginal<typeof import("@earendil-works/pi-coding-agent")>(),
  copyToClipboard: copy,
}));

function reply(text: string): AssistantMessage {
  return {
    role: "assistant", content: [{ type: "text", text }], timestamp: 1,
    api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

async function setup() {
  copy.mockReset().mockResolvedValue(undefined);
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const manager = SessionManager.inMemory(process.cwd());
  let editor: CodexEditor;
  const notify = vi.fn();
  const nativeSubmit = vi.fn();
  const ui = createTestUi({ notify, setEditorComponent(factory) {
    editor = factory!({ terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI,
      { borderColor: (text: string) => text, selectList: {} } as never, getKeybindings() as KeybindingsManager) as CodexEditor;
    editor.onSubmit = nativeSubmit;
  } });
  const ctx = { mode: "tui", cwd: process.cwd(), ui, sessionManager: manager,
    isIdle: () => true } as unknown as ExtensionContext;
  codexUi({ registerTool() {}, registerCommand() {}, registerMarkdownTransformer() {},
    getThinkingLevel: () => "off", getSessionName: () => undefined,
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
      handlers.set(name, [...handlers.get(name) ?? [], handler]);
    },
  } as unknown as ExtensionAPI);
  for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
  return { manager, notify, nativeSubmit, get editor() { return editor!; } };
}

test("submitted copy preserves original Markdown bytes through the installed editor", async () => {
  const fixture = await setup();
  const original = " \n## 中文\n\n```ts\nconst n = 1;\n```\n\n";
  const message = reply(original);
  message.content.unshift({ type: "thinking", thinking: "Not copied" });
  message.content.push({ type: "text", text: "Last block\r\n" });
  fixture.manager.appendMessage(message);
  fixture.editor.setText("/copy");
  fixture.editor.handleInput("\r");
  await vi.waitFor(() => assert.equal(copy.mock.calls.length, 1));
  assert.deepEqual(copy.mock.calls[0], [original + "Last block\r\n"]);
  assert.equal(fixture.nativeSubmit.mock.calls.length, 0);
  assert.equal(fixture.editor.getText(), "");
  assert.equal(fixture.editor.onSubmit, fixture.nativeSubmit);
  assert.ok(fixture.notify.mock.calls.some(([text]) => text === "Copied last agent message to clipboard"));
});

test("copy follows branch and context edits and never leaks a previous session", async () => {
  const fixture = await setup();
  const first = fixture.manager.appendMessage(reply("First\n"));
  fixture.manager.appendMessage(reply("Other branch\n"));
  fixture.manager.branch(first);
  fixture.manager.appendContextEdit(first, { content: [{ type: "text", text: "Edited\n" }] });
  fixture.editor.setText("/copy"); fixture.editor.handleInput("\r");
  await vi.waitFor(() => assert.deepEqual(copy.mock.calls, [["Edited\n"]]));
  fixture.manager.newSession();
  fixture.editor.setText("/copy"); fixture.editor.handleInput("\r");
  assert.equal(copy.mock.calls.length, 1);
  assert.deepEqual(fixture.notify.mock.calls.at(-1), ["No agent messages to copy yet.", "error"]);
});

test("copy skips empty aborted replies but never substitutes older text for a tool-only reply", async () => {
  const fixture = await setup();
  fixture.manager.appendMessage(reply("Keep\n"));
  fixture.manager.appendMessage({ ...reply(""), stopReason: "aborted", content: [] });
  fixture.editor.setText("/copy"); fixture.editor.handleInput("\r");
  await vi.waitFor(() => assert.deepEqual(copy.mock.calls, [["Keep\n"]]));
  for (const content of [[], [{ type: "thinking" as const, thinking: "Only thinking" }], [{ type: "text" as const, text: " \n\t" }]]) {
    fixture.manager.appendMessage({ ...reply(""), content });
    fixture.editor.setText("/copy"); fixture.editor.handleInput("\r");
    assert.equal(copy.mock.calls.length, 1);
    assert.deepEqual(fixture.notify.mock.calls.at(-1), ["No agent messages to copy yet.", "error"]);
  }
  fixture.manager.appendMessage({ ...reply("Partial\n"), stopReason: "aborted" });
  fixture.editor.setText("/copy"); fixture.editor.handleInput("\r");
  await vi.waitFor(() => assert.deepEqual(copy.mock.calls.at(-1), ["Partial\n"]));
});

test("copy reports clipboard failures and suppresses stale completion after session replacement", async () => {
  const fixture = await setup();
  fixture.manager.appendMessage(reply("Reply\n"));
  for (const failure of [new Error("Unavailable"), "Unavailable"]) {
    copy.mockRejectedValueOnce(failure);
    fixture.editor.setText("/copy"); fixture.editor.handleInput("\r");
    await vi.waitFor(() => assert.deepEqual(fixture.notify.mock.calls.at(-1), ["Unavailable", "error"]));
    fixture.notify.mockClear();
  }
  for (const reject of [false, true]) {
    let finish!: () => void;
    copy.mockImplementationOnce(() => new Promise<void>((resolve, fail) => { finish = () => reject ? fail(new Error("Late")) : resolve(); }));
    fixture.manager.appendMessage(reply("Current\n"));
    fixture.editor.setText("/copy"); fixture.editor.handleInput("\r");
    fixture.manager.newSession();
    finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.notify.mock.calls.length, 0);
  }
});

test("copy handling preserves native paste, submit disabling, ordinary commands and callback restoration", async () => {
  const fixture = await setup();
  fixture.manager.appendMessage(reply("Reply\n"));
  fixture.editor.handleInput("\x1b[200~/copy\x1b[201~");
  assert.equal(copy.mock.calls.length, 0);
  fixture.editor.disableSubmit = true;
  fixture.editor.handleInput("\r");
  assert.equal(copy.mock.calls.length, 0);
  fixture.editor.disableSubmit = false;
  for (const command of ["/quit", "/copy extra", "Hello"]) {
    fixture.editor.setText(command); fixture.editor.handleInput("\r");
    assert.deepEqual(fixture.nativeSubmit.mock.calls.at(-1), [command]);
  }
  fixture.nativeSubmit.mockImplementationOnce(() => { throw new Error("Submit failed"); });
  fixture.editor.setText("Hello");
  assert.throws(() => fixture.editor.handleInput("\r"), /Submit failed/u);
  assert.equal(fixture.editor.onSubmit, fixture.nativeSubmit);
  fixture.editor.onSubmit = undefined;
  fixture.editor.setText("Hello"); fixture.editor.handleInput("\r");
  assert.equal(fixture.editor.onSubmit, undefined);
  fixture.editor.setText(" /copy "); fixture.editor.handleInput("\r");
  await vi.waitFor(() => assert.deepEqual(copy.mock.calls, [["Reply\n"]]));
});
