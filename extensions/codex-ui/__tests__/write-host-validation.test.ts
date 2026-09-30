import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, initTheme, ModelRuntime, SessionManager, SettingsManager, ToolExecutionComponent,
  type AgentSession, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { test } from "vitest";
import { registerCodexTools } from "../src/tools.js";

const cases = [
  { name: "missing", args: {}, valid: false },
  ...[null, 123, {}, []].map(content => ({ name: JSON.stringify(content), args: { content }, valid: false })),
  { name: "string", args: { content: "new contents\n" }, valid: true },
];

test.each(cases)("validates Write content $name through the real host without mutating rejected targets", async ({ args, valid }) => {
  mkdirSync(".tmp", { recursive: true });
  const cwd = mkdtempSync(resolve(".tmp/write-host-"));
  let session: AgentSession | undefined;
  try {
    const existing = join(cwd, "existing.txt"), fresh = join(cwd, "fresh.txt");
    writeFileSync(existing, "original contents\n");
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
      modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    const faux = fauxProvider({ tokensPerSecond: 100000 }); runtime.registerNativeProvider(faux.provider);
    const calls = ["existing.txt", "fresh.txt"].map((path, index) => ({ type: "toolCall" as const, name: "write", id: `write-${index}`, arguments: { path, ...args } }));
    // Substitute only model responses, not host validation, tool execution, or results.
    faux.setResponses([fauxAssistantMessage(calls, { stopReason: "toolUse" }), fauxAssistantMessage("Done")]);
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
    let write: ToolDefinition | undefined, executed = 0;
    const errors: unknown[] = [];
    const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [pi => registerCodexTools({ ...pi, registerTool: tool => {
        if (tool.name !== "write") { pi.registerTool(tool); return; }
        write = tool;
        pi.registerTool({ ...tool, execute: (...input) => { executed++; return tool.execute(...input); } });
      } })] });
    await loader.reload();
    ({ session } = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), resourceLoader: loader, settingsManager,
      modelRuntime: runtime, model: faux.getModel(), sessionManager: SessionManager.inMemory(cwd), noTools: "builtin" }));
    await session.bindExtensions({ mode: "json", onError: error => errors.push(error) });
    await session.prompt("Execute the supplied Write calls");
    await session.waitForIdle();
    const results = session.messages.filter(message => message.role === "toolResult");
    assert.equal(results.length, 2, JSON.stringify(session.messages));
    assert.deepEqual(errors, []);
    assert.equal(executed, valid ? 2 : 0, `Invalid arguments must be rejected before entering the repository executor: ${JSON.stringify({ results, existing: readFileSync(existing, "utf8"), fresh: existsSync(fresh) ? readFileSync(fresh, "utf8") : null })}`);
    assert.equal(readFileSync(existing, "utf8"), valid ? "new contents\n" : "original contents\n");
    assert.equal(existsSync(fresh), valid);
    if (valid) assert.equal(readFileSync(fresh, "utf8"), "new contents\n");
    initTheme("dark", false);
    for (const [index, result] of results.entries()) {
      assert.equal(result.isError, !valid);
      const row = new ToolExecutionComponent("write", calls[index].id, calls[index].arguments,
        { showImages: false }, write, { requestRender() {} } as any, cwd);
      row.setArgsComplete(); row.updateResult(result); row.setExpanded(true);
      const rendered = row.render(100).map(stripTerminalSequences).join("\n");
      if (valid) assert.match(rendered, /Edited|Added|Write/u);
      else {
        const diagnosis = result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
        assert.match(diagnosis, /content/u);
        assert.match(diagnosis, /valid|string|required/iu);
        assert.match(rendered, /Validation failed for tool "write"/u);
      }
    }
  } finally { await session?.abort(); session?.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});
