import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test, expect, vi } from "vitest";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { ModelRuntime, SettingsManager, SessionManager, DefaultResourceLoader, createAgentSession } from "@earendil-works/pi-coding-agent";
import registerMcpExtension from "../src/index.js";

test.each([false, true])("keeps offline history tools inactive after tree restore, recorded=%s", async recorded => {
  const root = await mkdtemp(resolve(".tmp/mcp-history-session-"));
  const name = "mcp__offline__old";
  const config = join(root, "mcp.json");
  await writeFile(config, '{"mcpServers":{}}');
  vi.stubEnv("PI_MCP_CONFIG", config);
  vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
  const sm = SessionManager.inMemory(root);
  const early = sm.appendMessage({ role: "system", content: "head", toolsAdded: recorded ? [{ name, description: "old", parameters: { type: "object", properties: {} } }] : [], timestamp: 0 } as any);
  sm.appendMessage({ role: "user", content: "old task", timestamp: 1 });
  const late = sm.appendMessage({ role: "toolResult", toolName: name, toolCallId: "old", content: [{ type: "text", text: "old result" }], isError: false, timestamp: 2 });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: settings,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: [registerMcpExtension] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime: runtime,
    model: getBuiltinModel("openai-codex", "gpt-5.6-sol")!, resourceLoader: loader, sessionManager: sm, settingsManager: settings });
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
  try {
    await session.bindExtensions({});
    expect(session.getAllTools().map(tool => tool.name)).toContain(name);
    expect(session.getActiveToolNames()).not.toContain(name);
    for (const target of [early, late, early]) {
      await session.navigateTree(target, { summarize: false });
      expect(session.getActiveToolNames()).not.toContain(name);
      expect(session.getToolDefinition(name)).toBeDefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await session.abort();
    await session.waitForIdle();
    await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
