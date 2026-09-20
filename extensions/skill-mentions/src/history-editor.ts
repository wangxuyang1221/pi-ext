import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorComponent } from "@earendil-works/pi-tui";
import { decodeSnapshot } from "./protocol.js";

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;
const adapted = Symbol.for("pi-ext/skill-mentions/history-editor-v1");
const originalText = (text: string) => decodeSnapshot(text)?.task ?? text;

function wrapEditor(base: EditorComponent): EditorComponent {
  if (Reflect.get(base, adapted)) return base;
  const methods = new Map<PropertyKey, { source: Function; bound: Function }>();
  return new Proxy(base, {
    get(target, key) {
      if (key === adapted) return true;
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      let cached = methods.get(key);
      if (!cached || cached.source !== value) {
        const bound = key === "setText" || key === "addToHistory"
          ? (text: string) => value.call(target, originalText(text))
          : value.bind(target);
        cached = { source: value, bound };
        methods.set(key, cached);
      }
      return cached.bound;
    },
    set: (target, key, value) => Reflect.set(target, key, value, target),
  });
}

/** Compose history normalization after session_start editor installers have run. */
export function installHistoryEditor(ctx: ExtensionContext): void {
  if (ctx.mode !== "tui") return;
  const previous = ctx.ui.getEditorComponent();
  if (previous && Reflect.get(previous, adapted)) return;
  const factory: EditorFactory = (tui, theme, keys) => wrapEditor(
    previous?.(tui, theme, keys) ?? new CustomEditor(tui, theme, keys, { embedWorkingStatus: true }),
  );
  Object.defineProperty(factory, adapted, { value: true });
  ctx.ui.setEditorComponent(factory);
}
