import { CustomEditor, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { CodexEditor } from "../../../extensions/codex-ui/src/components.js";
import { findReferences } from "../../../extensions/skill-mentions/src/references.js";

export const undoKey = "\x1b[45;5u";
export type Kind = "native" | "codex";
export type Direction = "backward" | "forward";
export type Group = { steps: number };

export function createEditor(kind: Kind = "native"): CustomEditor {
  const identity = (value: string) => value;
  const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {} } as unknown as TUI;
  const keys = { matches: () => false } as unknown as KeybindingsManager;
  const theme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
  return kind === "native" ? new CustomEditor(tui, theme, keys) : new CodexEditor(tui, theme, keys, () => ({ fg: (_key: string, value: string) => value, getBgAnsi: () => "" }) as unknown as Theme);
}

export function paste(editor: CustomEditor, text: string) {
  editor.handleInput(`\x1b[200~${text}\x1b[201~`);
}

/** A synchronous operation counter for this probe, not a product editor wrapper. */
export function deleteReference(editor: CustomEditor, direction: Direction): Group {
  const text = editor.getText(), cursor = editor.getCursor(), lines = editor.getLines();
  const offset = lines.slice(0, cursor.line).reduce((size, line) => size + line.length + 1, 0) + cursor.col;
  const reference = findReferences(text).find(value => direction === "backward" ? value.end === offset : value.start === offset);
  if (!reference) throw new Error("Expected a complete reference at the cursor boundary");
  const token = text.slice(reference.start, reference.end);
  const steps = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(token)].length;
  for (let i = 0; i < steps; i++) editor.handleInput(direction === "backward" ? "\x7f" : "\x1b[3~");
  return { steps };
}

export function undoGroup(editor: CustomEditor, group: Group) {
  for (let i = 0; i < group.steps; i++) editor.handleInput(undoKey);
}
