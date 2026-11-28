import type { KeybindingsManager, keyText } from "@earendil-works/pi-coding-agent";

export type KeybindingAction = Parameters<typeof keyText>[0];
export type KeybindingsSource = Pick<KeybindingsManager, "getKeys">;

export interface FormatKeyOptions {
  /** Render a standalone "escape" binding as "esc" for compact inline hints. */
  shortEscape?: boolean;
}

export interface HostKeybindingHints {
  keyText(keybinding: KeybindingAction): string;
  keyHint(keybinding: KeybindingAction, description: string): string;
}

/** Format keybinding chords in order, normalizing Darwin alt modifier and optional short Escape. */
export function formatKeyBindings(keys: readonly string[], options: FormatKeyOptions = {}): string {
  if (keys.length === 0) return "";
  return keys
    .map(combo => {
      const normalized = String(combo);
      if (options.shortEscape && normalized.toLowerCase() === "escape") return "esc";
      return normalized
        .split("+")
        .map(part => (process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part))
        .join("+");
    })
    .join("/");
}

/** Resolve one keybinding from the active host manager, preserving explicit unbinding ([]). */
export function bindingText(
  keys: KeybindingsSource | undefined,
  keybinding: KeybindingAction,
  options?: FormatKeyOptions,
): string {
  if (keys) return formatKeyBindings(keys.getKeys(keybinding), options);
  return keybinding === "app.tools.expand" ? "ctrl+o" : "";
}

/** Use the active host's helpers, or the keybindings supplied by its UI. */
export function hostKeybindingHints(
  context: Partial<HostKeybindingHints>,
  keys?: KeybindingsSource,
): HostKeybindingHints {
  const resolvedText = context.keyText
    ? context.keyText.bind(context)
    : (key: KeybindingAction) => bindingText(keys, key);
  const resolvedHint = context.keyHint
    ? context.keyHint.bind(context)
    : (key: KeybindingAction, description: string) => {
      const label = resolvedText(key);
      return label ? `${label} ${description}` : "";
    };
  return {
    keyText: resolvedText,
    keyHint: resolvedHint,
  };
}
