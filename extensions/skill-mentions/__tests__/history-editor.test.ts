import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { CustomEditor, initTheme, InteractiveMode, type KeybindingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, Container, stripTerminalSequences, type EditorComponent, type TUI } from "@earendil-works/pi-tui";
import { CodexEditor } from "../../codex-ui/src/components.js";
import skillMentions from "../src/index.js";
import { encodeSnapshot } from "../src/protocol.js";

const task = "用 $alpha 调查";
const envelope = encodeSnapshot({ namespace: "pi-ext/skill-mentions", version: 1,
  requestId: "11111111-1111-4111-8111-111111111111", task,
  skills: [{ name: "alpha", location: "/fixture/alpha/SKILL.md", baseDir: "/fixture/alpha", body: "BODY" }] });
const editors: EditorComponent[] = [];
beforeAll(() => initTheme("dark", false));
afterEach(() => { for (const editor of editors.splice(0)) editor.setText(""); });

function fixture(kind: "native" | "codex", order: "before" | "after" = "before", reason = "reload") {
  const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {}, setFocus() {} } as unknown as TUI;
  const appKeys: Record<string, string> = { "app.interrupt": "\x1b", "app.exit": "\x04", "app.clipboard.pasteImage": "\x16", "app.model.cycleForward": "\x10" };
  const keys = { matches: (data: string, action: string) => appKeys[action] === data } as KeybindingsManager;
  const identity = (text: string) => text;
  const defaultEditor = new CustomEditor(tui, { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } }, keys, { embedWorkingStatus: true });
  editors.push(defaultEditor);
  const submitted = vi.fn(), changed = vi.fn(), escaped = vi.fn(), shortcut = vi.fn((data: string) => data === "?");
  defaultEditor.onSubmit = submitted; defaultEditor.onChange = changed; defaultEditor.onEscape = escaped;
  defaultEditor.onExtensionShortcut = shortcut;
  const exited = vi.fn(), pasted = vi.fn(), cycled = vi.fn();
  defaultEditor.onCtrlD = exited; defaultEditor.onPasteImage = pasted;
  defaultEditor.onAction("app.model.cycleForward", cycled);
  const mode: any = Object.create(InteractiveMode.prototype);
  Object.assign(mode, { ui: tui, keybindings: keys, editor: defaultEditor, defaultEditor,
    editorContainer: new Container(), statusContainer: new Container(), disposeActiveSelector() {},
    autocompleteProvider: new CombinedAutocompleteProvider([{ name: "help" }], process.cwd()),
  });
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => any>();
  const ui = {
    getEditorComponent: () => mode.editorComponentFactory,
    setEditorComponent: vi.fn((factory: any) => { mode.setCustomEditorComponent(factory); editors.push(mode.editor); }),
    addAutocompleteProvider: vi.fn((wrap: any) => { mode.autocompleteProvider = wrap(mode.autocompleteProvider); mode.editor.setAutocompleteProvider(mode.autocompleteProvider); }),
  };
  const ctx = { mode: "tui", ui, sessionManager: { buildContextEntries: vi.fn(() => [{ type: "message", message: { role: "user", content: envelope } }]) } } as unknown as ExtensionContext;
  skillMentions({ on: (event: string, handler: any) => handlers.set(event, handler),
    getCommands: () => [{ name: "skill:alpha", source: "skill", sourceInfo: { path: "/fixture/alpha/SKILL.md" } }],
    registerMarkdownTransformer() {}, registerEntryRenderer() {}, registerCommand() {},
  } as unknown as ExtensionAPI);
  let base: CodexEditor | undefined;
  const installCodex = () => {
    if (kind === "codex") ui.setEditorComponent((tui: any, theme: any, keys: any) => {
      base = new CodexEditor(tui, theme, keys, () => ({ fg: (_key: string, text: string) => text, getBgAnsi: () => "" }) as any);
      return base;
    });
  };
  if (order === "before") installCodex();
  handlers.get("session_start")!({}, ctx);
  if (order === "after") installCodex();
  mode.editor.setText(envelope);
  handlers.get("resources_discover")?.({ reason }, ctx);
  return { mode, ui, ctx, handlers, submitted, changed, escaped, shortcut, exited, pasted, cycled, get base() { return base; } };
}

it.each(["native", "codex"] as const)("%s seeds original history when reload replaces the editor without populating history", kind => {
  const h = fixture(kind);
  h.mode.editor.setText("");
  h.mode.editor.handleInput("\x1b[A");
  expect(h.mode.editor.getText()).toBe(task);
});

