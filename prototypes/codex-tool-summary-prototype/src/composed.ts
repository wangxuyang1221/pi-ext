// PROTOTYPE: Keep production Codex UI and intercept only the Write definition.
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import { registerSummaryLab } from "./index.js";

export default function composed(pi: ExtensionAPI): void {
  let write: ToolDefinition | undefined;
  codexUi(new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerTool") return (tool: ToolDefinition) => {
        if (tool.name === "write") write = tool;
        else target.registerTool(tool);
      };
      return Reflect.get(target, property, receiver);
    },
  }));
  if (!write) throw new Error("Production Write renderer was not registered.");
  registerSummaryLab(pi, write);
  pi.registerProvider("summary-ui-fixture", {
    api: "openai-responses", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-not-a-secret",
    models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1 }],
    streamSimple() { throw new Error("Model requests are disabled in this UI prototype."); },
  });
}
