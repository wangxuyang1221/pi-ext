import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createTestEnvironment } from "../../../../../test-support/environment.mjs";

// Use the current dependency tree, including when invoked from the isolated patched checkout.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const evidence = join(repo, ".tmp/test-results", `mcp-native-coexistence-${Date.now()}-${process.pid}`);
mkdirSync(evidence, { recursive: true });
const { directory, env } = createTestEnvironment("mcp-native-coexistence", repo);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env);
process.env.PI_MCP_CONFIG = join(directory, "mcp.json");
writeFileSync(process.env.PI_MCP_CONFIG, '{"mcpServers":{}}');
const summary = { passed: false, host: null, cases: [], cleanup: { scratchRemoved: false, openTransports: 0, pendingTimers: 0 } };
let openTransports = 0;
const timers = new Set();
try {
  const hostPath = import.meta.resolve("@earendil-works/pi-coding-agent");
  const host = await import(hostPath);
  const { createInMemoryTransportPair } = await import(new URL("../../pi-mcp/dist/testing/index.js", hostPath));
  const mcp = (await import(pathToFileURL(join(repo, "extensions/mcp/dist/index.js")))).default;
  summary.host = { entry: hostPath, version: JSON.parse(readFileSync(new URL("../package.json", hostPath), "utf8")).version };
  const name = "mcp__native__search";
  const settings = () => host.SettingsManager.inMemory({ defaultProjectTrust: "never", retry: { enabled: false }, compaction: { enabled: false }, cacheWarming: "off" });
  async function wait(predicate, label) {
    const end = Date.now() + 5000;
    while (!predicate()) { assert(Date.now() < end, label); await delay(10); }
  }
  async function openSession(manager, withExtension, kind) {
    const pairs = [];
    let connections = 0;
    let calls = 0;
    const native = host.createMcpExtension({
      loadConfig: () => ({ servers: [{ name: "native", config: { url: "http://unused.invalid", exposure: "deferred" }, source: "test" }], errors: [] }),
      createTransport: () => {
        connections += 1;
        const pair = createInMemoryTransportPair();
        pairs.push(pair); openTransports += 1;
        pair.server.onMessage(message => {
          if (!("id" in message) || !("method" in message)) return;
          let result = {};
          if (message.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "native", version: "1" } };
          if (message.method === "tools/list") result = { tools: [{ name: "search", description: "Search local fixture", inputSchema: { type: "object", properties: {} } }] };
          if (message.method === "tools/call") { calls += 1; result = { content: [{ type: "text", text: "native protocol result" }], ...(kind === "error" ? { isError: true } : {}) }; }
          const timer = setTimeout(() => { timers.delete(timer); void pair.server.send({ jsonrpc: "2.0", id: message.id, result }).catch(() => {}); }, message.method === "initialize" ? 100 : 0);
          timers.add(timer);
        });
        void pair.server.start();
        return pair.client;
      },
    });
    const options = settings();
    const runtime = await host.ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: null, modelsStorePath: join(directory, "models-cache.json"), refreshOnCreate: false, allowModelNetwork: false });
    const resourceLoader = new host.DefaultResourceLoader({ cwd: directory, agentDir: env.PI_CODING_AGENT_DIR, settingsManager: options, noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: [host.createToolSearchExtension(), ...(withExtension ? [mcp] : []), native] });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    const { session } = await host.createAgentSession({ cwd: directory, agentDir: env.PI_CODING_AGENT_DIR, resourceLoader, sessionManager: manager, settingsManager: options, modelRuntime: runtime });
    return {
      session,
      async ready() { await session.bindExtensions({ mode: "rpc", onError: error => { throw new Error(JSON.stringify(error)); } }); await wait(() => session.getToolDefinition(name)?.namespace !== undefined, "Native tool did not register"); },
      async reloaded() { await session.reload(); await wait(() => session.getToolDefinition(name)?.namespace !== undefined, "Native tool did not re-register"); },
      async call() { return session.getToolDefinition(name).execute("native-probe", {}, undefined, undefined); },
      stats: () => ({ connections, calls }),
      async close() { await session._extensionRunner.emit({ type: "session_shutdown" }); session.dispose(); for (const pair of pairs) { await pair.server.close(); await pair.client.close(); openTransports -= 1; } },
    };
  }
  for (const kind of ["success", "error", "unfinished"]) {
    const sessionDirectory = join(directory, kind);
    mkdirSync(sessionDirectory);
    const manager = host.SessionManager.create(directory, sessionDirectory);
    const seed = await openSession(manager, false, kind);
    let saved;
    try {
      await seed.ready();
      const search = seed.session.getToolDefinition("tool_search");
      await search.execute("discover", { query: name }, undefined, undefined);
      assert(seed.session.getActiveToolNames().includes(name), "tool_search did not activate native tool");
      const definition = seed.session.getToolDefinition(name);
      manager.appendMessage({ role: "system", content: [], toolsAdded: [{ name, description: definition.description, parameters: definition.parameters }], timestamp: Date.now() });
      manager.appendMessage({ role: "assistant", api: "openai-responses", provider: "fixture", model: "fixture", content: [{ type: "toolCall", id: "seed", name, arguments: {} }], stopReason: "toolUse", usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now() });
      if (kind !== "unfinished") {
        const result = await seed.call();
        assert.deepEqual(result.details, { server: "native", tool: "search" });
        manager.appendMessage({ role: "toolResult", toolCallId: "seed", toolName: name, ...result, isError: kind === "error", timestamp: Date.now() });
      }
      saved = manager.getSessionFile();
      assert(saved && existsSync(saved), "Fixture history was not persisted");
      writeFileSync(join(evidence, `${kind}-session.jsonl`), readFileSync(saved));
    } finally { await seed.close(); }
    const resumed = await openSession(host.SessionManager.open(saved), true, kind);
    const row = { kind, resume: false, reload: false };
    summary.cases.push(row);
    try {
      await resumed.ready();
      assert(resumed.session.getActiveToolNames().includes(name), `${kind}: resumed native tool lost activation`);
      assert.equal(resumed.stats().calls, 0, "Resume replayed an old call");
      assert.equal((await resumed.call()).content[0].text, "native protocol result");
      row.resume = true;
      await resumed.reloaded();
      assert(resumed.session.getActiveToolNames().includes(name), `${kind}: reloaded native tool lost activation`);
      assert.equal(resumed.stats().calls, 1, "Reload replayed an old call");
      assert.equal((await resumed.call()).content[0].text, "native protocol result");
      Object.assign(row, { reload: true, ...resumed.stats() });
    } finally { await resumed.close(); }
  }
  summary.passed = true;
} catch (error) {
  summary.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  for (const timer of timers) clearTimeout(timer);
  summary.cleanup.pendingTimers = timers.size;
  timers.clear();
  rmSync(directory, { recursive: true, force: true });
  summary.cleanup.scratchRemoved = !existsSync(directory);
  summary.cleanup.openTransports = openTransports;
  if (openTransports !== 0 || summary.cleanup.pendingTimers !== 0) { summary.passed = false; process.exitCode = 1; }
  writeFileSync(join(evidence, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, evidence }));
}
