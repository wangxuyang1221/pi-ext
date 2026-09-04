import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FIELD_BYTES,
  McpDiagnostics,
  normalizeMcpError,
  sanitizeDiagnosticText,
  summarizeHtml,
  truncateUtf8,
} from "../src/diagnostics.js";

let tempDirectory = "";

beforeEach(() => {
  tempDirectory = mkdtempSync(join(process.cwd(), ".tmp-mcp-diagnostics-"));
});

afterEach(() => {
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe("MCP diagnostics", () => {
  it("redacts credentials before storing nested context", () => {
    const diagnostics = new McpDiagnostics();
    diagnostics.record({
      level: "error",
      serverName: "search",
      message: "Authorization: Bearer visible-token https://user:pass@example.com/mcp?api_key=query-secret",
      context: {
        headers: { Authorization: "Bearer header-secret", Cookie: "sid=cookie-secret" },
        env: { EXA_API_KEY: "env-secret", SAFE: "must-also-be-redacted" },
        safeLabel: "visible",
        password: "password-secret",
      },
    });

    const serialized = JSON.stringify(diagnostics.getEvents("search"));
    expect(serialized).not.toContain("visible-token");
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("header-secret");
    expect(serialized).not.toContain("cookie-secret");
    expect(serialized).not.toContain("env-secret");
    expect(serialized).not.toContain("must-also-be-redacted");
    expect(serialized).not.toContain("password-secret");
    expect(serialized).toContain("visible");
    expect(serialized).toContain("[redacted]");
  });

  it("redacts credentials embedded in diagnostic server identifiers", () => {
    const serverName = "https://user:pass@example.com/mcp?token=server-secret";
    const diagnostics = new McpDiagnostics();

    diagnostics.record({ level: "error", serverName, message: "failed" });

    const serialized = JSON.stringify(diagnostics.getEvents(serverName));
    expect(serialized).not.toContain("server-secret");
    expect(serialized).not.toContain("user:pass");
    expect(serialized).toContain("[redacted]");
  });

  it("removes ANSI, OSC, and terminal control characters", () => {
    const value = sanitizeDiagnosticText("safe\u001b[31mred\u001b[0m\u001b]0;owned\u0007\u0000tail");

    expect(value).toBe("saferedtail");
    expect(value).not.toContain("\u001b");
    expect(value).not.toContain("\u0000");
  });

  it("truncates UTF-8 fields by bytes and reports their original size", () => {
    const result = truncateUtf8("界".repeat(3000), DEFAULT_FIELD_BYTES);

    expect(Buffer.byteLength(result.value, "utf8")).toBeLessThanOrEqual(DEFAULT_FIELD_BYTES);
    expect(result.truncated).toBe(true);
    expect(result.originalBytes).toBe(9000);
    expect(result.value).toContain("originalBytes=9000");
  });

  it("honors very small UTF-8 byte limits", () => {
    expect(Buffer.byteLength(truncateUtf8("abc", 1).value, "utf8")).toBeLessThanOrEqual(1);
    expect(Buffer.byteLength(truncateUtf8("界", 1).value, "utf8")).toBeLessThanOrEqual(1);
  });

  it("summarizes Cloudflare HTML without retaining the DOM body", () => {
    const html = `<!doctype html><html><head><title>Web server is down</title></head><body>${"private ".repeat(500)}Cloudflare Ray ID:<strong>abc123def456</strong></body></html>`;

    const summary = summarizeHtml(html, 520);

    expect(summary).toBe("HTTP 520: Web server is down (Cloudflare Ray ID abc123def456)");
    expect(summary).not.toContain("private");
    expect(summary).not.toContain("<html>");
  });

  it("bounds and cycle-proofs Error.cause traversal", () => {
    const first = Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }) as Error & { cause?: unknown };
    const second = Object.assign(new Error("socket reset"), { code: "UND_ERR_SOCKET", cause: first });
    first.cause = second;

    const normalized = normalizeMcpError(first);

    expect(normalized.category).toBe("connection");
    expect(normalized.retryable).toBe(true);
    expect(normalized.code).toBe("ECONNRESET");
    expect(normalized.causeChain).toHaveLength(2);
  });

  it("deduplicates adjacent events inside the configured window", () => {
    let now = 1000;
    const diagnostics = new McpDiagnostics({ now: () => now, dedupeWindowMs: 5000 });

    const first = diagnostics.record({ level: "error", serverName: "a", message: "same" });
    now += 100;
    const second = diagnostics.record({ level: "error", serverName: "a", message: "same" });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(diagnostics.getEvents("a")).toHaveLength(1);
    expect(diagnostics.getEvents("a")[0].repeats).toBe(2);
  });

  it("evicts old events by count and byte budget", () => {
    const diagnostics = new McpDiagnostics({ eventLimit: 3, byteLimit: 800, fieldByteLimit: 200 });
    for (let index = 0; index < 10; index++) {
      diagnostics.record({
        level: "info",
        serverName: "bounded",
        message: `event-${index}-${"x".repeat(120)}`,
      });
    }

    const events = diagnostics.getEvents("bounded");
    expect(events.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(events)).not.toContain("event-0-");
  });

  it("retains a bounded summary when one event exceeds the ring byte budget", () => {
    const diagnostics = new McpDiagnostics({ byteLimit: 512, fieldByteLimit: 16 * 1024 });

    diagnostics.record({
      level: "error",
      serverName: "oversized",
      message: "large diagnostic",
      context: { response: "x".repeat(100_000) },
      error: new Error("y".repeat(100_000)),
    });

    const events = diagnostics.getEvents("oversized");
    expect(events).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(events[0]), "utf8")).toBeLessThanOrEqual(512);
    expect(events[0].context).toMatchObject({ truncated: true });
  });

  it("bounds stderr by line count and redacts it", () => {
    const diagnostics = new McpDiagnostics({ stderrLineLimit: 3, stderrByteLimit: 1000 });
    diagnostics.recordStderr("local", "Authorization: Bearer child-secret");
    diagnostics.recordStderr("local", "line-2");
    diagnostics.recordStderr("local", "line-3");
    diagnostics.recordStderr("local", "line-4");

    expect(diagnostics.getStderr("local")).toEqual(["line-2", "line-3", "line-4"]);
    expect(JSON.stringify(diagnostics.getStderr("local"))).not.toContain("child-secret");
  });

  it("does not create files unless the sink is explicitly enabled", async () => {
    const path = join(tempDirectory, "disabled.log");
    const diagnostics = new McpDiagnostics({ file: { path } });
    diagnostics.record({ level: "info", message: "event" });
    await diagnostics.flush();

    expect(existsSync(path)).toBe(false);
  });

  it("writes ordered redacted lines and rotates to one backup", async () => {
    const path = join(tempDirectory, "mcp.log");
    const diagnostics = new McpDiagnostics({ file: { enabled: true, path, maxBytes: 650 } });
    for (let index = 0; index < 8; index++) {
      diagnostics.record({
        level: "info",
        serverName: "remote",
        message: `event-${index}`,
        context: { Authorization: `Bearer token-${index}`, value: "x".repeat(100) },
      });
    }
    await diagnostics.flush();

    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.1`)).toBe(true);
    const content = `${readFileSync(`${path}.1`, "utf8")}${readFileSync(path, "utf8")}`;
    expect(content).not.toContain("token-");
    expect(content).toContain("[redacted]");
    expect(statSync(path).size).toBeLessThanOrEqual(650);
    expect(statSync(`${path}.1`).size).toBeLessThanOrEqual(650);
    const currentIndexes = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).message as string)
      .map((message) => Number(message.split("-")[1]));
    expect(currentIndexes).toEqual([...currentIndexes].sort((left, right) => left - right));
  });

  it("bounds a single file event to the configured file size", async () => {
    const path = join(tempDirectory, "bounded.log");
    const diagnostics = new McpDiagnostics({
      file: { enabled: true, path, maxBytes: 180 },
    });

    diagnostics.record({
      level: "error",
      serverName: "remote",
      message: "x".repeat(20_000),
      context: { body: "y".repeat(20_000) },
    });
    await diagnostics.flush();

    expect(statSync(path).size).toBeLessThanOrEqual(180);
    expect(() => JSON.parse(readFileSync(path, "utf8").trim())).not.toThrow();
  });

  it("tightens permissions on an existing file when supported", async () => {
    const path = join(tempDirectory, "permissions.log");
    writeFileSync(path, "", { encoding: "utf8", mode: 0o644 });
    chmodSync(path, 0o644);
    const diagnostics = new McpDiagnostics({ file: { enabled: true, path } });

    diagnostics.record({ level: "info", message: "event" });
    await diagnostics.flush();

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("disables a failing file sink without throwing or recursing", async () => {
    const blocker = join(tempDirectory, "blocker");
    writeFileSync(blocker, "file", "utf8");
    const diagnostics = new McpDiagnostics({
      file: { enabled: true, path: join(blocker, "mcp.log") },
    });

    expect(() => diagnostics.record({ level: "error", message: "will fail" })).not.toThrow();
    await diagnostics.flush();

    expect(diagnostics.getFileSinkStatus().enabled).toBe(false);
    expect(diagnostics.getFileSinkStatus().failed).toBeTruthy();
    expect(diagnostics.getEvents().filter((event) => event.message.includes("file logging disabled"))).toHaveLength(1);
    await expect(diagnostics.flush()).resolves.toBeUndefined();
  });

  it("stops waiting for a blocked file write at the close deadline", async () => {
    const path = join(tempDirectory, "blocked.log");
    const diagnostics = new McpDiagnostics({
      file: { enabled: true, path },
      fileSystem: {
        appendFile: () => new Promise(() => undefined),
      },
    });
    diagnostics.record({ level: "info", message: "event" });

    const startedAt = Date.now();
    await diagnostics.close({ timeoutMs: 10 });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(diagnostics.getFileSinkStatus().enabled).toBe(false);
    expect(diagnostics.getFileSinkStatus().failed).toContain("exceeded 10ms");
  });

  it("never throws when hostile values fail property access or string conversion", () => {
    const diagnostics = new McpDiagnostics();
    const hostile = new Proxy({}, {
      ownKeys() { throw new Error("no keys"); },
      getOwnPropertyDescriptor() { throw new Error("no descriptor"); },
    });

    expect(() => diagnostics.record({ level: "error", message: "safe", context: hostile })).not.toThrow();
  });
});

describe("MCP error normalization", () => {
  it.each([
    [Object.assign(new Error("dns"), { code: "EAI_AGAIN" }), "dns", true],
    [Object.assign(new Error("reset"), { code: "ECONNRESET" }), "connection", true],
    [Object.assign(new Error("refused"), { code: "ECONNREFUSED" }), "connection", true],
    [Object.assign(new Error("certificate mismatch"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }), "connection", false],
    [Object.assign(new Error("Unexpected content-type"), { code: -1 }), "protocol", false],
    [new McpError(ErrorCode.ConnectionClosed, "Connection closed"), "connection", true],
    [new Error("Maximum reconnection attempts (2) exceeded."), "connection", true],
    [new McpError(ErrorCode.RequestTimeout, "Request timed out"), "timeout", true],
    [Object.assign(new Error("unauthorized"), { code: 401 }), "auth", false],
    [Object.assign(new Error("rate limit"), { code: 429 }), "rate-limit", true],
    [Object.assign(new Error("unavailable"), { code: 503 }), "http-transient", true],
    [Object.assign(new Error("cloudflare"), { code: 520 }), "http-transient", true],
    [new McpError(ErrorCode.InvalidParams, "bad params"), "protocol", false],
    [new TypeError("Invalid URL"), "config", false],
  ])("normalizes %#", (error, category, retryable) => {
    const normalized = normalizeMcpError(error);
    expect(normalized.category).toBe(category);
    expect(normalized.retryable).toBe(retryable);
    expect(normalized.message.length).toBeLessThanOrEqual(300);
  });

  it("keeps normalized user messages free of generated ANSI controls", () => {
    const normalized = normalizeMcpError(new Error(`fetch failed ${"x".repeat(2000)}`));

    expect(normalized.message).not.toContain("\u001b");
    expect(normalized.message.length).toBeLessThanOrEqual(300);
  });

  it("treats caller cancellation as cancellation before SDK timeout codes", () => {
    const normalized = normalizeMcpError(
      new McpError(ErrorCode.RequestTimeout, "AbortError: user stop"),
      { signalAborted: true },
    );

    expect(normalized.category).toBe("cancelled");
    expect(normalized.retryable).toBe(false);
  });

  it("recognizes a 404 as session expiration when transport context confirms a session", () => {
    const normalized = normalizeMcpError(Object.assign(new Error("Not found"), { code: 404 }), {
      httpStatus: 404,
      sessionExpired: true,
    });

    expect(normalized.category).toBe("session-expired");
    expect(normalized.retryable).toBe(true);
  });

  it("preserves bounded HTTP metadata and Retry-After", () => {
    const normalized = normalizeMcpError(new Error("response failed"), {
      httpStatus: 429,
      retryAfterMs: 2500,
      responseDetail: `<html><title>Slow down</title><body>${"large ".repeat(5000)}</body></html>`,
      responseTruncated: true,
      responseOriginalBytes: 30_000,
    });

    expect(normalized.httpStatus).toBe(429);
    expect(normalized.retryAfterMs).toBe(2500);
    expect(normalized.truncated).toBe(true);
    expect(normalized.originalBytes).toBe(30_000);
    expect(normalized.detail).toBe("HTTP 429: Slow down");
  });
});
