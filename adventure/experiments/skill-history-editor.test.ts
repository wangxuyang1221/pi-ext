import { afterEach, beforeAll, expect, test } from "vitest";
import { CustomEditor, initTheme, InteractiveMode, type ExtensionContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, Container, type EditorComponent, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { CodexEditor } from "../../extensions/codex-ui/src/components.js";

// Planning fixture: compose an EditorComponent through the public editor factory contract.
// No existing instance method or prototype is assigned or patched.
type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
const kind = "multi-skill-lifecycle-probe";
const task = "Please use $alpha and $beta";
const envelope = JSON.stringify({ kind, task, skills: [{ name: "alpha", content: "HIDDEN_BODY" }] });
function originalText(text: string) {
  try {
    const parsed = JSON.parse(text);
    return parsed.kind === kind && typeof parsed.task === "string" ? parsed.task : text;
  } catch { return text; }
}
function wrapEditor(base: EditorComponent): EditorComponent {
  return new Proxy(base, {
    get(target, key) {
      if (key === "setText") return (text: string) => target.setText(originalText(text));
      if (key === "addToHistory" && target.addToHistory) return (text: string) => target.addToHistory!(originalText(text));
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) { return Reflect.set(target, key, value, target); },
  });
}
const identity = (text: string) => text;
const editorTheme: EditorTheme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity,
  description: identity, scrollInfo: identity, noMatch: identity } };
const theme = { fg: (_key: string, text: string) => text, getBgAnsi: () => "" } as unknown as Theme;
const editors: EditorComponent[] = [];
beforeAll(() => initTheme("dark", false));
afterEach(() => { for (const editor of editors.splice(0)) editor.setText(""); });

for (const kind of ["native", "codex"] as const) {
  test(`${kind}: public factory composition normalizes draft and history without changing appearance or app callbacks`, () => {
    const ui = { terminal: { rows: 40, columns: 100 }, requestRender() {}, setFocus() {} } as unknown as TUI;
    const keybindings = { matches: (data: string, action: string) => data === "\x1b" && action === "app.interrupt" } as KeybindingsManager;
    const defaultEditor = new CustomEditor(ui, editorTheme, keybindings);
    editors.push(defaultEditor);
    const submissions: string[] = [], changes: string[] = [];
    let escaped = 0, shortcuts = 0;
    defaultEditor.onSubmit = text => { submissions.push(text); };
    defaultEditor.onChange = text => { changes.push(text); };
    defaultEditor.onEscape = () => { escaped++; };
    defaultEditor.onExtensionShortcut = data => { if (data !== "?") return false; shortcuts++; return true; };
    defaultEditor.setText(envelope);
    changes.length = 0;
    const previous: EditorFactory | undefined = kind === "codex"
      ? (tui, editorTheme, keys) => new CodexEditor(tui, editorTheme, keys, () => theme) : undefined;
    let base: EditorComponent | undefined;
    let originalSetText: EditorComponent["setText"] | undefined;
    const composed: EditorFactory = (tui, editorTheme, keys) => {
      base = previous?.(tui, editorTheme, keys) ?? new CustomEditor(tui, editorTheme, keys);
      editors.push(base); originalSetText = base.setText;
      return wrapEditor(base);
    };
    // Real host setter, only unrelated terminal/selector plumbing is substituted.
    const mode: any = Object.create(InteractiveMode.prototype);
    Object.assign(mode, { ui, keybindings, editor: defaultEditor, defaultEditor,
      editorContainer: new Container(), statusContainer: new Container(), disposeActiveSelector() {},
      autocompleteProvider: new CombinedAutocompleteProvider([], process.cwd()),
    });
    mode.setCustomEditorComponent(composed);
    const wrapped = mode.editor as EditorComponent;
    expect(wrapped.getText()).toBe(task);
    expect(base!.setText).toBe(originalSetText);
    expect(wrapped.render(80)).toEqual(base!.render(80));
    expect(base).toBeInstanceOf(kind === "codex" ? CodexEditor : CustomEditor);
    wrapped.handleInput("\r");
    expect(submissions).toEqual([task]);
    wrapped.handleInput("?"); expect(shortcuts).toBe(1);
    wrapped.handleInput("\x1b"); expect(escaped).toBe(1);
    wrapped.setText(""); wrapped.addToHistory!(envelope); wrapped.handleInput("\x1b[A");
    expect(wrapped.getText()).toBe(task);
    expect(changes).not.toContain(envelope);
    wrapped.setText("Unrelated text"); expect(wrapped.getText()).toBe("Unrelated text");
    wrapped.setText("/skill:alpha Original slash input");
    expect(wrapped.getText()).toBe("/skill:alpha Original slash input");
  });

  test(`${kind}: wrapped editor retains dollar candidate selection and slash completion`, async () => {
    const ui = { terminal: { rows: 40, columns: 100 }, requestRender() {} } as unknown as TUI;
    const keys = { matches: () => false } as unknown as KeybindingsManager;
    const base = kind === "codex" ? new CodexEditor(ui, editorTheme, keys, () => theme) : new CustomEditor(ui, editorTheme, keys);
    const wrapped = wrapEditor(base); editors.push(wrapped);
    const current = new CombinedAutocompleteProvider([{ name: "help", description: "Fixture" }], process.cwd());
    wrapped.setAutocompleteProvider!({
      triggerCharacters: ["$"],
      async getSuggestions(lines, row, col, options) {
        const match = lines[row].slice(0, col).match(/(?:^| )\$([a-z]*)$/);
        return match ? { prefix: `$${match[1]}`, items: [{ value: "$alpha", label: "$alpha" }] } : current.getSuggestions(lines, row, col, options);
      },
      applyCompletion: (...args) => current.applyCompletion(...args),
    });
    const submitted: string[] = [];
    wrapped.onSubmit = text => { submitted.push(text); };
    wrapped.setText("Use "); wrapped.handleInput("$");
    await new Promise(resolve => setTimeout(resolve, 80));
    wrapped.handleInput("\r");
    expect(wrapped.getText()).toBe("Use $alpha"); expect(submitted).toEqual([]);
    wrapped.setText(""); wrapped.handleInput("/");
    await new Promise(resolve => setTimeout(resolve, 80));
    wrapped.handleInput("\t"); expect(wrapped.getText()).toBe("/help ");
  });
}
