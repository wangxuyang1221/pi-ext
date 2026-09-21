import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Local-only peer for installed-package coexistence acceptance. No network listener.
const log = (type, data) => appendFileSync(process.argv[2], `${JSON.stringify({ type, data })}\n`);
const server = new Server({ name: "skill-acceptance", version: "1.0.0" }, { capabilities: { tools: {} } });
log("start", { pid: process.pid });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
  name: "echo", description: "Echo the local acceptance text", annotations: { readOnlyHint: true },
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
}] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  log("call", request.params);
  return { content: [{ type: "text", text: String(request.params.arguments?.text ?? "") }], isError: false };
});
process.on("exit", code => log("exit", { pid: process.pid, code }));
process.once("SIGTERM", () => void server.close().finally(() => process.exit(0)));
await server.connect(new StdioServerTransport());
