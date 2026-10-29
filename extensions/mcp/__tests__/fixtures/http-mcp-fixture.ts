import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";

export type HttpFailureStep =
  | { kind: "status"; status: number; body?: string; retryAfter?: string; contentType?: string }
  | { kind: "protocol"; code: number }
  | { kind: "timeout" }
  | { kind: "interrupt" };

export interface LocalHttpMcpFixtureOptions {
  failures?: HttpFailureStep[];
  toolCallFailures?: HttpFailureStep[];
  listFailures?: HttpFailureStep[];
  responseDelayMs?: number;
}

export class LocalHttpMcpFixture {
  readonly requests: Array<{ at: number; method: string; headers: IncomingMessage["headers"] }> = [];
  readonly abortedMethods: string[] = [];
  readonly sockets = new Set<Socket>();
  readonly server: Server;
  url = "";
  private failures: HttpFailureStep[];
  private toolCallFailures: HttpFailureStep[];
  private closed = false;
  private readonly listFailures: HttpFailureStep[];
  private readonly responseDelayMs: number;

  private constructor(options: LocalHttpMcpFixtureOptions) {
    this.failures = [...(options.failures ?? [])];
    this.listFailures = [...(options.listFailures ?? [])];
    this.responseDelayMs = options.responseDelayMs ?? 0;
    this.toolCallFailures = [...(options.toolCallFailures ?? [])];
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
        if (!response.writableEnded) response.end("Fixture request failed");
      });
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
  }

  static async start(options: LocalHttpMcpFixtureOptions = {}): Promise<LocalHttpMcpFixture> {
    const fixture = new LocalHttpMcpFixture(options);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        fixture.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        fixture.server.off("error", onError);
        resolve();
      };
      fixture.server.once("error", onError);
      fixture.server.once("listening", onListening);
      fixture.server.listen(0, "127.0.0.1");
    });
    const address = fixture.server.address() as AddressInfo;
    fixture.url = `http://127.0.0.1:${address.port}/mcp`;
    return fixture;
  }

  count(method: string): number {
    return this.requests.filter((request) => request.method === method).length;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const socketClosures = [...this.sockets].map((socket) => new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
    }));
    this.server.closeAllConnections?.();
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
    await Promise.all(socketClosures);
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === "GET") {
      response.writeHead(405, { allow: "POST", "content-type": "text/plain" });
      response.end("Method not allowed");
      return;
    }
    if (request.method === "DELETE") {
      response.writeHead(200).end();
      return;
    }
    if (request.method !== "POST" || request.url !== "/mcp") {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }

    const body = await readJsonBody(request);
    const messages = Array.isArray(body) ? body : [body];
    const method = typeof messages[0]?.method === "string" ? messages[0].method : "unknown";
    this.requests.push({ at: Date.now(), method, headers: request.headers });
    request.once("aborted", () => this.abortedMethods.push(method));
    response.once("close", () => {
      if (!response.writableEnded && !this.abortedMethods.includes(method)) {
        this.abortedMethods.push(method);
      }
    });

    if (this.responseDelayMs) await new Promise((resolve) => setTimeout(resolve, this.responseDelayMs));
    const failures = method === "tools/list" ? this.listFailures : method === "initialize"
      ? this.failures
      : method === "tools/call"
        ? this.toolCallFailures
        : undefined;
    if (failures && failures.length > 0) {
      const failure = failures.shift()!;
      if (failure.kind === "timeout") return;
      if (failure.kind === "interrupt") {
        request.socket.destroy();
        return;
      }
      if (failure.kind === "protocol") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: messages[0].id, error: { code: failure.code, message: "Fixture protocol error" } }));
        return;
      }
      const responseBody = failure.body ?? `HTTP ${failure.status}`;
      response.writeHead(failure.status, {
        "content-type": failure.contentType ?? "text/plain; charset=utf-8",
        "content-length": Buffer.byteLength(responseBody),
        ...(failure.retryAfter === undefined ? {} : { "retry-after": failure.retryAfter }),
      });
      response.end(responseBody);
      return;
    }

    const replies = messages.flatMap((message) => {
      if (!message || typeof message !== "object" || typeof message.method !== "string") return [];
      if (message.id === undefined) return [];
      return [createReply(message)];
    });
    if (replies.length === 0) {
      response.writeHead(202).end();
      return;
    }

    const responseBody = JSON.stringify(Array.isArray(body) ? replies : replies[0]);
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(responseBody),
    });
    response.end(responseBody);
  }
}

function createReply(message: Record<string, unknown>): Record<string, unknown> {
  const base = { jsonrpc: "2.0", id: message.id };
  if (message.method === "initialize") {
    const params = asRecord(message.params);
    return {
      ...base,
      result: {
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "local-http-fixture", version: "1.0.0" },
      },
    };
  }
  if (message.method === "tools/list") {
    return {
      ...base,
      result: {
        tools: [{
          name: "echo",
          description: "Echo text from the local HTTP fixture",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
          annotations: { readOnlyHint: true },
        }],
      },
    };
  }
  if (message.method === "tools/call") {
    const params = asRecord(message.params);
    const args = asRecord(params?.arguments);
    return {
      ...base,
      result: {
        content: [{ type: "text", text: String(args?.text ?? "") }],
        isError: false,
      },
    };
  }
  return {
    ...base,
    error: { code: -32601, message: `Method not found: ${message.method}` },
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
