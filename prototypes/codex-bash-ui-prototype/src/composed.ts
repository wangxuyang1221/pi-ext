// PROTOTYPE: Keep the production Codex UI; replace only its Bash presentation.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import bashUiPrototype from "./index.js";
import { registerTitleSpinnerLab } from "./title-spinner.js";

export default function composed(pi: ExtensionAPI): void {
  codexUi(pi);
  bashUiPrototype(pi);
  if (process.env.PI_TITLE_SPINNER_LAB === "1") registerTitleSpinnerLab(pi);
}