it("does not duplicate startup history populated by the host", () => {
  const h = fixture("native", "before", "startup");
  h.mode.editor.addToHistory("Earlier task"); h.mode.editor.addToHistory(envelope);
  h.mode.editor.setText("");
  h.mode.editor.handleInput("\x1b[A"); expect(h.mode.editor.getText()).toBe(task);
  h.mode.editor.handleInput("\x1b[A"); expect(h.mode.editor.getText()).toBe("Earlier task");
  h.mode.editor.handleInput("\x1b[A"); expect(h.mode.editor.getText()).toBe("Earlier task");
});

it.each(["native", "codex"] as const)("%s restores snapshot drafts and history through the public factory", kind => {
  const h = fixture(kind);
  const editor = h.mode.editor as EditorComponent;
  expect(editor.getText()).toBe(task);
  editor.setText(""); editor.addToHistory!(envelope); editor.handleInput("\x1b[A");
  expect(editor.getText()).toBe(task);
  editor.handleInput("\r"); expect(h.submitted).toHaveBeenCalledWith(task);
  editor.handleInput("?"); expect(h.shortcut).toHaveBeenCalledWith("?");
  editor.handleInput("\x1b"); expect(h.escaped).toHaveBeenCalledTimes(1);
  editor.setText(""); editor.handleInput("\x04"); expect(h.exited).toHaveBeenCalledTimes(1);
  editor.handleInput("\x16"); expect(h.pasted).toHaveBeenCalledTimes(1);
  editor.handleInput("\x10"); expect(h.cycled).toHaveBeenCalledTimes(1);
  editor.setText(envelope); expect(h.changed).toHaveBeenLastCalledWith(task);
  if (kind === "codex") {
    expect(editor).toBeInstanceOf(CodexEditor);
    expect(editor.render(80).map(stripTerminalSequences).map(line => line.replaceAll(" \u{f01a7} alpha ", "$alpha").trimEnd()))
      .toEqual(h.base!.render(80).map(stripTerminalSequences).map(line => line.trimEnd()));
    expect(h.base!.setText).toBe(CodexEditor.prototype.setText);
  } else expect((editor as CustomEditor).embedWorkingStatus).toBe(true);
});

it.each(["before", "after"] as const)("preserves CodexEditor installed %s session_start and never nests on repeated discovery", order => {
  const h = fixture("codex", order);
  const factory = h.ui.getEditorComponent(), editor = h.mode.editor;
  const setText = editor.setText;
  for (let i = 0; i < 10; i++) h.handlers.get("resources_discover")!({}, h.ctx);
  expect(h.ui.getEditorComponent()).toBe(factory);
  expect(h.mode.editor).toBe(editor);
  expect(editor.setText).toBe(setText);
  expect(editor).toBeInstanceOf(CodexEditor);
  expect(editor.getText()).toBe(task);
  expect(h.ui.setEditorComponent).toHaveBeenCalledTimes(2);
  expect(h.ctx.sessionManager.buildContextEntries).toHaveBeenCalledTimes(1);
});

it.each(["native", "codex"] as const)("%s preserves ordinary JSON, native slash history, focus and autocomplete", async kind => {
  const h = fixture(kind), editor = h.mode.editor;
  for (const text of ['{"task":"not a snapshot"}', '/skill:alpha old', '<skill name="alpha" location="/fixture">old</skill>', envelope.replace('version="1"', 'version="2"')]) {
    editor.setText(text); expect(editor.getText()).toBe(text);
    editor.setText(""); editor.addToHistory(text); editor.handleInput("\x1b[A"); expect(editor.getText()).toBe(text);
  }
  editor.focused = true;
  if (h.base) expect(h.base.focused).toBe(true);
  editor.setText("Use "); editor.handleInput("$");
  await new Promise(resolve => setTimeout(resolve, 80));
  editor.handleInput("\r"); expect(editor.getText()).toBe("Use $alpha"); expect(h.submitted).not.toHaveBeenCalled();
  editor.handleInput("\r"); expect(h.submitted).toHaveBeenLastCalledWith("Use $alpha");
  editor.setText(""); editor.handleInput("/"); await new Promise(resolve => setTimeout(resolve, 80));
  editor.handleInput("\t"); expect(editor.getText()).toBe("/help ");
});
