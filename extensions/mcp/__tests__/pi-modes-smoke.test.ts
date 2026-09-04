import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LocalHttpMcpFixture } from "./fixtures/http-mcp-fixture.js";

const piCliPath = fileURLToPath(new URL(
  "../../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
  import.meta.url,
));
const extensionPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const children = new Set<ChildProcessWithoutNullStreams>();
const fixtures = new Set<LocalHttpMcpFixture>();
const tempDirectories = new Set<string>();

const isolatedArguments = [
  "--no-session",
  "--offline",
  "--no-approve",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
  "--no-context-files",
  "-e",
  extensionPath,
];

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  await Promise.allSettled([...fixtures].map((fixture) => fixture.close()));
  for (const path of tempDirectories) rmSync(path, { recursive: true, force: true });
  children.clear();
  fixtures.clear();
  tempDirectories.clear();
});

describe("MCP real Pi mode isolation", () => {
  it("exercises a bounded HTTP failure without contaminating JSON, RPC, or print output", async () => {
    const privateBody = `<!doctype html><html><head><title>Gateway failure</title></head><body>${"private-response-body ".repeat(10_000)}</body></html>`;
    const fixture = await LocalHttpMcpFixture.start({
      failures: [
        { kind: "status", status: 520, contentType: "text/html", body: privateBody },
        { kind: "status", status: 520, contentType: "text/html", body: privateBody },
        { kind: "status", status: 520, contentType: "text/html", body: privateBody },
      ],
    });
    fixtures.add(fixture);

    const directory = mkdtempSync(join(process.cwd(), ".tmp-mcp-pi-modes-"));
    tempDirectories.add(directory);
    const failureConfigPath = join(directory, "failure.json");
    writeFileSync(failureConfigPath, JSON.stringify({
      mcpServers: {
        remote: {
          type: "streamable-http",
          url: fixture.url,
          connectTimeout: 2_000,
          retry: { maxAttempts: 1, background: false },
        },
      },
    }), "utf8");

    const json = await runPi(
      ["--mode", "json", "--print", ...isolatedArguments, "/mcp status"],
      failureConfigPath,
    );
    const rpc = await runPi(
      ["--mode", "rpc", ...isolatedArguments],
      failureConfigPath,
      [
        JSON.stringify({ id: "state-1", type: "get_state" }),
        JSON.stringify({ id: "mcp-status", type: "prompt", message: "/mcp status" }),
        "",
      ].join("\n"),
    );
    const print = await runPi(
      ["--print", ...isolatedArguments, "/mcp status"],
      failureConfigPath,
    );

    const jsonRecords = parseJsonLines(json.stdout);
    const rpcRecords = parseJsonLines(rpc.stdout);
    expect(jsonRecords.length).toBeGreaterThan(0);
    expect(rpcRecords).toContainEqual(expect.objectContaining({
      id: "state-1",
      type: "response",
      command: "get_state",
      success: true,
    }));
    expect(rpcRecords).toContainEqual(expect.objectContaining({
      id: "mcp-status",
      type: "response",
      command: "prompt",
      success: true,
    }));
    expect(rpcRecords).toContainEqual(expect.objectContaining({
      type: "extension_ui_request",
      method: "notify",
      message: expect.stringContaining("MCP 0/1 online"),
    }));
    expect(print.stdout).toBe("");
    expect(fixture.count("initialize")).toBe(3);

    for (const result of [json, rpc, print]) {
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).not.toContain("private-response-body");
      expect(result.stdout).not.toContain("<html>");
      expect(result.stdout).not.toContain("Error:");
    }
  }, 20_000);
});

async function runPi(
  args: string[],
  configPath: string,
  input?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const childEnvironment = { ...process.env };
  delete childEnvironment.PI_SUBAGENT;
  childEnvironment.PI_MCP_CONFIG = configPath;
  childEnvironment.PI_TELEMETRY = "0";
  const child = spawn(process.execPath, [piCliPath, ...args], {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  if (input) child.stdin.write(input);
  child.stdin.end();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Pi mode smoke process exceeded 10 seconds: ${args.join(" ")}`));
    }, 10_000);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  children.delete(child);
  return { stdout, stderr, exitCode };
}

function parseJsonLines(output: string): unknown[] {
  return output
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown);
}
