import { writeFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function dialogs(pi: ExtensionAPI) {
  pi.registerCommand("acceptance-dialogs", {
    description: "Exercise concurrent permission selectors in the real TUI",
    handler: async (_args, ctx) => {
      const first = ctx.ui.select("FIRST-PERMISSION", ["Deny", "Allow"]);
      await new Promise(resolve => setTimeout(resolve, 100));
      const second = ctx.ui.select("SECOND-PERMISSION", ["Deny", "Allow"]);
      const results = await Promise.all([first, second]);
      await writeFile(process.env.PI_DIALOG_RESULTS!, JSON.stringify(results));
      ctx.ui.notify("DIALOGS-DONE", "info");
    },
  });
}
