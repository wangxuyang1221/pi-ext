import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { expect, it } from "vitest";
import { McpClientManager } from "../src/client.js";

it.each(["complete", "hard", "silent", "unknown", "stopped", "cancel"] as const)(
  "enforces progress deadlines through real SSE: %s", async (mode) => {
    const sockets = new Set<Socket>();
    const sessions = new Map<string, { server: Server; transport: SSEServerTransport }>();
    const handlers = new Set<Promise<unknown>>();
    let calls = 0, updates = 0, cancelled = false, token: unknown;
    const http = createServer(async (req, res) => {
      const url = new URL(req.url!, "http://localhost");
      if (req.method === "GET") {
        const transport = new SSEServerTransport("/messages", res);
        const server = new Server({ name: "progress-fixture", version: "1" }, { capabilities: { tools: {} } });
        server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "work", inputSchema: { type: "object" } }] }));
        server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
          const work = (async () => {
            calls++;
            token = request.params._meta?.progressToken;
            extra.signal.addEventListener("abort", () => { cancelled = true; }, { once: true });
            const started = Date.now();
            while (!extra.signal.aborted && Date.now() - started < (mode === "complete" ? 600 : 2000)) {
              if (token !== undefined && mode !== "silent" && (mode !== "stopped" || updates < 3)) {
                await extra.sendNotification({ method: "notifications/progress", params: {
                  progressToken: mode === "unknown" ? "unknown-token" : token as string | number,
                  progress: ++updates, total: 100,
                } });
              }
              await delay(50);
            }
            return { content: [{ type: "text" as const, text: "completed" }] };
          })();
          handlers.add(work);
          void work.finally(() => handlers.delete(work));
          return work;
        });
        sessions.set(transport.sessionId, { server, transport });
        await server.connect(transport);
      } else {
        await sessions.get(url.searchParams.get("sessionId")!)!.transport.handlePostMessage(req, res);
      }
    });
    http.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
    const port = (http.address() as import("node:net").AddressInfo).port;
    const manager = new McpClientManager();
    try {
      expect((await manager.connectServer("progress", {
        type: "sse", url: `http://127.0.0.1:${port}/sse`, connectTimeout: 3000,
        requestTimeout: 150, maxRequestTimeout: 1000, retry: { maxAttempts: 1, background: false },
      })).connected).toBe(true);
      const controller = new AbortController();
      const started = Date.now();
      const result = manager.callTool("mcp__progress__work", {}, { signal: controller.signal });
      // Attach the rejection handler before awaiting server observations.
      const settled = result.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      if (mode === "cancel") {
        await expect.poll(() => calls).toBe(1);
        controller.abort(new Error("User cancelled"));
      }
      const outcome = await settled;
      const elapsed = Date.now() - started;
      if (mode === "complete") {
        expect(outcome.error).toBeUndefined();
        expect(outcome.value?.content).toEqual([{ type: "text", text: "completed" }]);
        expect(updates).toBeGreaterThanOrEqual(10);
      } else {
        expect(outcome.error).toBeDefined();
        await expect.poll(() => cancelled).toBe(true);
        if (mode === "hard") { expect(elapsed).toBeGreaterThanOrEqual(900); expect(updates).toBeGreaterThan(10); }
        else expect(elapsed).toBeLessThan(700);
        expect(elapsed).toBeLessThan(1600);
      }
      expect(token).toBeDefined();
      expect(calls).toBe(1);
    } finally {
      await manager.shutdown();
      await Promise.allSettled([...sessions.values()].map(value => value.server.close()));
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => http.close(() => resolve()));
      await Promise.allSettled(handlers);
      expect(http.listening).toBe(false);
      const refused = await new Promise<boolean>(resolve => {
        const socket = connect(port, "127.0.0.1");
        socket.once("error", error => { socket.destroy(); resolve((error as NodeJS.ErrnoException).code === "ECONNREFUSED"); });
        socket.once("connect", () => { socket.destroy(); resolve(false); });
      });
      expect(refused).toBe(true);
    }
  }, 10000,
);
