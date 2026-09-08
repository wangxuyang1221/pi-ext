// PROTOTYPE: Keep current production dependencies out of the frozen comparison entries.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import reasoningLab from "./index.js";
import fixedCodexUi from "./fixed.js";

export default function fixedLab(pi: ExtensionAPI): void {
  reasoningLab(pi, fixedCodexUi);
}
