import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "pi14-acceptance", version: "1.0.0" });
server.registerTool("fact", { description: "Return a synthetic acceptance marker without reading files or using the network." },
  async () => ({ content: [{ type: "text", text: "MCP-ORCHID-731" }] }));
await server.connect(new StdioServerTransport());
