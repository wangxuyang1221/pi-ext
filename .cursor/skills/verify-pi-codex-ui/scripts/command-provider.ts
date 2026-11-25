import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Substitute only the model service. Commands, tools, dialogs and storage stay real.
export default function (pi: ExtensionAPI): void {
  const root = process.env.PI_VERIFY_ROOT!;
  const record = (type: string, data: unknown) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ type, data }) + "\n");
  const faux = fauxProvider({ api: "verification-faux" });
  const planPath = join(root, "responses.json");
  const cursorPath = join(root, "responses-cursor.json");
  const plan = existsSync(planPath) ? JSON.parse(readFileSync(planPath, "utf8")) as Array<{
    text?: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown>; id?: string }>;
    error?: string;
  }> : [];
  let cursor = existsSync(cursorPath) ? JSON.parse(readFileSync(cursorPath, "utf8")) as number : 0;
  faux.setResponses(Array.from({ length: 100 }, () => async context => {
    record("request", context.messages);
    const planned = plan[cursor];
    if (planned) {
      cursor += 1;
      writeFileSync(cursorPath, JSON.stringify(cursor));
      record("response-plan", { index: cursor - 1, response: planned });
      const calls = planned.toolCalls?.map((call, index) => ({ type: "toolCall" as const,
        id: call.id ?? `planned-${cursor}-${index}`, name: call.name, arguments: call.arguments })) ?? [];
      const content = [...(planned.text ? [{ type: "text" as const, text: planned.text }] : []), ...calls];
      return fauxAssistantMessage(content, { stopReason: planned.error ? "error" : calls.length ? "toolUse" : "stop",
        ...(planned.error ? { errorMessage: planned.error } : {}) });
    }
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
