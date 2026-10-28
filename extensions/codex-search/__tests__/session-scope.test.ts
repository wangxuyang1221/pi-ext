import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import search from "../src/index.ts";
import { CONFIG_FILE_NAME } from "../src/config.ts";

it("isolates real tool requests across session changes and cold restore", async () => {
  const root = await mkdtemp(join(process.cwd(), ".search-scope-"));
  const requests: Array<{ id: string; commands: Record<string, Array<{ ref_id: string }>> }> = [];
  let release: (() => void) | undefined;
  let hold = false;
  const http = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    if (hold) await new Promise<void>(resolve => { release = resolve; });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ output: `Page turn${body.id === "A" ? 0 : 1}view0` }));
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as import("node:net").AddressInfo).port;
  let id = "A", pauseAuth = false;
  let releaseAuth: (() => void) | undefined;
  const token = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture" } })).toString("base64url")}.fixture`;
  const ctx = { cwd: root, isProjectTrusted: () => true,
    sessionManager: { getSessionDir: () => root, getSessionId: () => id },
    modelRegistry: { getApiKeyForProvider: async () => {
      if (pauseAuth) await new Promise<void>(resolve => { releaseAuth = resolve; });
      return token;
    } },
    tools: [], executeTool: async () => { throw new Error("Unexpected nested tool"); },
  } as unknown as ExtensionToolContext;
  async function loadTool() {
    const definitions = new Map<string, ToolDefinition>();
    const events = new Map<string, Function>();
    search({ registerCommand() {}, getActiveTools: () => [], setActiveTools() {},
      registerTool: (tool: ToolDefinition) => definitions.set(tool.name, tool),
      on: (name: string, handler: Function) => events.set(name, handler),
    } as unknown as ExtensionAPI);
    await events.get("session_start")!({}, ctx);
    return definitions.get("codex_standalone_web")!;
  }
  try {
    await mkdir(join(root, ".pi"));
    await writeFile(join(root, ".pi", CONFIG_FILE_NAME), JSON.stringify({ enabled: true, standaloneEnabled: true, model: "fixture", baseUrl: `http://127.0.0.1:${port}` }));
    const tool = await loadTool();
    const run = (params: Record<string, unknown>) => tool.execute("scope", params, undefined, undefined, ctx);
    const url = "https://example.com/docs";
    await run({ urls: [url] });
    id = "B";
    for (const params of [{ find: [{ url, pattern: "API" }] }, { click: [{ url, id: 1 }] }, { screenshot: [{ url, pageno: 0 }] }]) {
      await expect(run(params)).rejects.toThrow(/opening.*first in this session/);
      expect(requests).toHaveLength(1);
    }
    await run({ urls: [url] });
    await run({ find: [{ url, pattern: "API" }] });
    expect(requests.at(-1)).toMatchObject({ id: "B", commands: { find: [{ ref_id: "turn1view0" }] } });
    id = "A";
    const restored = await loadTool();
    await restored.execute("restore", { find: [{ url, pattern: "API" }] }, undefined, undefined, ctx);
    expect(requests.at(-1)).toMatchObject({ id: "A", commands: { find: [{ ref_id: "turn0view0" }] } });
    for (id of ["fork", "clone"]) await expect(run({ find: [{ url, pattern: "API" }] })).rejects.toThrow(/first in this session/);

    id = "A"; pauseAuth = true;
    const pending = run({ urls: ["https://example.com/late"] });
    await expect.poll(() => releaseAuth).toBeDefined();
    id = "B"; hold = true; releaseAuth!(); pauseAuth = false;
    await expect.poll(() => release).toBeDefined();
    expect(requests.at(-1)?.id).toBe("A");
    hold = false; release!();
    await pending;
    await expect(run({ find: [{ url: "https://example.com/late", pattern: "API" }] })).rejects.toThrow(/first in this session/);
    id = "A";
    await run({ find: [{ url: "https://example.com/late", pattern: "API" }] });
    expect(requests.at(-1)).toMatchObject({ id: "A", commands: { find: [{ ref_id: "turn0view0" }] } });
    await run({ find: [{ url: "turn9view0", pattern: "explicit ref" }] });
    expect(requests.at(-1)?.commands.find[0].ref_id).toBe("turn9view0");
  } finally {
    releaseAuth?.(); release?.();
    http.closeAllConnections();
    await new Promise<void>(resolve => http.close(() => resolve()));
    expect(http.listening).toBe(false);
    await rm(root, { recursive: true, force: true });
  }
});
