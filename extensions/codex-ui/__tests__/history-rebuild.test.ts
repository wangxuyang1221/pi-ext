import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { InMemoryCredentialStore, InMemoryModelsStore, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, initTheme, InteractiveMode, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences } from "@earendil-works/pi-tui";
import { registerCodexTools } from "../src/tools.js";

test("Read groups survive native rebuild, live completion, SDK reload, tree and compaction", async () => {
  initTheme("dark", false);
  mkdirSync(".tmp", { recursive: true });
  const cwd = mkdtempSync(join(process.cwd(), ".tmp/codex-history-"));
  const settingsManager = SettingsManager.inMemory({ showCacheMissNotices: false, compaction: { keepRecentTokens: 10 } });
  let firstKeptEntryId = "";
  const sessionManager = SessionManager.inMemory(cwd);
  sessionManager.appendMessage(fauxAssistantMessage(["a", "b"].map(id => ({ type: "toolCall", id, name: "read", arguments: { path: `${id}.ts` } })), { stopReason: "toolUse" }));
  for (const id of ["a", "b"]) sessionManager.appendMessage({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: `content ${id}` }], isError: false, timestamp: 1 });
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const faux = fauxProvider(); models.registerNativeProvider(faux.provider);
  const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [pi => {
      registerCodexTools(pi, undefined, { getExecutionOptions: () => ({}) });
      pi.on("session_before_compact", () => ({ compaction: { summary: "Earlier reads summarized", firstKeptEntryId, tokensBefore: 100 } }));
    }],
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
      mode.rebuildChatFromMessages();
      assert.match(plain(), /Read 2 files/u);
      for (const id of ["a", "b"]) assert(plain().includes(`content ${id}`));
      mode.chatContainer.invalidate(); assert.match(plain(), /Read 2 files/u);
    }
    for (const id of ["c", "d"]) writeFileSync(join(cwd, `${id}.ts`), `fresh content ${id}`);
    faux.setResponses([
      fauxAssistantMessage(["c", "d"].map(id => ({ type: "toolCall", id, name: "read", arguments: { path: `${id}.ts` } })), { stopReason: "toolUse" }),
      fauxAssistantMessage("Done"),
    ]);
    await session.prompt("Read the new files");
    mode.rebuildChatFromMessages();
    assert.equal(plain().match(/Read 2 files/gu)?.length, 2);
    for (const id of ["c", "d"]) assert(plain().includes(`fresh content ${id}`));
    mode.rebuildChatFromMessages();
    assert.equal(plain().match(/Read 2 files/gu)?.length, 2);
    await session.reload({ beforeSessionStart: async () => mode.rebuildChatFromMessages() });
    assert.equal(plain().match(/Read 2 files/gu)?.length, 2);
    for (const id of ["a", "b"]) assert(plain().includes(`content ${id}`));
    const leaf = sessionManager.getLeafId()!;
    const oldResult = sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === "b")!;
    await session.navigateTree(oldResult.id);
    mode.rebuildChatFromMessages();
    assert.equal(plain().match(/Read 2 files/gu)?.length, 1);
    assert.doesNotMatch(plain(), /fresh content/u);
    await session.navigateTree(leaf);
    mode.rebuildChatFromMessages();
    assert.equal(plain().match(/Read 2 files/gu)?.length, 2);
    firstKeptEntryId = sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.role === "user")!.id;
    await session.compact();
    mode.rebuildChatFromMessages();
    assert.equal(plain().match(/Read 2 files/gu)?.length, 1);
    assert.doesNotMatch(plain(), /content [ab]/u);
    for (const id of ["c", "d"]) assert(plain().includes(`fresh content ${id}`));
  } finally { session.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});
