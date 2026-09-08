// PROTOTYPE: Reuse the real CLI fixture with inline thinking presentation only.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import reasoningLab from "./index.js";
import inlineCodexUi from "./inline.js";

export default function inlineLab(pi: ExtensionAPI): void {
  reasoningLab(pi, inlineCodexUi);
}
