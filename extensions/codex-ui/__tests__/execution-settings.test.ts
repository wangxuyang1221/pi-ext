import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { InMemoryCredentialStore, InMemoryModelsStore, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, test, vi } from "vitest";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SettingsManager,
  createBashToolDefinition, createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition,
  SessionManager, type ExtensionAPI, type ExtensionContext, type ExtensionToolContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerCodexTools, type CodexToolFactories, type CodexToolRenderServices } from "../src/tools.js";
import codexUi from "../src/index.js";

const { settingsReads, executions, definitions } = vi.hoisted(() => ({ settingsReads: vi.fn(), executions: vi.fn(), definitions: vi.fn() }));
vi.mock("@earendil-works/pi-coding-agent", async original => {
  const actual = await original<typeof import("@earendil-works/pi-coding-agent")>();
  const observe = <T extends typeof actual.createReadToolDefinition | typeof actual.createBashToolDefinition>(name: string, factory: T) =>
    (...args: Parameters<T>) => {
      definitions(name);
      const definition = (factory as Function)(...args);
      return { ...definition, execute(...input: unknown[]) { executions(name); return definition.execute(...input); } };
    };
  return { ...actual, createReadToolDefinition: observe("read", actual.createReadToolDefinition),
    createBashToolDefinition: observe("bash", actual.createBashToolDefinition) };
});
vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, readFileSync(...args: Parameters<typeof actual.readFileSync>) {
    settingsReads(args[0]);
    return actual.readFileSync(...args);
  } };
});

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  settingsReads.mockReset(); executions.mockClear(); definitions.mockClear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(join(process.cwd(), ".tmp/codex-settings-"));
  directories.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(agentDir); mkdirSync(join(cwd, ".pi"), { recursive: true });
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  const global = (value: unknown) => writeFileSync(join(agentDir, "settings.json"), JSON.stringify(value));
  const project = (value: unknown) => writeFileSync(join(cwd, ".pi/settings.json"), JSON.stringify(value));
  return { root, cwd, agentDir, global, project };
}
function harness(cwd: string, mode: ExtensionContext["mode"] = "print", trusted = true,
  services?: CodexToolRenderServices, factories?: CodexToolFactories) {
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => void>>();
  const ctx = { tools: [], executeTool: async () => { throw new Error("Unexpected nested tool call"); }, cwd, mode, sessionManager: SessionManager.inMemory(cwd), isProjectTrusted: () => trusted } as unknown as ExtensionToolContext;
  registerCodexTools({
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    on(name: string, fn: (event: any, ctx: ExtensionContext) => void) {
      const list = handlers.get(name) ?? []; list.push(fn); handlers.set(name, list);
    },
  } as unknown as ExtensionAPI, factories, services);
  const emit = (type: string) => { for (const fn of handlers.get(type) ?? []) fn({ type }, ctx); };
  emit("session_start");
  return { tools, ctx, emit, async bash(command: string) {
    const result = await tools.get("bash")!.execute("bash", { command }, undefined, undefined, ctx);
    return result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
  } };
}

function widePng(): Buffer {
  const crc32 = (bytes: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(4000); header.writeUInt32BE(40, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((4000 * 3 + 1) * 40))), chunk("IEND", Buffer.alloc(0))]);
}

