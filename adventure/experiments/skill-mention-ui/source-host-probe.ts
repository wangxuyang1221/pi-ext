import { CURSOR_MARKER, matchesKey, sliceByColumn, stripTerminalSequences, visibleWidth, type Editor, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { paintBackground } from "../../../extensions/codex-ui/src/layout.js";
import { sourceModelProbe } from "./source-model-probe.js";
import { knownReferences } from "./ui.js";

export type HostOptions = { rows: () => number; codex: boolean; background: () => string; icon: "cube" | "command" };

// Current-host integration probe. Frame boundary discovery is deliberately
// limited to the native/Codex output under test, not arbitrary custom editors.
export function sourceHostProbe(base: Editor, names: ReadonlySet<string>, options: HostOptions): Editor {
  const model = sourceModelProbe(base, names, options.icon, text => knownReferences(text, names));
  let scroll = 0;
  let last: { width: number; contentWidth: number; padding: number; visible: number; rawVisible: number } | undefined;
  function render(width: number) {
    const original = base.render(width);
    if (!model.hasAtoms() || width < 3) { last = undefined; return original; }
    const padding = Math.min(base.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
    const contentWidth = Math.max(1, width - padding * 2 - (padding ? 0 : 1));
    const rows = model.render(contentWidth);
    const cursor = model.cursorPoint(model.sourceOffset(), contentWidth);
    const maxRows = Math.max(5, Math.floor(options.rows() * 0.3));
    if (cursor.row < scroll) scroll = cursor.row;
    if (cursor.row >= scroll + maxRows) scroll = cursor.row - maxRows + 1;
    scroll = Math.max(0, Math.min(scroll, rows.length - maxRows));
    let bottom = -1;
    for (let index = original.length - 1; index > 0; index--) {
      const plain = stripTerminalSequences(original[index]);
      if (options.codex ? plain.trim().length === 0 : /^─+$|^─── [↑↓] \d+ more /u.test(plain)) { bottom = index; break; }
    }
    if (bottom < 1) throw new Error("Unsupported editor frame in source projection probe");
    const visible = rows.slice(scroll, scroll + maxRows);
    const output = visible.map((row, index) => {
      const logicalRow = scroll + index;
      let body = row;
      if (logicalRow === cursor.row) {
        const before = sliceByColumn(row, 0, cursor.col, true);
        const tail = sliceByColumn(row, cursor.col, Math.max(0, visibleWidth(row) - cursor.col), true);
        const char = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(stripTerminalSequences(tail))][0]?.segment ?? " ";
        const cell = sliceByColumn(tail, 0, visibleWidth(char), true) || " ";
        const after = sliceByColumn(tail, visibleWidth(char), Math.max(0, visibleWidth(tail) - visibleWidth(char)), true);
        body = before + (base.focused ? CURSOR_MARKER : "") + "\x1b[7m" + cell + "\x1b[27m" + after;
      }
      const prefix = options.codex && index === 0 ? sliceByColumn(original[1], 0, padding, true) : " ".repeat(padding);
      const padded = prefix + body + " ".repeat(Math.max(0, width - visibleWidth(prefix + body)));
      return options.codex ? paintBackground(padded, width, options.background()) : padded;
    });
    last = { width, contentWidth, padding, visible: visible.length, rawVisible: bottom - 1 };
    return [original[0], ...output, original[bottom], ...original.slice(bottom + 1)];
  }
  function input(data: string) {
    if (last && model.hasAtoms() && !base.isShowingAutocomplete() && (matchesKey(data, "up") || matchesKey(data, "down"))) {
      const point = model.cursorPoint(model.sourceOffset(), last.contentWidth);
      const row = point.row + (matchesKey(data, "up") ? -1 : 1);
      const rows = model.render(last.contentWidth);
      if (row >= 0 && row < rows.length) { model.placeCursor(row, point.col, last.contentWidth); return; }
    }
    model.handleInput(data);
  }
  function mouse(event: TuiMouseEvent) {
    if (!last) return base.handleMouse(event);
    if (event.y >= last.visible + 2) return base.handleMouse({ ...event, y: event.y - last.visible + last.rawVisible });
    if (event.type === "click" && event.button === "left" && event.y > 0 && event.y <= last.visible) {
      model.placeCursor(scroll + event.y - 1, Math.max(0, event.x - last.padding), last.contentWidth);
      return { handled: true, focus: true };
    }
    // Native screen-level drag selection and copy remain untouched.
    return undefined;
  }
  return new Proxy(base, {
    get(target, key) {
      if (key === "render") return render;
      if (key === "handleInput") return input;
      if (key === "handleMouse") return mouse;
      if (key === "setText") return model.setText;
      if (key === "onChange") return model.onChange;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (key === "onChange") { model.onChange = value; return true; }
      return Reflect.set(target, key, value, target);
    },
  });
}
