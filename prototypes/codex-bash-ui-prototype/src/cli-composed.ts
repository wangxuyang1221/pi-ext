// PROTOTYPE: Keep the real production UI around the replacement Bash rows.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import cliPrototype from "./cli-index.js";

export default function composed(pi: ExtensionAPI): void {
  codexUi(pi);
  cliPrototype(pi);
}
