// PROTOTYPE: Settings are written only inside the launcher's isolated agent directory.
import { MODEL, PROVIDER } from "./fixture.js";

export function prototypeSettings(variant: string) {
  return {
    theme: "codex-pi", quietStartup: true, defaultProvider: PROVIDER, defaultModel: MODEL,
    defaultThinkingLevel: "medium", outputPad: (variant === "current" ? 1 : 0) as 0 | 1,
    terminal: { mode: "regular", showTerminalProgress: false },
    compaction: { enabled: false }, retry: { enabled: false },
  };
}
