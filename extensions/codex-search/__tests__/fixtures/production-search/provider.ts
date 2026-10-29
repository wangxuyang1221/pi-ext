import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function productionSearchProvider(pi: ExtensionAPI) {
  const root = process.env.PI_VERIFY_ROOT!;
  const record = (type: string, data: unknown) => {
    appendFileSync(join(root, "events.jsonl"), JSON.stringify({ type, data }) + "\n");
  };
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== process.env.AUDIT_ORIGIN) {
      record("blocked-network", { url: url.toString() });
      throw new Error("Fixture rejects non-loopback service network");
    }
    return nativeFetch(input, init);
  };
  // This synthetic value supplies only the account shape required by the production transport.
  const token = `fixture.${Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "fixture" },
  })).toString("base64url")}.fixture`;
  pi.registerProvider("openai-codex", { apiKey: token });
  const faux = fauxProvider({ api: "audit-faux" });
  faux.setResponses(Array.from({ length: 120 }, () => async context => {
    const last = context.messages.at(-1);
    record("request", context.messages);
    if (last?.role === "user") {
      const text = typeof last.content === "string" ? last.content : last.content
        .filter(item => item.type === "text").map(item => item.text).join("");
      if (text.startsWith("AUDIT ")) {
        const { name, args } = JSON.parse(text.slice(6));
        return fauxAssistantMessage({
          type: "toolCall", id: `audit-${Date.now()}`, name, arguments: args,
        }, { stopReason: "toolUse" });
      }
    }
    return fauxAssistantMessage("Audit turn complete.");
  }));
  pi.registerProvider(faux.provider);
  pi.registerCommand("audit-active", {
    description: "Read active tool names",
    handler: async (_args, ctx) => {
      const data = { tools: pi.getActiveTools(), sessionId: ctx.sessionManager.getSessionId() };
      record("active", data);
      ctx.ui.notify(JSON.stringify(data));
    },
  });
  pi.on("resources_discover", () => record("ready", true));
  pi.on("tool_execution_end", event => record("tool", event));
  pi.on("agent_settled", () => record("settled", true));
}
