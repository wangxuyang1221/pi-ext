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
  { name: "missing", args: {}, expected: undefined },
  { name: "null coerced to string", args: { content: null }, expected: "null" },
  { name: "number coerced to string", args: { content: 123 }, expected: "123" },
  { name: "object", args: { content: {} }, expected: undefined },
  { name: "array", args: { content: [] }, expected: undefined },
  { name: "string", args: { content: "new contents\n" }, expected: "new contents\n" },
];

test.each(cases)("validates Write content $name through the real host without mutating rejected targets", async ({ args, expected }) => {
  const valid = expected !== undefined;
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
    let write: ToolDefinition | undefined;
    const executedContent: unknown[] = [];
    const errors: unknown[] = [];
    const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [pi => registerCodexTools({ ...pi, registerTool: tool => {
        if (tool.name !== "write") { pi.registerTool(tool); return; }
        write = tool;
        pi.registerTool({ ...tool, execute: (...input) => { executedContent.push(input[1].content); return tool.execute(...input); } });
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
    assert.deepEqual(executedContent, valid ? [expected, expected] : [], "Only validated strings may reach the repository executor");
    assert.equal(readFileSync(existing, "utf8"), valid ? expected : "original contents\n");
    assert.equal(existsSync(fresh), valid);
    if (valid) assert.equal(readFileSync(fresh, "utf8"), expected);
    initTheme("dark", false);
    for (const [index, result] of results.entries()) {
      assert.equal(result.isError, !valid);
      const row = new ToolExecutionComponent("write", calls[index].id, calls[index].arguments,
        { showImages: false }, write, { requestRender() {} } as any, cwd);
      row.setArgsComplete(); row.updateResult(result); row.setExpanded(true);
      const rendered = row.render(100).map(stripTerminalSequences).join("\n");
      if (valid) {
        const action = index === 0 ? "Edited" : "Added";
        assert.equal((result.details as { codexWrite: { action: string } }).codexWrite.action, action);
        // Raw non-string arguments use the host's fallback call header even after execution coerces them.
        if ("content" in args && typeof args.content === "string") assert.ok(rendered.includes(action));
        else assert.match(rendered, /write\s/u);
        assert.ok(rendered.includes(expected.trimEnd()), "Successful output must render the actual written content");
      } else {
        const diagnosis = result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
        assert.match(diagnosis, /content/u);
        assert.match(diagnosis, /valid|string|required/iu);
        assert.match(rendered, /Validation failed for tool "write"/u);
      }
    }
  } finally { await session?.abort(); session?.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});
