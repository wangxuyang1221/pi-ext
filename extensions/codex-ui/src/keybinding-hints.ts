import type { KeybindingsManager, keyText } from "@earendil-works/pi-coding-agent";

type Keybinding = Parameters<typeof keyText>[0];
export interface HostKeybindingHints {
  keyText(keybinding: Keybinding): string;
  keyHint(keybinding: Keybinding, description: string): string;
}

/** Use the active host's helpers, or the keybindings supplied by its UI. */
export function hostKeybindingHints(context: Partial<HostKeybindingHints>, keys?: Pick<KeybindingsManager, "getKeys">): HostKeybindingHints {
  const text = (key: Keybinding) => keys?.getKeys(key).map(value => String(value).replace(/alt/gi, process.platform === "darwin" ? "option" : "alt")).join("/") ?? "ctrl+o";
  return {
    keyText: context.keyText?.bind(context) ?? text,
    keyHint: context.keyHint?.bind(context) ?? ((key, description) => `${text(key)} ${description}`),
  };
}