test("file command prefixes apply in TUI, print and RPC without reading untrusted project settings", async () => {
  const f = fixture();
  f.global({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=global" });
  f.project({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=project" });
  for (const mode of ["tui", "print", "rpc"] as const) {
    for (const trusted of [false, true]) {
      const h = harness(f.cwd, mode, trusted);
      try {
        settingsReads.mockClear();
        assert.equal(await h.bash('printf "%s" "${CODEX_SETTINGS_PROBE:-missing}"'), trusted ? "project" : "global");
        assert.deepEqual(settingsReads.mock.calls.map(([path]) => path), [join(f.agentDir, "settings.json"),
          ...(trusted ? [join(f.cwd, ".pi/settings.json")] : [])]);
        await h.bash("true");
        assert.equal(settingsReads.mock.calls.length, trusted ? 2 : 1);
      } finally { h.emit("session_shutdown"); }
    }
  }
});

test("shell wrappers, prefix cwd and image settings survive merged file configuration", async () => {
  const f = fixture();
  const shell = join(f.root, "shell-wrapper");
  writeFileSync(shell, '#!/bin/sh\nexport CODEX_SETTINGS_SHELL=wrapper\nexec /bin/bash "$@"\n', { mode: 0o755 });
  f.global({ shellPath: shell, shellCommandPrefix: `cd '${f.root}'`, images: { autoResize: false } });
  f.project({ images: { showImages: false } });
  writeFileSync(join(f.cwd, "wide.png"), widePng());
  const h = harness(f.cwd);
  try {
    assert.equal(await h.bash('printf "%s:%s" "$CODEX_SETTINGS_SHELL" "$PWD"'), `wrapper:${f.root}`);
    const result = await h.tools.get("read")!.execute("image", { path: "wide.png" }, undefined, undefined, h.ctx);
    const image = result.content.find(item => item.type === "image"); assert(image?.type === "image");
    const bytes = Buffer.from(image.data, "base64");
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [4000, 40]);
    f.project({ images: { autoResize: true } }); h.emit("session_start");
    const resized = await h.tools.get("read")!.execute("image-resized", { path: "wide.png" }, undefined, undefined, h.ctx);
    const resizedImage = resized.content.find(item => item.type === "image"); assert(resizedImage?.type === "image");
    const resizedBytes = Buffer.from(resizedImage.data, "base64");
    assert.deepEqual([resizedBytes.readUInt32BE(16), resizedBytes.readUInt32BE(20)], [2000, 20]);
  } finally { h.emit("session_shutdown"); }
});

test("settings are snapshots until session restart and never leak between cwd or trust states", async () => {
  const f = fixture();
  const command = 'printf "%s" "${CODEX_SETTINGS_PROBE:-default}"';
  f.global({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=first" });
  const h = harness(f.cwd);
  try {
    assert.equal(await h.bash(command), "first");
    f.global({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=next" });
    assert.equal(await h.bash(command), "first");
    h.emit("session_start");
    assert.equal(await h.bash(command), "next");
    f.project({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=local" });
    h.emit("session_start");
    assert.equal(await h.bash(command), "local");
    h.ctx.cwd = f.root;
    assert.equal(await h.bash(command), "next");
    h.ctx.cwd = f.cwd; h.ctx.isProjectTrusted = () => false;
    assert.equal(await h.bash(command), "next");
  } finally { h.emit("session_shutdown"); }
});

test("malformed scopes reject execution while missing scopes use defaults without creating files or locks", async () => {
  const f = fixture();
  f.global({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=global" });
  writeFileSync(join(f.cwd, ".pi/settings.json"), "{broken");
  const h = harness(f.cwd);
  try {
    await assert.rejects(() => h.bash("true"), /Cannot load project execution settings/);
    writeFileSync(join(f.agentDir, "settings.json"), "{broken");
    h.emit("session_start");
    await assert.rejects(() => h.bash("true"), /Cannot load global, project execution settings/);
    assert.deepEqual(readdirSync(f.agentDir), ["settings.json"]);
    assert.deepEqual(readdirSync(join(f.cwd, ".pi")), ["settings.json"]);
    rmSync(join(f.cwd, ".pi/settings.json")); rmSync(join(f.agentDir, "settings.json"));
    h.emit("session_start"); await h.bash("true");
    assert.deepEqual(readdirSync(f.agentDir), []); assert.deepEqual(readdirSync(join(f.cwd, ".pi")), []);
  } finally { h.emit("session_shutdown"); }
});

test("failed file snapshots are bounded, trust-isolated and block both tools in every mode", async () => {
  const f = fixture();
  f.global({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=global" });
  f.project({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=project" });
  for (const mode of ["tui", "print", "rpc"] as const) for (const scope of ["global", "project"] as const) {
    const deniedPath = scope === "global" ? join(f.agentDir, "settings.json") : join(f.cwd, ".pi/settings.json");
    settingsReads.mockImplementation(path => {
      if (path === deniedPath) throw Object.assign(new Error("Sensitive I/O error details"), { code: "EACCES" });
    });
    const h = harness(f.cwd, mode);
    definitions.mockClear(); executions.mockClear(); settingsReads.mockClear();
    try {
      for (let i = 0; i < 3; i++) {
        await assert.rejects(() => h.bash("true"), new RegExp(`Cannot load ${scope} execution settings`));
        await assert.rejects(async () => h.tools.get("read")!.execute("read", { path: "anything.txt" }, undefined, undefined, h.ctx),
          error => error instanceof Error && !error.message.includes("Sensitive"));
      }
      assert.equal(settingsReads.mock.calls.length, 2);
      assert.equal(definitions.mock.calls.length, 0); assert.equal(executions.mock.calls.length, 0);
      if (scope === "project") {
        h.ctx.isProjectTrusted = () => false;
        assert.equal(await h.bash('printf "%s" "$CODEX_SETTINGS_PROBE"'), "global");
        h.ctx.isProjectTrusted = () => true;
      }
      settingsReads.mockReset();
      await assert.rejects(() => h.bash("true"), /Cannot load/);
      assert.equal(settingsReads.mock.calls.length, 0);
      h.emit("session_start");
      assert.equal(await h.bash('printf "%s" "$CODEX_SETTINGS_PROBE"'), "project");
    } finally { h.emit("session_shutdown"); settingsReads.mockReset(); }
  }
  writeFileSync(join(f.cwd, ".pi/settings.json"), "{broken");
  const untrusted = harness(f.cwd, "print", false);
  try {
    settingsReads.mockClear();
    assert.equal(await untrusted.bash('printf "%s" "$CODEX_SETTINGS_PROBE"'), "global");
    assert.deepEqual(settingsReads.mock.calls.map(([path]) => path), [join(f.agentDir, "settings.json")]);
  } finally { untrusted.emit("session_shutdown"); }
});

test("explicit SDK options are captured once per snapshot and injected factories keep ownership", async () => {
  const f = fixture();
  writeFileSync(join(f.agentDir, "settings.json"), "{broken");
  writeFileSync(join(f.cwd, ".pi/settings.json"), "{broken");
  const getExecutionOptions = vi.fn(() => ({ bash: { commandPrefix: "export CODEX_SETTINGS_PROBE=sdk" } }));
  const h = harness(f.cwd, "print", true, { getExecutionOptions });
  try {
    for (let i = 0; i < 3; i++) assert.equal(await h.bash('printf "%s" "$CODEX_SETTINGS_PROBE"'), "sdk");
    assert.equal(getExecutionOptions.mock.calls.length, 1);
    h.emit("session_start"); await h.bash("true"); assert.equal(getExecutionOptions.mock.calls.length, 2);
    h.ctx.cwd = f.root; await h.bash("true"); assert.equal(getExecutionOptions.mock.calls.length, 3);
  } finally { h.emit("session_shutdown"); }
  const getUnusedOptions = vi.fn(() => { throw new Error("Custom factories must not read settings"); });
  const custom = harness(f.cwd, "print", true, { getExecutionOptions: getUnusedOptions }, {
    read: createReadToolDefinition, edit: createEditToolDefinition, write: createWriteToolDefinition,
    bash: cwd => createBashToolDefinition(cwd, { commandPrefix: "export CODEX_SETTINGS_PROBE=factory" }),
  });
  try {
    assert.equal(await custom.bash('printf "%s" "$CODEX_SETTINGS_PROBE"'), "factory");
    assert.equal(getUnusedOptions.mock.calls.length, 0);
  } finally { custom.emit("session_shutdown"); }
});

test("the full UI entrypoint accepts explicit SDK execution configuration", async () => {
  const f = fixture();
  f.global({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=file" });
  const registered = new Map<string, ToolDefinition>();
  codexUi({ on() {}, registerCommand() {}, registerMarkdownTransformer() {},
    registerTool(tool: ToolDefinition) { registered.set(tool.name, tool); },
  } as unknown as ExtensionAPI, { getExecutionOptions: () => ({ bash: { commandPrefix: "export CODEX_SETTINGS_PROBE=explicit" } }) });
  const result = await registered.get("bash")!.execute("sdk", { command: 'printf "%s" "$CODEX_SETTINGS_PROBE"' },
    undefined, undefined, { cwd: f.cwd, sessionManager: SessionManager.inMemory(f.cwd) } as never);
  assert.equal(result.content[0]?.type === "text" && result.content[0].text, "explicit");
});

test("real SDK reload rejects broken file settings before execution and recovers after repair", async () => {
  const f = fixture();
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ tokensPerSecond: 100000 }); models.registerNativeProvider(faux.provider);
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network disabled"));
  const command = 'printf "%s" "${CODEX_SETTINGS_PROBE:-missing}"';
  writeFileSync(join(f.cwd, "secret.txt"), "private file contents");
  for (const scope of ["global", "project"] as const) for (const enabled of [false, true]) {
    f.global({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=global", compaction: { enabled: false } });
    f.project(scope === "project" ? { shellCommandPrefix: "export CODEX_SETTINGS_PROBE=project" } : {});
    const settingsManager = SettingsManager.create(f.cwd, f.agentDir, { projectTrusted: true });
    const loader = new DefaultResourceLoader({ cwd: f.cwd, agentDir: f.agentDir, settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: enabled ? [pi => { registerCodexTools(pi); }] : [] });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, settingsManager,
      modelRuntime: models, model: faux.getModel(), resourceLoader: loader, sessionManager: SessionManager.inMemory(f.cwd) });
    const execute = async (name: string, args: unknown) => session.agent.state.tools.find(tool => tool.name === name)!.execute("probe", args);
    try {
      await session.bindExtensions({ mode: "print" });
      assert.equal((await execute("bash", { command })).content.filter(item => item.type === "text")[0]?.text, scope);
      const path = scope === "global" ? join(f.agentDir, "settings.json") : join(f.cwd, ".pi/settings.json");
      writeFileSync(path, '{"shellCommandPrefix":"sensitive-value",broken');
      // Existing snapshots are unchanged until reload.
      assert.equal((await execute("bash", { command })).content.filter(item => item.type === "text")[0]?.text, scope);
      await session.reload();
      if (!enabled) {
        assert.equal((await execute("bash", { command })).content.filter(item => item.type === "text")[0]?.text, scope);
        continue;
      }
      executions.mockClear(); definitions.mockClear(); settingsReads.mockClear();
      const marker = join(f.cwd, "must-not-exist");
      await assert.rejects(() => execute("bash", { command: `touch '${marker}'` }), /Cannot load .* execution settings/);
      await assert.rejects(() => execute("read", { path: "secret.txt" }), /Fix the settings file.*\/reload/);
      assert(!existsSync(marker)); assert.equal(executions.mock.calls.length, 0); assert.equal(definitions.mock.calls.length, 0);
      assert.equal(settingsReads.mock.calls.length, 2);
      await execute("write", { path: "unblocked.txt", content: "old" });
      await execute("edit", { path: "unblocked.txt", edits: [{ oldText: "old", newText: "new" }] });
      faux.setResponses([
        fauxAssistantMessage({ type: "toolCall", id: "denied-settings", name: "bash", arguments: { command } }, { stopReason: "toolUse" }),
        fauxAssistantMessage("Session is still usable"),
      ]);
      await session.prompt("Exercise settings rejection");
      const result = session.messages.find(m => m.role === "toolResult");
      assert(result?.role === "toolResult" && result.isError);
      assert.match(JSON.stringify(result.content), /Cannot load .* execution settings/);
      assert.doesNotMatch(JSON.stringify(result.content), /sensitive-value|shellCommandPrefix|private file contents/);
      assert.equal(executions.mock.calls.length, 0);
      writeFileSync(path, JSON.stringify({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=repaired", compaction: { enabled: false } }));
      await assert.rejects(() => execute("bash", { command }), /Cannot load/);
      await session.reload();
      assert.equal((await execute("bash", { command })).content.filter(item => item.type === "text")[0]?.text, "repaired");
      const read = await execute("read", { path: "secret.txt" });
      assert(JSON.stringify(read.content).includes("private file contents"));
    } finally { await session.abort(); session.dispose(); }
  }
  assert.equal(network.mock.calls.length, 0);
});

test("real SDK execution matches file-configured builtins, reloads and preserves permission hooks", async () => {
  const f = fixture();
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network disabled"));
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const faux = fauxProvider({ tokensPerSecond: 100000 });
  models.registerNativeProvider(faux.provider);
  for (const enabled of [false, true]) {
    f.global({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=sdk-file", compaction: { enabled: false } });
    let calls = 0;
    const settingsManager = SettingsManager.create(f.cwd, f.agentDir, { projectTrusted: true });
    const loader = new DefaultResourceLoader({ cwd: f.cwd, agentDir: f.agentDir, settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [pi => {
        if (enabled) registerCodexTools(pi);
        pi.on("tool_call", event => { calls++; if ("command" in event.input && event.input.command === "forbidden") return { block: true, reason: "Denied by fixture" }; });
      }],
    });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, settingsManager,
      modelRuntime: models, model: faux.getModel(), resourceLoader: loader, sessionManager: SessionManager.inMemory(f.cwd) });
    try {
      await session.bindExtensions({ mode: "print" });
      const bash = () => session.agent.state.tools.find(tool => tool.name === "bash")!;
      const run = () => bash().execute("probe", { command: 'printf "%s" "$CODEX_SETTINGS_PROBE"' });
      const initial = await run();
      assert.equal(initial.content[0]?.type === "text" && initial.content[0].text, "sdk-file");
      f.global({ shellCommandPrefix: "export CODEX_SETTINGS_PROBE=reloaded", compaction: { enabled: false } });
      await session.reload();
      const reloaded = await run(); assert(reloaded.content[0]?.type === "text"); assert.equal(reloaded.content[0].text, "reloaded");
      faux.setResponses([
        fauxAssistantMessage({ type: "toolCall", id: "denied", name: "bash", arguments: { command: "forbidden" } }, { stopReason: "toolUse" }),
        fauxAssistantMessage("Done"),
      ]);
      await session.prompt("Exercise permission gate");
      assert.equal(calls, 1);
      const result = session.messages.find(message => message.role === "toolResult");
      assert(result?.role === "toolResult" && result.isError);
      assert(JSON.stringify(result.content).includes("Denied by fixture"));
    } finally { await session.abort(); session.dispose(); }
  }
  assert.equal(network.mock.calls.length, 0);
});
