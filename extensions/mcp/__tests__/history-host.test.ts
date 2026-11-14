import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import registerMcpExtension from "../src/index.js";
import { HistoryHandoff } from "../src/history-handoff.js";

const root = resolve(process.env.PI_MCP_TEST_PI_ROOT ?? "node_modules/@earendil-works/pi-coding-agent");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const expectedVersion = process.env.PI_MCP_TEST_PI_VERSION ?? JSON.parse(readFileSync("package.json", "utf8")).devDependencies["@earendil-works/pi-coding-agent"];
if (version !== expectedVersion) throw new Error(`Expected Pi ${expectedVersion}, got ${version}`);
const host = await import(pathToFileURL(join(root, "dist/index.js")).href);
const loader = await import(pathToFileURL(join(root, "dist/core/extensions/loader.js")).href);
const { theme } = await import(pathToFileURL(join(root, "dist/modes/interactive/theme/theme.js")).href);
const name = "mcp__offline__old-tool";
let directory: string | undefined;
const inherited = process.env.PI_CODING_AGENT_DIR;
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  if (inherited === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = inherited;
});

describe(`MCP history real loader, registry, and row on Pi ${version}`, () => {
  it("renders history without registering or activating tools and defers to live renderers", async () => {
    mkdirSync(".tmp", { recursive: true });
    directory = mkdtempSync(resolve(".tmp/history-host-"));
    process.env.PI_CODING_AGENT_DIR = directory;
    new HistoryHandoff(directory).publish([{ fullName: name, serverName: "offline", toolName: "old-tool" }]);
    const runtime = loader.createExtensionRuntime();
    const extension = await loader.loadExtensionFromFactory(registerMcpExtension, directory, host.createEventBus(), runtime);
    expect(extension.tools.has(name)).toBe(false);
    runtime.getAllTools = () => [...extension.tools.values()].map(({ definition }: any) => definition);
    const renderer = extension.toolRenderers[0](name, () => undefined);
    expect(renderer.renderShell).toBe("self");
    // Native MCP's broad fallback yields to our known historical identity in
    // either extension load order, while real definitions retain ownership.
    const nativeFallback = { renderShell: "default" };
    const nativeResolver = (_name: string, next: () => any) => next() ?? nativeFallback;
    const historyResolver = extension.toolRenderers[0];
    expect(historyResolver(name, () => nativeResolver(name, () => undefined))).toBe(renderer);
    expect(nativeResolver(name, () => historyResolver(name, () => undefined))).toBe(renderer);
    const session = Object.create(host.AgentSession.prototype);
    Object.assign(session, {
      agent: { state: { tools: [] } }, _toolRegistry: new Map(), _toolDefinitions: new Map(), _pendingToolNames: new Set(),
      _baseToolDefinitions: new Map(), _customTools: [], _rebuildSystemPrompt: () => "fixture",
      _extensionRunner: { getAllRegisteredTools: () => [...extension.tools.values()] },
    });
    session._refreshToolRegistry();
    session.setActiveToolsByName([]);
    expect(session.getToolDefinition(name)).toBeUndefined();
    session.setActiveToolsByName([name]);
    expect(session.getActiveToolNames()).toEqual([]);
    host.initTheme("dark", false);
    const row = new host.ToolExecutionComponent(name, "call", { query: "safe" }, { showImages: false },
      renderer, { requestRender() {} }, directory);
    expect(row.render(120).join("\n")).toContain(theme.fg("warning", "⌁"));
    for (const isError of [false, true]) {
      row.updateResult({ content: [{ type: "text", text: "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight" }], isError });
      for (const expanded of [false, true]) {
        row.setExpanded(expanded);
        for (const width of [1, 24, 60, 120]) expect(row.render(width).every((line: string) => visibleWidth(line) <= width)).toBe(true);
        const text = row.render(120).map(stripTerminalSequences).join("\n");
        expect(text).toContain(isError ? "⌁ Call failed for offline / old-tool" : "⌁ Called offline / old-tool");
        expect(row.render(120).join("\n")).toContain(theme.fg(isError ? "error" : "muted", "⌁"));
      }
    }
    const live = { name, label: "MCP", description: "current schema", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }), ...renderer };
    extension.tools.set(name, { definition: live, extensionPath: "fixture" });
    session._refreshToolRegistry();
    expect(session.getToolDefinition(name)).toBe(live);
    expect(historyResolver(name, () => nativeResolver(name, () => live))).toBe(live);
    expect(nativeResolver(name, () => historyResolver(name, () => live))).toBe(live);
    session.setActiveToolsByName([name]);
    expect(session.getActiveToolNames()).toEqual([name]);
    session._excludedTools = (toolName: string) => toolName === name;
    session._refreshToolRegistry();
    session.setActiveToolsByName([name]);
    expect(session.getToolDefinition(name)).toBeUndefined();
    expect(session.getActiveToolNames()).toEqual([]);
    expect(row.render(120).map(stripTerminalSequences).join("\n")).toContain("offline / old-tool");
  });
});
