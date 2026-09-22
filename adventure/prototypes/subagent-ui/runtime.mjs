import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture, KINDS, OUTCOMES } from "./fixtures.mjs";
import { STYLES, LABELS, resultTheme } from "./styles.mjs";

const root = process.env.SUBAGENT_UI_ROOT;
if (!root) throw new Error("Start with demo.mjs");
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network is disabled in this prototype"); };
const sdk = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");
const codexUi = (await import(pathToFileURL(join(root, "runtime/codex-ui/index.js")))).default;
const renderer = await import(pathToFileURL(join(root, "runtime/after/renderers.js")));
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: 1200, tokenSize: { min: 8, max: 8 } });
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const plans = new Map();
const waiting = new Map();
let serial = 0;
let active = false;
let style = STYLES.find(value => process.argv.includes(`--${value}`)) ?? "after";
const instructions = "Approved subagent UI\n/after: replay six messages with Read and Bash\n/demo all|spawn|prompt|list|read|wait|close success|error|hold\n/demo wait timeout · /demo wait interrupted · /demo spawn success after long\n/finish success|error|timeout|interrupted\nCtrl+O: expand/collapse · /quit: exit";
function release(outcome = "interrupted") { for (const finish of [...waiting.values()]) finish(outcome); }
const extension = pi => {
  const execute = async (id, args, signal) => {
    const plan = plans.get(id);
    assert.ok(plan, "Only scripted fixture calls may execute");
    let outcome = plan.outcome;
    if (outcome === "hold") outcome = await new Promise(done => {
      const finish = value => { waiting.delete(id); signal?.removeEventListener("abort", abort); done(value); };
      const abort = () => finish("interrupted");
      if (signal?.aborted) return finish("interrupted");
      waiting.set(id, finish); signal?.addEventListener("abort", abort, { once: true });
    });
    if (plan.context) return { content: [{ type: "text", text: plan.context === "read" ? "export const toolStyle = 'codex';\nexport const compact = true;" : "Renderer checks passed.\n6 tool messages verified." }], details: {} };
    return fixture(plan.kind, outcome, plan.long).result;
  };
  const proxy = new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return tool => pi.registerTool({ ...tool, executionMode: "parallel", execute });
    return Reflect.get(target, key);
  } });
  codexUi(proxy);
  for (const kind of KINDS) {
    pi.registerTool({ name: `subagent_${kind}`, label: `Subagent ${kind}`, description: "Offline visual fixture", parameters: { type: "object", additionalProperties: true }, executionMode: "parallel", renderShell: "self", execute,
      renderCall: (args, theme, context) => renderer.renderSubagentCall(kind, args, theme, context),
      renderResult: (result, options, theme, context) => {
        return renderer.renderSubagentResult(kind, context.args, result, options, resultTheme(theme), context);
      },
    });
  }
  const start = (args, ctx) => {
    if (active || !ctx.isIdle()) return ctx.ui.notify("Finish the current scenario with /finish success.", "info");
    const [kind = "all", outcome = "success", requestedStyle = style, length] = args.trim().split(/\s+/).filter(Boolean);
    if ((kind !== "all" && !KINDS.includes(kind)) || !OUTCOMES.includes(outcome) || !STYLES.includes(requestedStyle)) return ctx.ui.notify(instructions, "info");
    if (["timeout", "interrupted"].includes(outcome) && kind !== "wait") return ctx.ui.notify("Use /demo wait timeout or /demo wait interrupted.", "info");
    style = requestedStyle;
    const batch = kind === "all" ? [{ context: "read", args: { path: "src/tool-style.ts" } }, { context: "bash", args: { command: "pnpm run check" } }] : [];
    for (const item of kind === "all" ? KINDS : [kind]) batch.push({ kind: item, args: fixture(item, outcome, length === "long").args, outcome, style, long: length === "long" });
    const blocks = batch.map(plan => {
      const id = `ui-${++serial}`;
      plans.set(id, plan);
      return { type: "toolCall", id, name: plan.context ?? `subagent_${plan.kind}`, arguments: plan.args };
    });
    active = true;
    faux.setResponses([ai.fauxAssistantMessage(blocks, { stopReason: "toolUse" }), ai.fauxAssistantMessage(`Comparison ready: ${requestedStyle} / ${kind} / ${outcome}.`)]);
    pi.sendUserMessage(`${LABELS[requestedStyle]}: ${kind} / ${outcome}`);
  };
  pi.registerCommand("demo", { description: "Show a fixture scenario", handler: start });
  for (const variant of STYLES) pi.registerCommand(variant, { description: `Show ${variant} fixtures`, handler: (_args, ctx) => start(`all success ${variant}`, ctx) });
  pi.registerCommand("finish", { description: "Finish held tools", handler: (args, ctx) => {
    const outcome = args.trim() || "success";
    if (!["success", "error", "timeout", "interrupted"].includes(outcome)) return ctx.ui.notify("Use /finish success|error|timeout|interrupted", "info");
    release(outcome);
  } });
  pi.registerCommand("guide", { description: "Show controls", handler: (_args, ctx) => ctx.ui.notify(instructions, "info") });
  pi.on("agent_settled", () => { active = false; });
  pi.on("session_start", (_event, ctx) => ctx.ui.setToolsExpanded(process.argv.includes("--expanded")));
  pi.on("input", event => event.source === "extension" ? { action: "continue" } : { action: "handled" });
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this prototype.", exitCode: 0, cancelled: false, truncated: false } }));
  pi.on("session_before_compact", () => ({ cancel: true }));
  pi.on("session_shutdown", () => release());
};
const workspace = join(root, "workspace");
const sessions = sdk.SessionManager.create(workspace, join(root, "sessions"));
sessions.appendMessage({ role: "user", content: "Compare subagent messages with the surrounding codex-ui tools.", timestamp: Date.now() });
sessions.appendMessage({ ...ai.fauxAssistantMessage(instructions), timestamp: Date.now() });
const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ quietStartup: true, theme: "codex-pi", retry: { enabled: false }, compaction: { enabled: false }, terminal: { showImages: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalThemePaths: [join(root, "runtime/codex-pi.json")], systemPromptOverride: () => "Offline subagent UI fixture", extensionFactories: [extension] },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: "builtin" }), services, diagnostics: services.diagnostics };
};
const runtime = await sdk.createAgentSessionRuntime(create, { cwd: workspace, agentDir: join(root, "agent"), sessionManager: sessions });
try {
  await new sdk.InteractiveMode(runtime, { migratedProviders: [], initialMessage: `/demo all success ${style}`, tuiMode: process.argv.includes("--fullscreen") ? "fullscreen" : "regular" }).run();
} finally {
  release(); await runtime.session.abort(); runtime.session.dispose();
  assert.equal(networkAttempts, 0, "The prototype must not attempt network access");
}
