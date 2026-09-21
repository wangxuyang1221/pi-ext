import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { Editor, getKeybindings, decodeKittyPrintable, matchesKey, visibleWidth, type AutocompleteProvider, type Keybinding, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { labelReferences, layoutLabels, type IconMode, type LabelLine } from "./labels.js";
import { paintEditorLine, projectedCursor, sourceSurface, type ProjectedSurface } from "./editor-surface.js";
import type { Reference } from "./references.js";
import { draftParts, normalizedPaste, type DraftHandoff } from "./draft-handoff.js";

export interface LabelEditorOptions { names: () => ReadonlySet<string>; icon: () => IconMode; tui: TUI; handoff?: DraftHandoff; }
type Unit = { id: number; steps: number; labels: Reference[]; typing?: number; sources: Map<number, string> };
const controllers = new WeakMap<object, () => void>();
const draftReaders = new WeakMap<object, () => DraftHandoff>();
const action = (name: string) => `tui.editor.${name}` as Keybinding;
const matches = (data: string, name: string) => getKeybindings().matches(data, action(name));

function keyData(binding: Keybinding): string {
  const key = getKeybindings().getKeys(binding)[0];
  if (!key) throw new Error(`No key is configured for ${binding}`);
  const parts = key.split("+"), name = parts.pop()!;
  const modifier = 1 + (parts.includes("shift") ? 1 : 0) + (parts.includes("alt") ? 2 : 0) + (parts.includes("ctrl") ? 4 : 0);
  const arrows: Record<string, string> = { left: "D", right: "C", up: "A", down: "B", home: "H", end: "F", clear: "E" };
  const functions: Record<string, string> = { f1: "P", f2: "Q", f3: "R", f4: "S" };
  if (functions[name]) return modifier === 1 ? `\x1bO${functions[name]}` : `\x1b[1;${modifier}${functions[name]}`;
  const tilde: Record<string, number> = { insert: 2, pageUp: 5, pageDown: 6, f5: 15, f6: 17, f7: 18, f8: 19, f9: 20, f10: 21, f11: 23, f12: 24 };
  if (tilde[name]) return modifier === 1 ? `\x1b[${tilde[name]}~` : `\x1b[${tilde[name]};${modifier}~`;
  if (arrows[name]) return modifier === 1 ? `\x1b[${arrows[name]}` : `\x1b[1;${modifier}${arrows[name]}`;
  if (name === "backspace" && modifier === 1) return "\x7f";
  if (name === "delete") return modifier === 1 ? "\x1b[3~" : `\x1b[3;${modifier}~`;
  const codes: Record<string, number> = { space: 32, tab: 9, enter: 13, return: 13, escape: 27, backspace: 127 };
  const code = codes[name] ?? (Array.from(name).length === 1 ? name.codePointAt(0)! : undefined);
  if (code === undefined) throw new Error(`Unsupported configured editing key: ${key}`);
  return `\x1b[${code};${modifier}u`;
}

/** Release extension-owned metadata without submitting or rewriting the native draft. */
export function releaseLabelEditor(editor: object): void { controllers.get(editor)?.(); controllers.delete(editor); draftReaders.delete(editor); }
export function captureLabelDraft(editor: object): DraftHandoff | undefined { return draftReaders.get(editor)?.(); }

/** Compose synchronous label actions without replacing methods on the host instance. */
export function createLabelEditor(base: CustomEditor, options: LabelEditorOptions): CustomEditor {
  let labels = labelReferences(base.getText(), options.names());
  let typing: number | undefined;
  let sources = new Map<number, string>(), handoff = options.handoff;
  let nextId = 0, batch = 0, changeSerial = 0, changed = false, word = false, disposed = false;
  let historyIndex = -1, waitingForJump = false;
  const history: string[] = [];
  let forceCompletion: (Unit & { before: string; cursor: number }) | undefined;
  let originalProvider: AutocompleteProvider | undefined;
  const actionHandlers = new Map<Parameters<CustomEditor["onAction"]>[0], () => void>();
  let submissions: string[] = [];
  const units: Unit[] = [];
  let onChange = base.onChange, onSubmit = base.onSubmit;
  let interceptionSerial = 0;
  const callbacks = new Map<PropertyKey, Function | undefined>();
  const callbackKeys = new Set(["onEscape", "onCtrlD", "onPasteImage", "onExtensionShortcut"]);
  const assignCallback = (key: string, value: Function | undefined) => {
    callbacks.set(key, value);
    Reflect.set(base, key, value ? (...args: unknown[]) => {
      const result = value.apply(base, args);
      if (key !== "onExtensionShortcut" || result === true) interceptionSerial++;
      return result;
    } : undefined);
  };
  for (const key of callbackKeys) assignCallback(key, Reflect.get(base, key));
  const offset = () => {
    const cursor = base.getCursor();
    return base.getLines().slice(0, cursor.line).reduce((sum, line) => sum + line.length + 1, 0) + cursor.col;
  };
  const capture = (): Unit => ({ id: ++nextId, steps: 1, labels, typing, sources: new Map(sources) });
  const resolve = (explicit: boolean) => {
    typing = explicit ? undefined : offset();
    const text = base.getText(), resolved = labelReferences(text, options.names());
    labels = resolved.filter(value => explicit || typing === undefined || typing <= value.start || typing > value.end ||
      labels.some(previous => previous.start === value.start && previous.end === value.end && previous.name === value.name));
  };
  const recordCompletion = () => {
    const completion = forceCompletion; if (!completion) return;
    const previous = units.at(-1);
    const unchangedLabel = completion.before === base.getText() && completion.cursor === offset() &&
      labelReferences(completion.before, options.names()).some(value => value.end === completion.cursor);
    // Native completion always pushes, even if only recognition changed. Absorb that
    // snapshot into the preceding source action rather than exposing a visual-only undo.
    if (unchangedLabel && previous) previous.steps += completion.steps;
    else units.push(completion);
    forceCompletion = undefined; word = false;
  };
  const emit = () => {
    const notify = changed, text = base.getText(), submitted = submissions;
    changed = false; submissions = [];
    if (notify) onChange?.(text);
    for (const value of submitted) onSubmit?.(value);
  };
  base.onChange = () => {
    if (disposed) return;
    changed = true; changeSerial++;
    if (!batch) {
      manualScroll = false;
      if (forceCompletion) recordCompletion();
      resolve(true); emit();
    }
  };
  base.onSubmit = text => {
    units.length = 0; labels = []; sources.clear(); typing = undefined; word = false; forceCompletion = undefined; historyIndex = -1;
    if (!disposed) submissions.push(text);
    if (!batch) emit();
  };
  const transaction = (run: () => void) => {
    batch++;
    try { run(); } finally { batch--; if (!batch) emit(); }
  };
  const native = (binding: Keybinding) => Editor.prototype.handleInput.call(base, keyData(binding));
  const mutate = (run: () => void, explicit: boolean, force = false) => transaction(() => {
    if (disposed) { run(); return; }
    const before = base.getText(), unit = capture();
    run();
    if (base.getText() !== before || force) units.push(unit);
    word = false; historyIndex = -1; manualScroll = false; resolve(explicit);
  });
  let inPaste = false, pasteBuffer = "";
  const rememberPaste = (text: string, position: number) => {
    if (text.length <= 1000 && text.split("\n").length <= 10) return;
    const marker = base.getText().slice(position).match(/^\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/);
    if (!marker) throw new Error("Native folded paste marker was not emitted at its source position");
    sources.set(Number(marker[1]), text);
  };
  let visual: LabelLine[] = [], scroll = 0, visibleRows = 0, nativeBodyRows = 0, padding = 0, manualScroll = false;
  const scrollBy = (distance: number) => {
    const before = scroll, rows = Math.max(5, Math.floor(options.tui.terminal.rows * 0.3));
    scroll = Math.max(0, Math.min(Math.max(0, visual.length - rows), scroll + distance));
    manualScroll = true; return before !== scroll;
  };
  let preferredColumn: number | undefined;
  let layoutKey = "", layoutLabelsIdentity: Reference[] | undefined;
  let namesKey = [...options.names()].join("\0");
  const refreshNames = () => {
    const names = options.names(), current = [...names].join("\0");
    if (current !== namesKey) {
      namesKey = current;
      const previous = labels;
      labels = labelReferences(base.getText(), names).filter(value => typing === undefined || typing <= value.start || typing > value.end ||
        previous.some(old => old.start === value.start && old.end === value.end && old.name === value.name));
    }
  };
  const snap = (target: number, direction = 0) => {
    const ref = labels.find(value => value.start < target && target < value.end);
    return ref ? direction < 0 ? ref.start : direction > 0 ? ref.end : target - ref.start < (ref.end - ref.start) / 2 ? ref.start : ref.end : target;
  };
  const moveTo = (target: number) => {
    for (let attempts = 0; attempts <= base.getText().length; attempts++) {
      const before = offset(); if (before === target) return;
      native(action(before < target ? "cursorRight" : "cursorLeft"));
      const after = offset();
      if (after === before || (before < target && after > target) || (before > target && after < target)) return;
    }
  };
  const targetColumn = (row: number, column: number) => {
    const line = visual[row]; let total = 0;
    for (const cell of line.cells) { if (total + cell.width > column) return cell.hitTarget ?? cell.start; total += cell.width; }
    return line.end;
  };
  const methods: Record<string, Function> = {
    onAction: (name: Parameters<CustomEditor["onAction"]>[0], handler: () => void) => {
      actionHandlers.set(name, handler);
      base.onAction(name, () => { interceptionSerial++; handler(); });
    },
    render: (width: number) => {
      if (width <= 0) return [];
      if (disposed) return base.render(width);
      refreshNames();
      if (!labels.length) { visual = []; layoutLabelsIdentity = undefined; layoutKey = ""; return base.render(width); }
      padding = Math.min(base.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
      const contentWidth = Math.max(1, width - 2 * padding), layoutWidth = Math.max(1, contentWidth - (padding ? 0 : 1));
      const raw = base.getText(), key = `${layoutWidth}:${options.icon()}:${raw}`;
      if (key !== layoutKey || labels !== layoutLabelsIdentity) {
        visual = layoutLabels(raw, labels, options.icon(), layoutWidth); layoutKey = key; layoutLabelsIdentity = labels;
      }
      const point = projectedCursor(visual, offset()), maxRows = Math.max(5, Math.floor(options.tui.terminal.rows * 0.3));
      if (!manualScroll) {
        if (point.row < scroll) scroll = point.row;
        else if (point.row >= scroll + maxRows) scroll = point.row - maxRows + 1;
      }
      scroll = Math.max(0, Math.min(scroll, visual.length - maxRows));
      const window = visual.slice(scroll, scroll + maxRows); visibleRows = window.length;
      const content = window.map((line, index) => {
        const text = paintEditorLine(line, scroll + index === point.row ? offset() : undefined, base.focused);
        return " ".repeat(padding) + text + " ".repeat(Math.max(0, width - padding - visibleWidth(text)));
      });
      const surface = sourceSurface(base, width, options.tui.terminal.rows); nativeBodyRows = surface.nativeBodyRows;
      const host = base as CustomEditor & Partial<ProjectedSurface>;
      const below = visual.length - scroll - visibleRows;
      return host.renderProjectedLines?.(width, content, surface.menu, scroll, below) ??
        [base.borderColor("─".repeat(width)), ...content, base.borderColor("─".repeat(width)), ...surface.menu];
    },
    handleMouse: (event: TuiMouseEvent) => {
      if (!visual.length || !labels.length) return base.handleMouse(event);
      if (event.y >= visibleRows + 2) return base.handleMouse({ ...event, y: event.y - visibleRows + nativeBodyRows });
      if (event.type === "wheel" && scrollBy(event.wheelDelta ?? 0)) return { handled: true, render: true };
      if (event.type !== "click" || event.button !== "left") return undefined;
      manualScroll = false;
      if (event.y > 0 && event.y <= visibleRows) {
        const target = snap(targetColumn(scroll + event.y - 1, Math.max(0, event.x - padding)));
        base.handleMouse({ ...event, x: padding, y: 1 }); moveTo(target);
        word = false; historyIndex = -1; preferredColumn = undefined;
      }
      return { handled: true, focus: true, render: true };
    },
    addToHistory: (text: string) => {
      const value = text.trim();
      if (value && history[0] !== value) { history.unshift(value); if (history.length > 100) history.pop(); }
      base.addToHistory(text);
    },
    setText: (text: string) => {
      const transfer = handoff; handoff = undefined;
      if (!disposed && transfer && (text === transfer.raw || text === transfer.expanded)) {
        transaction(() => {
          const unit = capture(); let steps = 0;
          if (base.getText()) { base.setText(""); steps++; }
          sources.clear();
          for (const part of transfer.parts) {
            if (!part.text) continue;
            const position = offset();
            if (part.paste) {
              base.handleInput(`\x1b[200~${part.text}\x1b[201~`);
              rememberPaste(part.text, position);
            } else base.insertTextAtCursor(part.text);
            steps++;
          }
          if (steps) units.push({ ...unit, steps });
          word = false; historyIndex = -1; resolve(true);
        });
      } else mutate(() => { base.setText(text); sources.clear(); }, true);
    },
    insertTextAtCursor: (text: string) => { if (text) mutate(() => base.insertTextAtCursor(text), true, true); },
    setAutocompleteProvider: (provider: AutocompleteProvider) => {
      originalProvider = provider;
      base.setAutocompleteProvider({
      ...provider,
      getSuggestions: (...args) => provider.getSuggestions(...args),
      applyCompletion: (...args) => {
        forceCompletion = { ...capture(), before: base.getText(), cursor: offset() };
        return provider.applyCompletion(...args);
      },
      shouldTriggerFileCompletion: (...args) => provider.shouldTriggerFileCompletion?.(...args) ?? true,
      });
    },
    handleInput: (data: string) => {
      if (disposed) return;
      refreshNames();
      let remainder = "";
      const wasPaste = inPaste || data.includes("\x1b[200~");
      if (wasPaste) {
        const end = data.indexOf("\x1b[201~");
        if (end !== -1) { remainder = data.slice(end + 6); data = data.slice(0, end + 6); }
      }
      transaction(() => {
        const before = base.getText(), position = offset(), unit = capture();
        const showingAutocomplete = base.isShowingAutocomplete();
        const vertical = matches(data, "cursorUp") || matches(data, "pageUp") ? -1 : matches(data, "cursorDown") || matches(data, "pageDown") ? 1 : 0;
        const point = visual.length ? projectedCursor(visual, position) : undefined;
        const paging = matches(data, "pageUp") || matches(data, "pageDown");
        if (!paging) manualScroll = false;
        if (!vertical) preferredColumn = undefined;
        const pasting = inPaste || data.includes("\x1b[200~");
        if (data.includes("\x1b[200~")) { inPaste = true; pasteBuffer = ""; }
        if (pasting) pasteBuffer += data.replace("\x1b[200~", "").replace("\x1b[201~", "");
        const completedPaste = pasting && data.includes("\x1b[201~");
        if (completedPaste) inPaste = false;
        const undo = !pasting && matches(data, "undo");
        const kill = ["deleteToLineEnd", "deleteToLineStart", "deleteWordBackward", "deleteWordForward"].some(name => matches(data, name));
        const backward = !pasting && !kill && (matches(data, "deleteCharBackward") || matchesKey(data, "shift+backspace"));
        const forward = !pasting && !kill && !backward && (matches(data, "deleteCharForward") || matchesKey(data, "shift+delete"));
        const left = !pasting && matches(data, "cursorLeft"), right = !pasting && matches(data, "cursorRight");
        const reference = labels.find(value => backward || left ? value.end === position : value.start === position);
        const undoUnit = undo ? units.at(-1) : undefined;
        const changesBefore = changeSerial, interceptBefore = interceptionSerial, unitsBefore = units.length;
        const historyDirection = matches(data, "historyPrevious") || matches(data, "cursorUp") ? 1
          : matches(data, "historyNext") || matches(data, "cursorDown") ? -1 : 0;
        base.handleInput(data);
        if (submissions.length || interceptionSerial !== interceptBefore || units.length !== unitsBefore) return;
        const jumpKey = matches(data, "jumpForward") || matches(data, "jumpBackward");
        const jumpCharacter = decodeKittyPrintable(data) ?? (data.charCodeAt(0) >= 32 ? data : undefined);
        if (waitingForJump) {
          waitingForJump = false;
          if (jumpKey) return;
          if (jumpCharacter !== undefined) { word = false; return; }
        } else if (!pasting && jumpKey && changeSerial === changesBefore && offset() === position) {
          waitingForJump = true; return;
        }
        if (completedPaste && pasteBuffer.length) rememberPaste(normalizedPaste(pasteBuffer, before[position - 1] ?? ""), position);
        if (undo) {
          if (undoUnit && changeSerial !== changesBefore) {
            units.pop();
            for (let i = 1; i < undoUnit.steps; i++) Editor.prototype.handleInput.call(base, data);
            const names = options.names();
            labels = undoUnit.labels.filter(value => names.has(value.name)); typing = undoUnit.typing; sources = new Map(undoUnit.sources);
          }
          word = false; historyIndex = -1;
          return;
        }
        if (backward && base.getText().length < before.length) {
          const removed = before.slice(offset(), position).match(/^\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]$/);
          if (removed && sources.has(Number(removed[1]))) {
            const id = Number(removed[1]);
            sources = new Map([...sources].filter(([key]) => key !== id).map(([key, value]) => [key > id ? key - 1 : key, value]));
          }
        }
        if (historyDirection && changeSerial !== changesBefore && !forceCompletion && !pasting) {
          const next = Math.max(-1, Math.min(history.length - 1, historyIndex + historyDirection));
          if (historyIndex === -1 && next >= 0) units.push(unit);
          historyIndex = next; word = false; resolve(true); return;
        }
        if ((backward || forward) && reference && base.getText().length < before.length) {
          let steps = 1;
          const target = before.length - (reference.end - reference.start);
          while (base.getText().length > target) {
            const size = base.getText().length;
            Editor.prototype.handleInput.call(base, data);
            if (base.getText().length >= size) break;
            steps++;
          }
          unit.steps = steps; units.push(unit); word = false; historyIndex = -1; resolve(true); return;
        }
        if ((left || right) && reference && offset() !== position) {
          const target = left ? reference.start : reference.end;
          while (left ? offset() > target : offset() < target) {
            const old = offset(); Editor.prototype.handleInput.call(base, data); if (old === offset()) break;
          }
        }
        if (vertical && point && labels.length && !showingAutocomplete && base.getText() === before && !pasting) {
          const rows = Math.max(5, Math.floor(options.tui.terminal.rows * 0.3));
          if (paging && labels.some(value => projectedCursor(visual, value.end).row - projectedCursor(visual, value.start).row + 1 > rows)) {
            // An indivisible label can be taller than the viewport. Page its display
            // independently so every row is accessible without a caret inside it.
            scrollBy(vertical * rows); moveTo(snap(offset(), vertical)); word = false; preferredColumn = undefined; return;
          }
          const distance = paging ? rows : 1;
          const row = Math.max(0, Math.min(visual.length - 1, point.row + vertical * distance));
          if (row !== point.row) {
            preferredColumn ??= point.column;
            moveTo(snap(targetColumn(row, preferredColumn), vertical));
          }
        }
        if (forceCompletion) {
          recordCompletion(); resolve(true); return;
        }
        const printable = decodeKittyPrintable(data) ?? (data.charCodeAt(0) >= 32 && !data.includes("\x1b") ? data : undefined);
        if (base.getText() !== before || (completedPaste && pasteBuffer.length)) {
          const otherAction = ["deleteCharBackward", "deleteCharForward", "deleteWordBackward", "deleteWordForward", "deleteToLineStart", "deleteToLineEnd", "yank", "yankPop"].some(name => matches(data, name));
          const typingWord = !pasting && printable !== undefined && !otherAction;
          // Native Enter after a backslash pushes a deletion and a newline snapshot.
          if (!pasting && before[position - 1] === "\\" && getKeybindings().matches(data, "tui.input.submit") && changeSerial - changesBefore === 2) unit.steps = 2;
          if (!typingWord || !word || /^\s+$/u.test(printable!)) units.push(unit);
          word = typingWord; historyIndex = -1;
          resolve(pasting || (!typingWord && !backward && !forward));
        } else if (offset() !== position || backward || forward ||
          ["cursorLeft", "cursorRight", "cursorUp", "cursorDown", "cursorLineStart", "cursorLineEnd", "cursorWordLeft", "cursorWordRight", "pageUp", "pageDown"].some(name => matches(data, name))) word = false;
      });
      if (remainder) methods.handleInput(remainder);
    },
  };
  const bound = new Map<PropertyKey, Function>();
  const editor = new Proxy(base, {
    get(target, key) {
      if (key === "onChange") return onChange;
      if (key === "onSubmit") return onSubmit;
      if (callbacks.has(key)) return callbacks.get(key);
      if (typeof key === "string" && methods[key]) return methods[key];
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (!bound.has(key)) bound.set(key, value.bind(target));
      return bound.get(key);
    },
    set(target, key, value) {
      if (key === "onChange") { onChange = value; return true; }
      if (key === "onSubmit") { onSubmit = value; return true; }
      if (typeof key === "string" && callbackKeys.has(key)) { assignCallback(key, value); return true; }
      return Reflect.set(target, key, value, target);
    },
  });
  draftReaders.set(editor, () => {
    const raw = base.getText(), expanded = base.getExpandedText(), parts = draftParts(raw, sources);
    if (parts.map(part => part.text).join("") !== expanded) throw new Error("Cannot reconstruct native paste sources for reload");
    return { raw, expanded, parts };
  });
  controllers.set(editor, () => {
    disposed = true; units.length = 0; history.length = 0; labels = []; sources.clear(); handoff = undefined; pasteBuffer = ""; forceCompletion = undefined; submissions = [];
    onChange = undefined; onSubmit = undefined; base.onChange = undefined; base.onSubmit = undefined;
    for (const key of callbackKeys) Reflect.set(base, key, callbacks.get(key));
    if (originalProvider) base.setAutocompleteProvider(originalProvider);
    originalProvider = undefined;
    for (const [name, handler] of actionHandlers) base.onAction(name, handler);
    actionHandlers.clear(); callbacks.clear(); bound.clear(); visual = []; layoutLabelsIdentity = undefined; layoutKey = "";
  });
  return editor;
}
