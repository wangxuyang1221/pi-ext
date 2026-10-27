import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadMcpConfig,
  loadMcpConfigResult,
  type McpConfigLoaderDependencies,
} from "../src/config.js";
import { McpDiagnostics } from "../src/diagnostics.js";

let cwd = "";
let homeDir = "";

function loaderDependencies(
  overrides: McpConfigLoaderDependencies = {},
): McpConfigLoaderDependencies {
  return {
    env: {},
    homeDir,
    ...overrides,
  };
}

function loadResult(diagnostics?: McpDiagnostics) {
  return loadMcpConfigResult(cwd, diagnostics, loaderDependencies());
}

function writeConfig(value: string): string {
  const directory = join(cwd, ".pi");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "mcp.json");
  writeFileSync(path, value, "utf8");
  return path;
}

describe("MCP config loading", () => {
  beforeEach(() => {
    cwd = mkdtempSync(join(process.cwd(), ".tmp-mcp-config-"));
    homeDir = join(cwd, "isolated-home");
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("loads legacy stdio and HTTP aliases without migration", () => {
    writeConfig(`{
      // JSONC remains supported.
      "mcpServers": {
        "local": { "command": "node", "args": ["server.js"], "timeout": 1200 },
        "remote": { "type": "http", "url": "https://example.com/mcp", },
      },
    }`);

    const config = loadMcpConfig(cwd, undefined, loaderDependencies());

    expect(config?.mcpServers.local).toMatchObject({ command: "node", timeout: 1200 });
    expect(config?.mcpServers.remote).toMatchObject({ type: "http", url: "https://example.com/mcp" });
  });

  it("accepts one leading BOM with JSONC but rejects an embedded BOM outside strings", () => {
    writeConfig('\uFEFF{ // settings\n "mcpServers": { "local": { "command": "node" }, }, }');
    expect(loadResult().status).toBe("loaded");
    expect(loadResult().config?.mcpServers.local).toMatchObject({ command: "node" });
    writeConfig('{\uFEFF"mcpServers":{}}');
    expect(loadResult().status).toBe("invalid");
  });

  it("loads typed timeout, retry, replay, logging, and file diagnostic settings", () => {
    writeConfig(JSON.stringify({
      diagnostics: { file: { enabled: true, path: join(cwd, "mcp.log"), maxBytes: 4096 } },
      mcpServers: {
        search: {
          type: "streamable-http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer test" },
          connectTimeout: 1000,
          requestTimeout: 2000,
          maxRequestTimeout: 3000,
          retry: {
            maxAttempts: 3,
            baseDelayMs: 10,
            factor: 2,
            maxDelayMs: 100,
            retryAfterMaxMs: 300000,
            background: true,
            backgroundMaxDelayMs: 300000,
          },
          toolReplay: "read-only",
          loggingLevel: "warning",
        },
      },
    }));

    const result = loadResult();

    expect(result.status).toBe("loaded");
    expect(result.config?.mcpServers.search).toMatchObject({
      connectTimeout: 1000,
      requestTimeout: 2000,
      maxRequestTimeout: 3000,
      toolReplay: "read-only",
      loggingLevel: "warning",
    });
    expect(result.config?.diagnostics?.file?.enabled).toBe(true);
  });

  it("keeps valid servers when another server is invalid", () => {
    writeConfig(JSON.stringify({
      mcpServers: {
        valid: { command: "node" },
        missingCommand: { type: "stdio", env: { TOKEN: "secret-value" } },
        badUrl: { type: "http", url: "file:///private/path" },
      },
    }));

    const diagnostics = new McpDiagnostics();
    const result = loadResult(diagnostics);

    expect(result.status).toBe("loaded");
    expect(Object.keys(result.config?.mcpServers ?? {})).toEqual(["valid"]);
    expect(result.invalidServers).toEqual({
      missingCommand: "command must be a non-empty string for stdio",
      badUrl: "url must use http or https",
    });
    expect(JSON.stringify(diagnostics.getEvents())).not.toContain("secret-value");
  });

  it("distinguishes missing, invalid, empty, and loaded files", () => {
    expect(loadResult().status).toBe("missing");

    writeConfig("{not-json");
    expect(loadResult().status).toBe("invalid");

    writeConfig(JSON.stringify({ mcpServers: { off: { disabled: true } } }));
    const empty = loadResult();
    expect(empty.status).toBe("empty");
    expect(empty.disabledServers).toEqual(["off"]);

    writeConfig(JSON.stringify({ mcpServers: { on: { command: "node" } } }));
    expect(loadResult().status).toBe("loaded");
  });

  it("uses the explicit config path before project and global paths", () => {
    writeConfig(JSON.stringify({ mcpServers: { project: { command: "project" } } }));
    const explicit = join(cwd, "explicit.json");
    writeFileSync(explicit, JSON.stringify({ mcpServers: { explicit: { command: "explicit" } } }), "utf8");
    const result = loadMcpConfigResult(
      cwd,
      undefined,
      loaderDependencies({ env: { PI_MCP_CONFIG: explicit } }),
    );

    expect(result.path).toBe(explicit);
    expect(Object.keys(result.config?.mcpServers ?? {})).toEqual(["explicit"]);
  });

  it("supports fully injected environment and file lookup dependencies", () => {
    const explicitPath = join(cwd, "virtual-mcp.json");
    const checkedPaths: string[] = [];
    const readPaths: string[] = [];

    const result = loadMcpConfigResult(cwd, undefined, {
      env: { PI_MCP_CONFIG: explicitPath },
      homeDir,
      exists: (path) => {
        checkedPaths.push(path);
        return path === explicitPath;
      },
      readFile: (path) => {
        readPaths.push(path);
        return JSON.stringify({ mcpServers: { virtual: { command: "node" } } });
      },
    });

    expect(result.status).toBe("loaded");
    expect(result.path).toBe(explicitPath);
    expect(checkedPaths).toEqual([explicitPath]);
    expect(readPaths).toEqual([explicitPath]);
    expect(Object.keys(result.config?.mcpServers ?? {})).toEqual(["virtual"]);
  });

  it("can skip project configuration for an untrusted project", () => {
    writeConfig(JSON.stringify({ mcpServers: { project: { command: "project" } } }));
    const globalDirectory = join(homeDir, ".pi", "agent");
    mkdirSync(globalDirectory, { recursive: true });
    writeFileSync(
      join(globalDirectory, "mcp.json"),
      JSON.stringify({ mcpServers: { global: { command: "global" } } }),
      "utf8",
    );

    const result = loadMcpConfigResult(
      cwd,
      undefined,
      loaderDependencies({ allowProjectConfig: false }),
    );

    expect(result.status).toBe("loaded");
    expect(Object.keys(result.config?.mcpServers ?? {})).toEqual(["global"]);
    expect(result.searchedPaths).not.toContain(join(cwd, ".pi", "mcp.json"));
  });

  it.each([
    [{ command: "" }, "command"],
    [{ command: "node", timeout: 0 }, "timeout"],
    [{ type: "http", url: "not-a-url" }, "url"],
    [{ type: "http", url: "https://example.com", headers: { Authorization: 42 } }, "headers"],
    [{ command: "node", retry: { maxAttempts: 1.5 } }, "maxAttempts"],
    [{ command: "node", toolReplay: "always" }, "toolReplay"],
  ])("rejects invalid server field without echoing its value: %j", (server, expectedField) => {
    writeConfig(JSON.stringify({ mcpServers: { broken: server } }));

    const result = loadResult();

    expect(result.status).toBe("invalid");
    expect(result.invalidServers.broken).toContain(expectedField);
    expect(JSON.stringify(result.issues)).not.toContain("not-a-url");
  });
});
