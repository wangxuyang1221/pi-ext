import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { findReferences } from "../../../extensions/skill-mentions/src/references.js";

type Part = { raw: string; expanded: string };
type View = { parts: readonly Part[]; cursor: number };
type Operation = { id: number; kind: "splice" | "set" | "undo" | "submit"; view: View; text?: string };
const emptyProvider: AutocompleteProvider = {
  async getSuggestions() { return null; },
  applyCompletion(lines, cursorLine, cursorCol) { return { lines, cursorLine, cursorCol }; },
};
const raw = (view: View) => view.parts.map(part => part.raw).join("");
const expanded = (view: View) => view.parts.map(part => part.expanded).join("");
const plain = (text: string, cursor = text.length): View => ({ parts: [{ raw: text, expanded: text }], cursor });
function cursor(view: View) {
  const prefix = raw(view).slice(0, view.cursor).split("\n");
  return { line: prefix.length - 1, col: prefix.at(-1)!.length };
}
function replace(view: View, start: number, end: number): View {
  const parts: Part[] = [];
  let offset = 0;
  for (const part of view.parts) {
    const last = offset + part.raw.length;
    if (end <= offset || start >= last) parts.push(part);
    else {
      if (part.raw !== part.expanded) throw new Error("Probe does not edit inside folded paste segments");
      const remaining = part.raw.slice(0, Math.max(0, start - offset)) + part.raw.slice(Math.max(0, end - offset));
      if (remaining) parts.push({ raw: remaining, expanded: remaining });
    }
    offset = last;
  }
  return { parts, cursor: start };
}

function abortable(task: Promise<AutocompleteSuggestions | null>, signal: AbortSignal) {
  return new Promise<AutocompleteSuggestions | null>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); resolve(null); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    task.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

/** An operation probe, not a complete EditorComponent or a production editor. */
export class SerialEditorProbe {
  private view: View;
  private undoViews: View[] = [];
  private tail: Promise<void> = Promise.resolve();
  private nextId = 0;
  private epoch = 0;
  private disposed = false;
  private closing = false;
  private active?: { op: Operation; epoch: number; finish: (applied: boolean) => void };
  private provider = emptyProvider;
  private readonly adapter: AutocompleteProvider;
  private failure?: unknown;
  readonly nativeSubmissions: string[] = [];
  onChange?: (text: string) => void;
  onSubmit?: (text: string) => void;

  constructor(readonly base: CustomEditor, private readonly names: ReadonlySet<string> = new Set(["alpha", "beta"])) {
    if (base.getText() !== base.getExpandedText()) throw new Error("Probe must observe pastes from their source");
    const position = base.getCursor();
    const lines = base.getLines();
    this.view = plain(base.getText(), lines.slice(0, position.line).reduce((size, line) => size + line.length + 1, 0) + position.col);
    this.onChange = base.onChange;
    this.onSubmit = base.onSubmit;
    // Public callback assignment only. No instance method or prototype replacement.
    base.onChange = () => {};
    base.onSubmit = text => { this.nativeSubmissions.push(text); };
    this.adapter = {
      getSuggestions: (lines, line, col, options) => {
        const active = this.active;
        if (active) return Promise.resolve({ prefix: "", items: [{ value: `${active.epoch}:${active.op.id}`, label: "audit" }] });
        const epoch = this.epoch;
        return abortable(this.provider.getSuggestions(lines, line, col, options), options.signal).then(value => epoch === this.epoch ? value : null);
      },
      applyCompletion: (lines, line, col, item, prefix) => {
        const active = this.active;
        if (!active) {
          if (raw(this.view) !== expanded(this.view)) throw new Error("Probe only delegates ordinary completion without folded pastes");
          const result = this.provider.applyCompletion(lines, line, col, item, prefix);
          this.undoViews.push(this.view);
          this.view = plain(result.lines.join("\n"), result.lines.slice(0, result.cursorLine).reduce((size, value) => size + value.length + 1, 0) + result.cursorCol);
          this.onChange?.(this.getText());
          return result;
        }
        if (active.epoch !== this.epoch || item.value !== `${active.epoch}:${active.op.id}`) return { lines, cursorLine: line, cursorCol: col };
        const position = cursor(active.op.view);
        active.finish(true);
        return { lines: raw(active.op.view).split("\n"), cursorLine: position.line, cursorCol: position.col };
      },
    };
    base.setAutocompleteProvider(this.adapter);
  }

