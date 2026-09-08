// PROTOTYPE: Run production Codex UI; intercept only the Read registration.
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import codexUi from "../../../extensions/codex-ui/src/index.js";
import { registerReadLab } from "./index.js";
export default function composed(pi: ExtensionAPI): void {
  let read: ToolDefinition | undefined;
  codexUi(new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerTool") return (tool: ToolDefinition) => {
        if (tool.name === "read") read = tool;
        else target.registerTool(tool);
      };
      return Reflect.get(target, property, receiver);
    },
  }));
  if (!read) throw new Error("Production Read renderer was not registered.");
  registerReadLab(pi, read);
  pi.registerProvider("read-ui-fixture", {
    api: "openai-responses", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-not-a-secret",
    models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1 }],
    streamSimple() { throw new Error("Model requests are disabled in this UI prototype."); },
  });
}
