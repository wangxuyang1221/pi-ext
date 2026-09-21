import { beforeAll, expect, it } from "vitest";
import { CustomEditor, initTheme, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { CodexEditor } from "../../../extensions/codex-ui/src/components.js";
import { SerialEditorProbe } from "./editor.js";

beforeAll(() => initTheme("dark", false));
const identity = (text: string) => text;
function fixture(kind: "native" | "codex", text = "$alpha.") {
  const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {} } as unknown as TUI;
  const keys = { matches: () => false } as unknown as KeybindingsManager;
  const theme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
  const base = kind === "native" ? new CustomEditor(tui, theme, keys) : new CodexEditor(tui, theme, keys, () => ({ fg: (_key: string, value: string) => value, getBgAnsi: () => "" }) as unknown as Theme);
  base.setText(text); base.handleInput("\x01");
  return new SerialEditorProbe(base);
}

it.each(["native", "codex"] as const)("%s exposes deletion and cursor synchronously before the native transaction", async kind => {
  const editor = fixture(kind);
  editor.handleInput("\x1b[3~");
  expect(editor.getText()).toBe(".");
  expect(editor.getExpandedText()).toBe(".");
  expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  await editor.settled();
  expect(editor.base.getExpandedText()).toBe(".");
  await editor.dispose();
});

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
it.each(["native", "codex"] as const)("%s serializes same-stack delete and submit with synchronous consumer callbacks", async kind => {
  const editor = fixture(kind), events: string[] = [];
  editor.onChange = text => { events.push(`change:${text}`); expect(editor.getText()).toBe(text); };
  editor.onSubmit = text => { events.push(`submit:${text}`); expect(editor.getText()).toBe(""); };
  editor.handleInput("\x1b[3~"); editor.handleInput("\r");
  expect(events).toEqual(["change:.", "change:", "submit:."]);
  expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  expect(editor.nativeSubmissions).toEqual([]);
  await editor.settled();
  expect(editor.nativeSubmissions).toEqual(["."]);
  expect(events).toHaveLength(3);
  await editor.dispose();
});

it.each(["native", "codex"] as const)("%s preserves delete, external-editor replacement and undo order", async kind => {
  const editor = fixture(kind), changes: string[] = [];
  editor.onChange = text => changes.push(text);
  editor.handleInput("\x1b[3~");
  const externalInput = editor.getExpandedText();
  expect(externalInput).toBe(".");
  editor.setText(externalInput + " edited");
  expect(editor.getText()).toBe(". edited");
  expect(editor.getCursor()).toEqual({ line: 0, col: 8 });
  editor.handleInput("\x1b[45;5u");
  expect(editor.getText()).toBe(".");
  editor.handleInput("\x1b[45;5u");
  expect(editor.getText()).toBe("$alpha.");
  await editor.settled();
  expect(editor.base.getExpandedText()).toBe("$alpha.");
  expect(changes).toEqual([".", ". edited", ".", "$alpha."]);
  await editor.dispose();
});

it.each(["native", "codex"] as const)("%s restores consecutive deletions and undos without looking up text history", async kind => {
  const editor = fixture(kind, "$alpha $beta");
  for (let i = 0; i < 3; i++) editor.handleInput("\x1b[3~");
  expect(editor.getText()).toBe("");
  for (const expected of ["$beta", " $beta", "$alpha $beta"]) {
    editor.handleInput("\x1b[45;5u"); expect(editor.getText()).toBe(expected);
  }
  await editor.settled();
  expect(editor.base.getText()).toBe("$alpha $beta");
  await editor.dispose();
});

it.each(["native", "codex"] as const)("%s releases a native wait on an abort-ignoring provider and rejects its late result", async kind => {
  const editor = fixture(kind);
  let release!: (value: { prefix: string; items: { value: string; label: string }[] }) => void;
  let signal: AbortSignal | undefined, applied = 0;
  const old = new Promise<{ prefix: string; items: { value: string; label: string }[] }>(resolve => { release = resolve; });
  editor.setAutocompleteProvider({
    getSuggestions(_lines, _line, _col, options) { signal = options.signal; return old; },
    applyCompletion() { applied++; return { lines: ["stale"], cursorLine: 0, cursorCol: 5 }; },
  });
  editor.requestAutocomplete(); await tick();
  expect(signal?.aborted).toBe(false);
  editor.handleInput("\x1b[3~"); editor.handleInput("\r");
  await editor.settled();
  expect(signal?.aborted).toBe(true);
  expect(editor.nativeSubmissions).toEqual(["."]);
  release({ prefix: "", items: [{ value: "stale", label: "stale" }] });
  await tick();
  expect(applied).toBe(0);
  expect(editor.base.getText()).toBe("");
  await editor.dispose();
});