  getText() { return raw(this.view); }
  getExpandedText() { return expanded(this.view); }
  getCursor() { return cursor(this.view); }
  async settled() { await this.tail; if (this.failure) throw this.failure; }

  private enqueue(kind: Operation["kind"], view: View, text?: string) {
    const op = { id: ++this.nextId, kind, view, text };
    this.tail = this.tail.then(async () => {
      if (this.disposed) return;
      if (kind === "splice") {
        let applied = false;
        while (!applied && !this.disposed) {
          applied = await new Promise<boolean>(finish => {
            this.active = { op, epoch: this.epoch, finish };
            this.base.setAutocompleteProvider(this.adapter);
            this.base.handleInput("\t");
          });
          this.active = undefined;
        }
      } else if (kind === "set") this.base.setText(text!);
      else if (kind === "undo") this.base.handleInput("\x1b[45;5u");
      else this.base.handleInput("\r");
      if (!this.disposed && this.base.getText() !== raw(view)) throw new Error(`Native commit diverged for operation ${op.id}`);
    }).catch(error => { this.failure = error; });
  }

  private change(kind: Operation["kind"], view: View, text?: string) {
    this.undoViews.push(this.view);
    this.view = view;
    this.enqueue(kind, view, text);
    this.onChange?.(this.getText());
  }

  setText(text: string) {
    if (this.disposed || this.closing) return;
    const normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    if (normalized === this.getText()) {
      this.view = plain(normalized);
      this.enqueue("set", this.view, normalized);
      this.onChange?.(this.getText());
    } else this.change("set", plain(normalized), normalized);
  }

  /** Seed a native folded paste before pending operations. Keep its source identity. */
  async pasteAtEnd(text: string) {
    await this.settled();
    const before = this.view;
    if (before.cursor !== raw(before).length) throw new Error("Probe paste requires the end cursor");
    this.base.handleInput(`\x1b[200~${text}\x1b[201~`);
    const inserted = this.base.getText().slice(raw(before).length);
    const normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
    this.view = { parts: [...before.parts, { raw: inserted, expanded: normalized }], cursor: this.base.getText().length };
    this.undoViews.push(before);
    this.onChange?.(this.getText());
  }

  /** Seed ordinary text without changing a paste registry. */
  async insertAtEnd(text: string) {
    await this.settled();
    const before = this.view;
    if (before.cursor !== raw(before).length) throw new Error("Probe insertion requires the end cursor");
    this.base.insertTextAtCursor(text);
    this.view = { parts: [...before.parts, { raw: text, expanded: text }], cursor: this.base.getText().length };
    this.undoViews.push(before);
    this.onChange?.(this.getText());
  }

  handleInput(data: string) {
    if (this.disposed || this.closing) return;
    if (data === "\x1b[3~" || data === "\x7f") {
      const text = this.getText(), backward = data === "\x7f";
      const reference = findReferences(text).find(value => this.names.has(value.name) && (backward ? value.end === this.view.cursor : value.start === this.view.cursor));
      const start = reference?.start ?? (backward ? this.view.cursor - 1 : this.view.cursor);
      const end = reference?.end ?? (backward ? this.view.cursor : this.view.cursor + 1);
      if (start < 0 || end > text.length) return;
      this.change("splice", replace(this.view, start, end));
    } else if (data === "\x1b[45;5u") {
      const before = this.undoViews.pop();
      if (!before) throw new Error("Probe does not predict unobserved native undo history");
      this.view = before;
      this.enqueue("undo", before);
      this.onChange?.(this.getText());
    } else if (data === "\r") {
      const text = this.getExpandedText().trim();
      this.view = plain(""); this.undoViews = [];
      this.enqueue("submit", this.view);
      this.onChange?.("");
      this.onSubmit?.(text);
    } else if (data === "\x1b") this.cancelAutocomplete();
    else throw new Error("Probe only handles delete, undo, submit and cancel actions");
  }

  setAutocompleteProvider(provider: AutocompleteProvider) { this.provider = provider; this.cancelAutocomplete(); }
  requestAutocomplete() { this.base.handleInput("\t"); }
  cancelAutocomplete() {
    this.epoch++;
    this.base.setAutocompleteProvider(this.adapter);
    this.active?.finish(false);
  }
  async dispose() {
    this.closing = true;
    this.cancelAutocomplete();
    try { await this.settled(); }
    finally {
      this.disposed = true;
      this.cancelAutocomplete();
      this.onChange = undefined; this.onSubmit = undefined;
      this.base.onChange = undefined; this.base.onSubmit = undefined;
    }
  }
}
