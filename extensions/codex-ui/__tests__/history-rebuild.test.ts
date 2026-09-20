import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { InMemoryCredentialStore, InMemoryModelsStore, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, initTheme, InteractiveMode, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../src/tools.js";

test("Read history preserves grouping across native thinking rebuild and real SDK reload", async () => {
  initTheme("dark", false);
  mkdirSync(".tmp", { recursive: true });
  const cwd = mkdtempSync(join(process.cwd(), ".tmp/codex-history-"));
  const settingsManager = SettingsManager.inMemory({ showCacheMissNotices: false });
  const sessionManager = SessionManager.inMemory(cwd);
  sessionManager.appendMessage(fauxAssistantMessage(["a", "b"].map(id => ({ type: "toolCall", id, name: "read", arguments: { path: `${id}.ts` } })), { stopReason: "toolUse" }));
  for (const id of ["a", "b"]) sessionManager.appendMessage({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: `content ${id}` }], isError: false, timestamp: 1 });
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const faux = fauxProvider(); models.registerNativeProvider(faux.provider);
  const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [pi => registerCodexTools(pi)],
  });
  await loader.reload();
  const { session } = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), settingsManager, sessionManager,
    resourceLoader: loader, modelRuntime: models, model: faux.getModel() });
  try {
    await session.bindExtensions({ mode: "tui", onError: error => assert.fail(error.message) });
    // Use native rebuild methods and tool components; omit unrelated editor/footer UI.
    const mode = Object.create(InteractiveMode.prototype);
    Object.defineProperties(mode, Object.getOwnPropertyDescriptors({
      session, settingsManager, sessionManager, chatContainer: new Container(), pendingTools: new Map(),
      ui: { requestRender() {} }, getRegisteredToolDefinition: (name: string) => session.getToolDefinition(name),
      addMessageToChat() {}, showStatus() {}, hideThinkingBlock: false, toolOutputExpanded: false,
    }));
    const plain = () => mode.chatContainer.render(100).map(stripTerminalSequences).join("\n");
    mode.rebuildChatFromMessages();
    assert.match(plain(), /Read 2 files/u);
    for (let i = 0; i < 3; i++) {
      mode.toggleThinkingBlockVisibility();
      assert.match(plain(), /Read 2 files/u);
      for (const id of ["a", "b"]) assert(plain().includes(`content ${id}`));
      mode.chatContainer.invalidate(); assert.match(plain(), /Read 2 files/u);
    }
    await session.reload({ beforeSessionStart: async () => mode.rebuildChatFromMessages() });
    assert.match(plain(), /Read 2 files/u);
    for (const id of ["a", "b"]) assert(plain().includes(`content ${id}`));
  } finally { session.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});
