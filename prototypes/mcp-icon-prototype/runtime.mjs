import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { VARIANTS, variantTheme } from "./variant.mjs";
import { NATIVE_FIXTURES, seedNativeFixtures, wrapNativeTool } from "./native-fixtures.mjs";

const root = process.env.MCP_ICON_ROOT;
if (!root) throw new Error("Start this prototype through demo.mjs.");
const production = process.env.MCP_ICON_PRODUCTION === "1";
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network is disabled in this prototype."); };
const sdk = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");
const { default: codexUi } = await import(pathToFileURL(join(root, "runtime/codex-ui/index.js")));
const mcp = await import(pathToFileURL(join(root, "runtime/mcp/renderers.js")));
const workspace = join(root, "workspace");
const text = value => ({ content: [{ type: "text", text: value }], details: {} });
const fixtures = [
  { serverName: "exa", toolName: "web_search_exa", args: { query: "terminal tool icons" },
    output: "Found 2 results\n1. Terminal UI conventions\n2. Tool status indicators\nSource: offline fixture\nNo external requests were made.\nSearch and non-search calls use the same icon.\nExpanded fixture detail: compare the title alignment." },
  { serverName: "chrome-devtools", toolName: "list_pages", args: {},
    output: "1: Prototype preview — https://example.test/\n2: Documentation — https://example.test/docs" },
  { serverName: "MultiFetch", toolName: "fetch_json", args: { url: "https://example.test/unavailable" },
    error: "Fixture failure: the requested resource is unavailable." },
];
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: 400, tokenSize: { min: 4, max: 4 } });
const modelRuntime = await sdk.ModelRuntime.create({
  credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(),
  modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
});
modelRuntime.registerNativeProvider(faux.provider);
let serial = 0;
let launching = false;
const plans = new Map();
const instructions = (production ? "MCP production verification" : "MCP icon prototype")
  + " · ⌁ beside @ Read, $ Bash, and ~ Edit/Write\n\n/icons replays ⌁. "
  + (production ? "Production renderers are used without icon or color overrides." : "/icons command compares the earlier ⌘ candidate.")
  + "\nCtrl+O expands results. /quit exits. No MCP servers or shell commands run.\nFile tools use a disposable workspace. MCP prefixes: yellow running, gray success, red failure.";

const extension = pi => {
  // Preserve native renderers and file execution, but only for fixed isolated fixtures.
  codexUi(new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return tool => pi.registerTool(wrapNativeTool(tool, { plans, workspace }));
    return Reflect.get(target, key);
  } }));
  for (const variant of production ? ["wave"] : Object.keys(VARIANTS)) {
    for (const [index, fixture] of fixtures.entries()) {
      const name = `fixture_mcp_${variant}_${index}`;
      pi.registerTool({
        name, label: name, description: "Offline MCP icon comparison fixture", executionMode: "parallel", renderShell: "self",
        parameters: { type: "object", properties: { query: { type: "string" }, url: { type: "string" } }, additionalProperties: false },
        async execute(id, args, signal, onUpdate, ctx) {
          assert.equal(plans.get(id), name, "Only scripted fixture calls may execute");
          assert.deepEqual(args, fixture.args);
          assert.equal(ctx.cwd, workspace);
          await delay(500, undefined, { signal });
          onUpdate?.(text("Preparing offline fixture result..."));
          await delay(800 + index * 250, undefined, { signal });
          if (fixture.error) throw new Error(fixture.error);
          return text(fixture.output);
        },
        renderCall: (args, theme, context) => mcp.renderMcpToolCall(args, fixture, production ? theme : variantTheme(theme, variant), context),
        renderResult: (result, options, theme, context) => mcp.renderMcpToolResult(result, options, theme, context),
      });
    }
  }
  pi.registerCommand("icons", {
    description: "Compare MCP with native tools: wave (default), command, chevron, 3, 4, or both",
    handler: async (args, ctx) => {
      const choice = args.trim() || "wave";
      if (![...Object.keys(VARIANTS), "both"].includes(choice)) { ctx.ui.notify("Use /icons, /icons command, /icons chevron, /icons 3, /icons 4, or /icons both", "info"); return; }
      if (production && choice !== "wave") { ctx.ui.notify("Production mode only supports /icons or /icons wave.", "info"); return; }
      if (launching || !ctx.isIdle()) { ctx.ui.notify("Wait for playback to finish, or press Escape.", "info"); return; }
      launching = true;
      try {
        plans.clear();
        await seedNativeFixtures(workspace);
        const makeCall = (name, args) => {
          const id = `mcp-icon-${++serial}`;
          plans.set(id, name);
          return { type: "toolCall", id, name, arguments: structuredClone(args) };
        };
        const nativeCall = name => makeCall(name, NATIVE_FIXTURES[name].args);
        const variants = choice === "both" ? ["3", "4"] : [choice];
        const responses = variants.map((variant, index) => {
          const calls = fixtures.map((fixture, index) => makeCall(`fixture_mcp_${variant}_${index}`, fixture.args));
          const mixed = index === 0 ? [nativeCall("read"), calls[0], nativeCall("bash"),
            nativeCall("edit"), calls[1], nativeCall("write"), calls[2]] : calls;
          return ai.fauxAssistantMessage([
            { type: "text", text: `Variant ${variant}: ${VARIANTS[variant]}` }, ...mixed,
          ], { stopReason: "toolUse" });
        });
        faux.setResponses([...responses, ai.fauxAssistantMessage("Comparison complete. Use /icons to replay ⌁ with native tools.")]);
        pi.sendUserMessage(`Compare MCP icon ${choice}.`);
      } finally { launching = false; }
    },
  });
  pi.on("session_start", (_event, ctx) => ctx.ui.setToolsExpanded(false));
  pi.on("input", event => event.source === "extension" ? { action: "continue" } : { action: "handled" });
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this prototype.", exitCode: 0, cancelled: false, truncated: false } }));
  pi.on("session_before_compact", () => ({ cancel: true }));
};
const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ quietStartup: true, theme: "codex-pi", retry: { enabled: false }, compaction: { enabled: false }, terminal: { showImages: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalThemePaths: [join(root, "runtime/codex-pi.json")], systemPromptOverride: () => "Offline MCP icon fixture", extensionFactories: [extension] },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: "builtin" }), services, diagnostics: services.diagnostics };
};
const sessionManager = sdk.SessionManager.create(workspace, join(root, "sessions"));
sessionManager.appendMessage({ role: "user", content: "Preview the MCP icon in real tool calls.", timestamp: Date.now() });
sessionManager.appendMessage({ ...ai.fauxAssistantMessage(instructions), timestamp: Date.now() });
const runtime = await sdk.createAgentSessionRuntime(create, { cwd: workspace, agentDir: join(root, "agent"), sessionManager });
try {
  await new sdk.InteractiveMode(runtime, {
    migratedProviders: [], initialMessage: `/icons ${process.env.MCP_ICON_VARIANT || "wave"}`,
    tuiMode: process.env.MCP_ICON_FULLSCREEN === "1" ? "fullscreen" : "regular",
  }).run();
} finally {
  await runtime.dispose();
  assert.equal(networkAttempts, 0, "The prototype must not attempt network access");
}
