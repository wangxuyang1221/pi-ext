import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Keeps host smoke tests offline while exercising the production MCP extension. */
export default function fixture(pi: ExtensionAPI): void {
  pi.registerProvider("mcp-ui-host-fixture", {
    name: "MCP UI host fixture", baseUrl: "http://127.0.0.1:1", apiKey: "fixture-not-a-credential",
    api: "mcp-ui-host-fixture",
    models: [{
      id: "ui-test", name: "UI test", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096,
    }],
    streamSimple() { throw new Error("Model calls are disabled in MCP host tests"); },
  });
  pi.on("session_start", (_event, ctx) => ctx.ui.notify("MCP UI host ready", "info"));
  pi.on("input", () => ({ action: "handled" }));
  pi.on("user_bash", () => ({ result: { output: "Disabled in MCP host tests", exitCode: 0, cancelled: false, truncated: false } }));
  pi.registerCommand("mcp-ui-quit", { description: "Exit the MCP host test", handler: async (_args, ctx) => ctx.shutdown() });
}
