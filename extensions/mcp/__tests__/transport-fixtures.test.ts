import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClientManager } from "../src/client.js";
import type { McpRetryScheduler } from "../src/retry.js";
import {
  LocalHttpMcpFixture,
  type HttpFailureStep,
} from "./fixtures/http-mcp-fixture.js";

const stdioFixturePath = fileURLToPath(new URL("./fixtures/stdio-mcp-server.mjs", import.meta.url));
const managers = new Set<McpClientManager>();
const httpFixtures = new Set<LocalHttpMcpFixture>();

class BlockingScheduler implements McpRetryScheduler {
  pendingCount = 0;
  now = () => Date.now();

  sleep(_delayMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((_resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        this.pendingCount -= 1;
        signal?.removeEventListener("abort", onAbort);
        action();
      };
      const onAbort = () => finish(() => reject(signal?.reason));
      this.pendingCount += 1;
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
}

afterEach(async () => {
  await Promise.allSettled([...managers].map((manager) => manager.shutdown()));
  await Promise.allSettled([...httpFixtures].map((fixture) => fixture.close()));
  managers.clear();
  httpFixtures.clear();
  vi.restoreAllMocks();
});

describe("MCP local transport fixtures", () => {
  it.each([
    {
      name: "HTTP 429 with Retry-After",
      failure: { kind: "status", status: 429, retryAfter: "0", body: "Rate limited" } satisfies HttpFailureStep,
      category: "rate-limit",
    },
    {
      name: "HTTP 503",
      failure: { kind: "status", status: 503, body: "Temporarily unavailable" } satisfies HttpFailureStep,
      category: "http-transient",
    },
    {
      name: "an interrupted HTTP response",
      failure: { kind: "interrupt" } satisfies HttpFailureStep,
      category: "connection",
    },
  ])("retries $name through the real Streamable HTTP transport", async ({ failure, category }) => {
    const fixture = await startHttpFixture({ failures: [failure] });
    const manager = trackManager(new McpClientManager({ random: () => 0 }));

    const state = await manager.connectServer("remote", httpConfig(fixture.url, {
      maxAttempts: 2,
      background: false,
    }));

    expect(state.connected).toBe(true);
    expect(fixture.count("initialize")).toBe(2);
    expect([...manager.getAllTools().keys()]).toEqual(["mcp__remote__echo"]);
    expect(manager.diagnostics.getEvents("remote").some((event) => event.error?.category === category)).toBe(true);
    if (category === "rate-limit") {
      expect(manager.diagnostics.getEvents("remote").some((event) => event.error?.retryAfterMs === 0)).toBe(true);
    }

    const result = await manager.callTool("mcp__remote__echo", { text: "local result" });
    expect(result.content).toEqual([{ type: "text", text: "local result" }]);
  });

  it("bounds a Cloudflare-style HTTP 520 body before it reaches state or diagnostics", async () => {
    const privateBody = "private-response-body ".repeat(10_000);
    const body = `<!doctype html><html><head><title>Unknown Error</title></head><body>${privateBody}Cloudflare Ray ID: abc123def456</body></html>`;
    const fixture = await startHttpFixture({
      failures: [{ kind: "status", status: 520, contentType: "text/html", body }],
    });
    const manager = trackManager(new McpClientManager());

    const state = await manager.connectServer("cloudflare", httpConfig(fixture.url, {
      maxAttempts: 1,
      background: false,
    }));

    expect(state.connected).toBe(false);
    expect(state.lastError?.category).toBe("http-transient");
    expect(state.error?.length ?? 0).toBeLessThanOrEqual(300);
    expect(state.lastError?.detail).toContain("HTTP 520: Unknown Error");
    expect(state.lastError?.originalBytes).toBe(Buffer.byteLength(body));
    expect(JSON.stringify(manager.diagnostics.getEvents("cloudflare"))).not.toContain(privateBody.slice(0, 200));
  });

  it("times out a hanging HTTP initialize request and releases it during shutdown", async () => {
    const fixture = await startHttpFixture({ failures: [{ kind: "timeout" }] });
    const manager = trackManager(new McpClientManager());

    const state = await manager.connectServer("hanging", httpConfig(fixture.url, {
      maxAttempts: 1,
      background: false,
      connectTimeout: 80,
    }));

    expect(state.connected).toBe(false);
    expect(state.lastError?.category).toBe("timeout");
    expect(fixture.count("initialize")).toBe(1);
    await manager.shutdown();
    expect(manager.getConnectionCount()).toBe(0);
  });

  it("aborts a hanging HTTP tool fetch when the request deadline expires", async () => {
    const fixture = await startHttpFixture({ toolCallFailures: [{ kind: "timeout" }] });
    const manager = trackManager(new McpClientManager());
    const state = await manager.connectServer("hanging-tool", httpConfig(fixture.url, {
      maxAttempts: 1,
      background: false,
      requestTimeout: 50,
      maxRequestTimeout: 80,
    }));
    expect(state.connected).toBe(true);

    await expect(
      manager.callTool("mcp__hanging-tool__echo", { text: "never returned" }),
    ).rejects.toMatchObject({ name: "McpToolError" });

    await waitFor(() => fixture.abortedMethods.includes("tools/call"));
    expect(fixture.count("tools/call")).toBe(1);
    expect(manager.getConnectionCount()).toBe(0);
    expect(manager.getServerState("hanging-tool")?.status).toBe("offline");
  });

  it("does not revive stale work after shutdown during HTTP retry backoff", async () => {
    const fixture = await startHttpFixture({
      failures: [{ kind: "status", status: 503, body: "Retry later" }],
    });
    const scheduler = new BlockingScheduler();
    const manager = trackManager(new McpClientManager({ scheduler, random: () => 1 }));
    const config = httpConfig(fixture.url, {
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 1_000,
      background: false,
      connectTimeout: 5_000,
    });

    const oldConnect = manager.connectServer("reloadable", config);
    await waitFor(() => scheduler.pendingCount === 1);
    await manager.shutdown();
    await oldConnect;

    expect(scheduler.pendingCount).toBe(0);
    expect(manager.getSnapshots()).toEqual([]);
    expect(fixture.count("initialize")).toBe(1);

    const reloaded = await manager.connectServer("reloadable", config);
    expect(reloaded.connected).toBe(true);
    expect(fixture.count("initialize")).toBe(2);
    await delay(30);
    expect(manager.getConnectionCount()).toBe(1);
    expect(fixture.count("initialize")).toBe(2);
  });

  it("captures early, split, and long stdio stderr without writing to console", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const manager = trackManager(new McpClientManager());

    const state = await manager.connectServer("stdio", stdioConfig("normal"));
    expect(state.connected).toBe(true);
    expect([...manager.getAllTools().keys()]).toEqual(["mcp__stdio__echo"]);

    const result = await manager.callTool("mcp__stdio__echo", { text: "stdio result" });
    expect(result.content).toEqual([{ type: "text", text: "stdio result" }]);
    await waitFor(() => manager.diagnostics.getStderr("stdio").some((line) => line.includes("completed")));
    await waitFor(() => manager.diagnostics.getStderr("stdio").some((line) => line.includes("long stderr")));

    const stderr = manager.diagnostics.getStderr("stdio");
    expect(stderr.some((line) => line.includes("early stderr"))).toBe(true);
    expect(stderr.some((line) => line.includes("split stderr chunk completed"))).toBe(true);
    expect(JSON.stringify(stderr)).not.toContain("stdio-early-secret");
    expect(JSON.stringify(stderr)).toContain("[redacted]");
    expect(stderr.every((line) => Buffer.byteLength(line, "utf8") <= 4 * 1024)).toBe(true);

    const [pid] = manager.getAllConnectionPids();
    expect(pid).toBeTypeOf("number");
    await manager.shutdown();
    await waitFor(() => !isProcessAlive(pid));
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  }, 10_000);

  it("captures stderr from an abnormally exiting stdio server and leaves no live connection", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const manager = trackManager(new McpClientManager());

    const state = await manager.connectServer("crashing", stdioConfig("exit-early"));

    expect(state.connected).toBe(false);
    expect(state.lastError?.category).toBe("connection");
    expect(manager.getConnectionCount()).toBe(0);
    expect(manager.diagnostics.getStderr("crashing").some((line) => line.includes("exits abnormally"))).toBe(true);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  }, 10_000);
});