it.each(["native", "codex"] as const)("%s cancellation retries deletion and shutdown drains an accepted undo", async kind => {
  const editor = fixture(kind);
  editor.handleInput("\x1b[3~");
  await Promise.resolve();
  editor.handleInput("\x1b");
  expect(editor.getText()).toBe(".");
  await editor.settled();
  expect(editor.base.getText()).toBe(".");
  editor.handleInput("\x1b[45;5u");
  await editor.dispose();
  await editor.settled();
  expect(editor.base.getText()).toBe("$alpha.");
});

it.each(["native", "codex"] as const)("%s rejects late provider failure and input after draining shutdown", async kind => {
  const editor = fixture(kind);
  let reject!: (error: Error) => void, applied = 0;
  const task = new Promise<null>((_resolve, fail) => { reject = fail; });
  editor.setAutocompleteProvider({
    getSuggestions() { return task; },
    applyCompletion() { applied++; throw new Error("Stale provider must not apply"); },
  });
  editor.requestAutocomplete(); await tick();
  const events: string[] = [];
  editor.onChange = text => events.push(text);
  editor.handleInput("\x1b[3~");
  await editor.dispose();
  expect(editor.base.getText()).toBe(".");
  reject(new Error("Late provider failure"));
  editor.handleInput("\r"); editor.setText("late draft");
  await tick();
  expect(applied).toBe(0);
  expect(editor.base.getText()).toBe(".");
  expect(editor.nativeSubmissions).toEqual([]);
  expect(events).toEqual(["."]);
});

it.each(["native", "codex"] as const)("%s serves pending expanded paste text by source segments", async kind => {
  const editor = fixture(kind, "");
  const paste = Array.from({ length: 12 }, (_, index) => `$alpha ${index}`).join("\n");
  await editor.pasteAtEnd(paste);
  await editor.insertAtEnd(" $alpha");
  editor.handleInput("\x7f");
  expect(editor.getText()).toMatch(/^\[paste #1 \+12 lines\] $/);
  expect(editor.getExpandedText()).toBe(paste + " ");
  editor.handleInput("\x1b[45;5u");
  expect(editor.getExpandedText()).toBe(paste + " $alpha");
  await editor.settled();
  expect(editor.base.getExpandedText()).toBe(paste + " $alpha");
  await editor.dispose();
});

it("preserves an unchanged external-editor result as a cursor reset without another undo unit", async () => {
  const editor = fixture("native");
  editor.handleInput("\x1b[3~");
  editor.setText(editor.getExpandedText());
  expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
  editor.handleInput("\x1b[45;5u");
  expect(editor.getText()).toBe("$alpha.");
  await editor.settled();
  expect(editor.base.getText()).toBe("$alpha.");
  await editor.dispose();
});

it("delegates a current ordinary provider result and retains one native undo", async () => {
  const editor = fixture("native", "plain");
  let applied = 0, changes = 0;
  editor.onChange = () => { changes++; };
  editor.setAutocompleteProvider({
    async getSuggestions() { return { prefix: "", items: [{ value: "current", label: "current" }] }; },
    applyCompletion() { applied++; return { lines: ["current"], cursorLine: 0, cursorCol: 7 }; },
  });
  editor.requestAutocomplete(); await tick();
  expect(editor.getText()).toBe("current"); expect(editor.base.getText()).toBe("current");
  expect(applied).toBe(1); expect(changes).toBe(1);
  editor.handleInput("\x1b[45;5u");
  await editor.settled(); expect(editor.base.getText()).toBe("plain");
  await editor.dispose();
});

it("preserves consumer callback reentrancy when submit prefills the next draft", async () => {
  const editor = fixture("native");
  editor.onSubmit = () => editor.setText("next draft");
  editor.handleInput("\x1b[3~"); editor.handleInput("\r");
  expect(editor.getText()).toBe("next draft");
  await editor.settled();
  expect(editor.base.getText()).toBe("next draft");
  expect(editor.nativeSubmissions).toEqual(["."]);
  await editor.dispose();
});
