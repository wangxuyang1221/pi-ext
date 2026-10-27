import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import {
  createAgentSession, createCodemodeExtension, DefaultResourceLoader,
  initTheme, ModelRuntime, SessionManager, SettingsManager, ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import codexUi from "../src/index.js";
import repositoryMcp from "../../mcp/src/index.js";
import { LocalHttpMcpFixture } from "../../mcp/__tests__/fixtures/http-mcp-fixture.js";

it("executes and renders repository MCP tools through direct calls and codemode", async () => {
  const fixture = await LocalHttpMcpFixture.start();
  const root = mkdtempSync(resolve(".tmp/mcp-ui-host-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  mkdirSync(join(root, ".pi"));
  // Only the provider and MCP endpoint are substituted. Repository config parsing,
  // discovery and execution, host codemode and transcript rendering are real.
  const config = JSON.stringify({ mcpServers: { remote: { url: fixture.url, type: "http" } } });
  writeFileSync(join(agentDir, "mcp.json"), config);
  writeFileSync(join(root, ".pi/mcp.json"), config);
  const settingsManager = SettingsManager.inMemory({ defaultTools: ["+codemode"], codemode: { mode: "on" }, cacheWarming: "off" });
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  let scripted = false;
  const model = { id: "offline", name: "Offline", api: "openai-completions" as const, provider: "mcp-ui-test", baseUrl: "http://127.0.0.1:1",
    reasoning: false, input: ["text" as const], contextWindow: 128000, maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [
      pi => pi.registerProvider(model.provider, { api: model.api, baseUrl: model.baseUrl, apiKey: "offline", models: [model],
        streamSimple(selected, context) {
          const stream = createAssistantMessageEventStream();
          const done = context.messages.at(-1)?.role === "toolResult";
          const toolCall: import("@earendil-works/pi-ai").ToolCall = { type: "toolCall" as const, id: scripted ? "script-call" : "direct-call",
            name: scripted ? "codemode" : "mcp__remote__echo",
            arguments: scripted ? { code: 'const r = await tools.mcp__remote__echo({text: "Script MCP result"}); text(r);' }
              : { text: "Real MCP result 中文" } };
          const message: AssistantMessage = { role: "assistant", api: selected.api, provider: selected.provider, model: selected.id,
            content: done ? [{ type: "text", text: "Done" }] : [toolCall], stopReason: done ? "stop" : "toolUse", timestamp: Date.now(),
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          stream.push({ type: "start", partial: message });
          if (!done) stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
          stream.push({ type: "done", reason: done ? "stop" : "toolUse", message });
          stream.end();
          return stream;
        },
      }),
      createCodemodeExtension({ mode: "on" }),
      repositoryMcp,
      codexUi,
    ],
  });
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    ({ session } = await createAgentSession({ cwd: root, agentDir, model, modelRuntime: runtime, settingsManager, resourceLoader: loader,
      sessionManager: SessionManager.inMemory(root) }));
    await session.bindExtensions({ mode: "print" });
    await vi.waitFor(() => expect(session!.getActiveToolNames()).toContain("mcp__remote__echo"));
    expect(session.getActiveToolNames()).toContain("codemode");
    const runner = session.extensionRunner!;
    const names = session.getActiveToolNames();
    expect(names.filter(name => name === "mcp__remote__echo")).toHaveLength(1);
    const definition = session.getToolDefinition("mcp__remote__echo")!;
    const renderers = runner.resolveToolRenderers(definition.name, () => definition)!;
    expect(renderers.renderShell).toBe("self");
    const codemode = session.getToolDefinition("codemode")!;
    const executeCodemode = codemode.execute;
    const codemodeRenderers = runner.resolveToolRenderers("codemode", () => codemode)!;
    expect(codemodeRenderers.renderShell).toBe("self");
    expect(session.getToolDefinition("codemode")!.execute).toBe(executeCodemode);

    await session.prompt("Call the MCP echo tool directly.");
    const result = session.messages.find(message => message.role === "toolResult" && message.toolName === definition.name);
    expect(result?.role).toBe("toolResult");
    if (result?.role !== "toolResult") throw new Error("Missing direct tool result");
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(fixture.count("tools/call")).toBe(1);
    initTheme("dark", false);
    const row = new ToolExecutionComponent(definition.name, "call", { text: "Real MCP result 中文" }, { showImages: false },
      { ...definition, ...renderers }, { requestRender() {} } as never, root);
    row.updateResult({ ...JSON.parse(JSON.stringify(result)), isError: false });
    for (const expanded of [false, true]) {
      row.setExpanded(expanded);
      for (const width of [1, 24, 80, 120]) expect(row.render(width).every(line => visibleWidth(line) <= width)).toBe(true);
      const text = stripTerminalSequences(row.render(120).join("\n"));
      expect(text).toContain("Called remote / echo");
      expect(text).toContain("Real MCP result 中文");
    }
    scripted = true;
    await session.prompt("Use codemode to call the MCP echo tool.");
    const script = session.messages.find(message => message.role === "toolResult" && message.toolName === "codemode");
    expect(script?.role).toBe("toolResult");
    if (script?.role !== "toolResult") throw new Error("Missing codemode result");
    expect(script.isError, JSON.stringify(script)).not.toBe(true);
    expect(JSON.stringify(script.content)).toContain("Script MCP result");
    expect(fixture.count("tools/call")).toBe(2);
    const scriptRow = new ToolExecutionComponent("codemode", "script-call", {}, { showImages: false },
      { ...codemode, ...codemodeRenderers }, { requestRender() {} } as never, root);
    scriptRow.updateResult(script);
    const scriptText = stripTerminalSequences(scriptRow.render(120).join("\n"));
    expect(scriptText).toContain("Codemode");
    expect(scriptText).toContain("Script completed");
    expect(scriptText).toContain("mcp__remote__echo");
    expect(session.getToolDefinition("codemode")!.execute).toBe(executeCodemode);
  } finally {
    if (session) {
      await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    }
    await fixture.close();
    expect(fixture.server.listening).toBe(false);
    await vi.waitFor(() => expect(fixture.sockets.size).toBe(0));
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