async function startHttpFixture(
  options: Parameters<typeof LocalHttpMcpFixture.start>[0],
): Promise<LocalHttpMcpFixture> {
  const fixture = await LocalHttpMcpFixture.start(options);
  httpFixtures.add(fixture);
  return fixture;
}

function trackManager(manager: McpClientManager): McpClientManager {
  managers.add(manager);
  return manager;
}

function httpConfig(
  url: string,
  options: {
    maxAttempts: number;
    background: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
    connectTimeout?: number;
    requestTimeout?: number;
    maxRequestTimeout?: number;
  },
) {
  return {
    type: "streamable-http" as const,
    url,
    connectTimeout: options.connectTimeout ?? 2_000,
    ...(options.requestTimeout === undefined ? {} : { requestTimeout: options.requestTimeout }),
    ...(options.maxRequestTimeout === undefined ? {} : { maxRequestTimeout: options.maxRequestTimeout }),
    retry: {
      maxAttempts: options.maxAttempts,
      baseDelayMs: options.baseDelayMs ?? 1,
      maxDelayMs: options.maxDelayMs ?? 1,
      background: options.background,
    },
  };
}

function stdioConfig(mode: "normal" | "exit-early") {
  return {
    type: "stdio" as const,
    command: process.execPath,
    args: [stdioFixturePath, mode],
    connectTimeout: 3_000,
    retry: { maxAttempts: 1, background: false },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Condition was not met within ${timeoutMs}ms`);
    await delay(10);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
