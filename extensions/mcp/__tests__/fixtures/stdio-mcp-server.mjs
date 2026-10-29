import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const mode = process.argv[2] ?? "normal";
const record = (method, params) => {
  if (process.env.MCP_FIXTURE_LEDGER) appendFileSync(process.env.MCP_FIXTURE_LEDGER,
    `${JSON.stringify({ at: Date.now(), pid: process.pid, method, params })}\n`);
};

process.stderr.write("early stderr token=stdio-early-secret\n");
process.stderr.write("split stderr chunk");
setTimeout(() => process.stderr.write(" completed\n"), 5);
setTimeout(() => process.stderr.write(`long stderr ${"x".repeat(12_000)}\n`), 10);

if (mode === "exit-early") {
  process.stderr.write("fixture exits abnormally\n");
  setTimeout(() => process.exit(17), 20);
} else {
  const server = new Server(
    { name: "local-stdio-fixture", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    record("tools/list", {});
    if (mode === "delay-tools") {
      await new Promise((resolve) => setTimeout(resolve, Number(process.argv[3] ?? 3000)));
    }
    return { tools: [{
      name: "echo",
      description: "Echo text from the local stdio fixture",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      annotations: { readOnlyHint: true },
    }] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    record("tools/call", request.params);
    return {
      content: [{
        type: "text",
        text: String(request.params.arguments?.text ?? ""),
      }],
      isError: false,
    };
  });

  const transport = new StdioServerTransport();
  const stop = async () => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  await server.connect(transport);
}
