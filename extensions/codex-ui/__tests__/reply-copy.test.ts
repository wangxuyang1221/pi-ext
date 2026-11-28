import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { type AutocompleteProvider, type TUI, getKeybindings } from "@earendil-works/pi-tui";
import { createTestUi } from "../../../test-support/pi-ui.js";
import { TestKeybindingsManager } from "../../../test-support/keybindings.js";
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

async function setup(keybindings?: KeybindingsManager) {
  copy.mockReset().mockResolvedValue(undefined);
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const manager = SessionManager.inMemory(process.cwd());
  let editor: CodexEditor;
  const notify = vi.fn();
  const nativeSubmit = vi.fn();
  const ui = createTestUi({ notify, setEditorComponent(factory) {
    editor = factory!({ terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI,
      { borderColor: (text: string) => text, selectList: {} } as never, keybindings ?? (getKeybindings() as KeybindingsManager)) as CodexEditor;
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

test("copy skips non-stop replies without text but never substitutes older text for a normal stop reply", async () => {
  const fixture = await setup();
  fixture.manager.appendMessage(reply("Keep\n"));
  let expectedCopies = 0;
  for (const skipped of [
    { ...reply(""), stopReason: "aborted" as const, content: [] },
    { ...reply(""), stopReason: "aborted" as const, content: [{ type: "thinking" as const, thinking: "Interrupted" }] },
    { ...reply(""), stopReason: "toolUse" as const, content: [{ type: "toolCall" as const, id: "t1", name: "read", arguments: {} }] },
    { ...reply(""), stopReason: "error" as const, content: [] },
    { ...reply(""), stopReason: "error" as const, content: [{ type: "text" as const, text: " \n\t" }] },
  ]) {
    fixture.manager.appendMessage(skipped);
    expectedCopies++;
    fixture.editor.setText("/copy"); fixture.editor.handleInput("\r");
    await vi.waitFor(() => assert.equal(copy.mock.calls.length, expectedCopies));
    assert.deepEqual(copy.mock.calls.at(-1), ["Keep\n"]);
  }
  for (const content of [[], [{ type: "thinking" as const, thinking: "Only thinking" }], [{ type: "text" as const, text: " \n\t" }]]) {
    fixture.manager.appendMessage({ ...reply(""), content });
    fixture.editor.setText("/copy"); fixture.editor.handleInput("\r");
    assert.equal(copy.mock.calls.length, expectedCopies);
    assert.deepEqual(fixture.notify.mock.calls.at(-1), ["No agent messages to copy yet.", "error"]);
  }
  fixture.manager.appendMessage({ ...reply("Partial\n"), stopReason: "aborted" });
  fixture.editor.setText("/copy"); fixture.editor.handleInput("\r");
  await vi.waitFor(() => assert.equal(copy.mock.calls.length, expectedCopies + 1));
  assert.deepEqual(copy.mock.calls.at(-1), ["Partial\n"]);
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

test("app.message.followUp with autocomplete applies path drafts without submitting and routes idle /copy completion to copy", async () => {
  const hostKeys = new TestKeybindingsManager();
  const fixture = await setup(hostKeys as unknown as KeybindingsManager);
  const original = "Exact **Markdown** body\n";
  fixture.manager.appendMessage(reply(original));

  const provider: AutocompleteProvider = {
    async getSuggestions(lines, cursorLine, cursorCol) {
      const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
      if (before === "/cop") {
        return { prefix: "/cop", items: [{ value: "copy", label: "/copy" }] };
      }
      if (before.endsWith("@src/f")) {
        return { prefix: "@src/f", items: [{ value: "@src/file.ts", label: "src/file.ts" }] };
      }
      return null;
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const line = lines[cursorLine] ?? "";
      const replacement = prefix.startsWith("/") ? `/${item.value} ` : `${item.value} `;
      const start = cursorCol - prefix.length;
      const next = line.slice(0, start) + replacement + line.slice(cursorCol);
      const nextLines = [...lines];
      nextLines[cursorLine] = next;
      return { lines: nextLines, cursorLine, cursorCol: start + replacement.length };
    },
  };
  fixture.editor.setAutocompleteProvider(provider);

  let streaming = false;
  const queued: string[] = [];
  fixture.editor.actionHandlers.set("app.message.followUp", () => {
    const text = fixture.editor.getText().trim();
    if (!text) return;
    if (streaming) {
      queued.push(text);
      fixture.editor.setText("");
      return;
    }
    fixture.editor.setText("");
    fixture.editor.onSubmit?.(text);
  });

  // 1. Path completion + Alt+Enter inserts draft without submitting or copying.
  for (const ch of "open @src/f") fixture.editor.handleInput(ch);
  await vi.waitFor(() => assert.equal(fixture.editor.isShowingAutocomplete(), true));
  fixture.editor.handleInput("\x1b\r"); // Alt+Enter
  assert.equal(fixture.editor.getText(), "open @src/file.ts ");
  assert.equal(copy.mock.calls.length, 0);
  assert.equal(fixture.nativeSubmit.mock.calls.length, 0);

  // 2. Slash-command completion /cop -> /copy + Alt+Enter in idle mode routes to copyLastReply.
  fixture.editor.setText("");
  for (const ch of "/cop") fixture.editor.handleInput(ch);
  await vi.waitFor(() => assert.equal(fixture.editor.isShowingAutocomplete(), true));
  fixture.editor.handleInput("\x1b\r");
  await vi.waitFor(() => assert.equal(copy.mock.calls.length, 1));
  assert.deepEqual(copy.mock.calls[0], [original]);
  assert.equal(fixture.nativeSubmit.mock.calls.length, 0);

  // 3. Remapped followUp key in streaming mode queues follow-up instead of copying locally.
  hostKeys.setUserBindings({ "app.message.followUp": "f6" });
  streaming = true;
  fixture.editor.setText("queued follow-up");
  fixture.editor.handleInput("\x1b[17~"); // F6
  assert.deepEqual(queued, ["queued follow-up"]);
  assert.equal(copy.mock.calls.length, 1);

  // 4. Error in followUpHandler still restores editor.onSubmit and global keybindings.
  const globalBefore = getKeybindings();
  fixture.editor.actionHandlers.set("app.message.followUp", () => { throw new Error("Follow-up failed"); });
  fixture.editor.setText("hello");
  assert.throws(() => fixture.editor.handleInput("\x1b[17~"), /Follow-up failed/u);
  assert.equal(fixture.editor.onSubmit, fixture.nativeSubmit);
  assert.equal(getKeybindings(), globalBefore);
});
