import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Substitute only the model service. Commands, tools, dialogs and storage stay real.
export default function (pi: ExtensionAPI): void {
  const root = process.env.PI_VERIFY_ROOT!;
  const record = (type: string, data: unknown) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ type, data }) + "\n");
  const faux = fauxProvider({ api: "verification-faux" });
  faux.setResponses(Array.from({ length: 30 }, () => async context => {
    record("request", context.messages);
    const last = context.messages.at(-1);
    if (last?.role === "user" && JSON.stringify(last).includes("WRITE_PROOF")) {
      return fauxAssistantMessage({ type: "toolCall", id: `write-${Date.now()}`, name: "write", arguments: { path: "proof.txt", content: "approved\n" } }, { stopReason: "toolUse" });
    }
    return fauxAssistantMessage("Verification response");
  }));
  pi.registerProvider(faux.provider);
  pi.on("resources_discover", () => record("ready", true));
  pi.on("tool_execution_end", event => record("tool", event));
  pi.on("agent_settled", () => record("settled", true));
}
