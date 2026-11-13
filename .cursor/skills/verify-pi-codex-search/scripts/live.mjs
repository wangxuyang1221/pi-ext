#!/usr/bin/env node
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const [rootArg, consent] = process.argv.slice(2);
assert.equal(consent, "--authorized-live", "Pass --authorized-live only after obtaining account and usage authorization");
assert(rootArg && !existsSync(rootArg), "Use a new evidence directory");
const root = resolve(rootArg);
assert(realpathSync(dirname(root)).startsWith(realpathSync(join(repo, ".tmp")) + sep), "Use a worktree .tmp directory");
assert(process.env.LIVE_VERIFY_STATE, "Set LIVE_VERIFY_STATE to the shared request ledger");
const originalHome = homedir();
mkdirSync(root);
const scratch = join(root, "runtime");
for (const path of ["home/.pi", "agent", "workspace", "tmp", "sessions"]) mkdirSync(join(scratch, path), { recursive: true });
const secretValues = new Set();
let session, runtime, reader, active;
const summary = { pid: process.pid, root, model: "gpt-5.6-sol", cases: [], cleanup: "pending" };
const interrupt = () => { summary.interrupted = true; process.exitCode = 1; active?.abort(); reader?.close(); };
process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
const sanitize = value => {
  let text = JSON.stringify(value);
  for (const secret of secretValues) if (secret.length > 3) text = text.replaceAll(secret, "[REDACTED]");
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]");
};
const collectSecrets = value => {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && /access|refresh|token|key|account|email|user.*id/i.test(key)) secretValues.add(item);
    else if (typeof item === "object") collectSecrets(item);
  }
};
try {
  const original = JSON.parse(readFileSync(join(originalHome, ".pi/agent/auth.json"), "utf8"));
  assert(original["openai-codex"], "Existing Codex authorization is required");
  collectSecrets(original["openai-codex"]);
  const token = original["openai-codex"].access;
  if (token) { try { collectSecrets(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())); } catch {} }
  writeFileSync(join(scratch, "agent/auth.json"), JSON.stringify({ "openai-codex": original["openai-codex"] }), { mode: 0o600 });
  for (const key of Object.keys(process.env)) if (!['PATH','LANG','LC_ALL','TZ','LIVE_VERIFY_STATE'].includes(key)) delete process.env[key];
  Object.assign(process.env, { HOME: join(scratch, "home"), TMPDIR: join(scratch, "tmp"),
    PI_CODING_AGENT_DIR: join(scratch, "agent"), PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" });
  const config = { enabled: true, standaloneEnabled: true, model: summary.model, freshness: "live", searchContextSize: "medium" };
  writeFileSync(join(scratch, "home/.pi/pi-codex-search.json"), JSON.stringify(config));
  writeFileSync(join(root, "settings.json"), JSON.stringify(config, null, 2));
  await import("./live-network.mjs");
  const { ModelRuntime, SessionManager, SettingsManager, DefaultResourceLoader, createAgentSession } = await import("@earendil-works/pi-coding-agent");
  const { InMemoryModelsStore } = await import("@earendil-works/pi-ai");
  runtime = await ModelRuntime.create({ authPath: join(scratch, "agent/auth.json"), modelsPath: null,
    modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
  const model = runtime.getModel("openai-codex", summary.model);
  assert(model, "Acceptance model unavailable");
  const manager = SessionManager.create(join(scratch, "workspace"), join(scratch, "sessions"));
  const settings = SettingsManager.inMemory({ transport: "sse", retry: { enabled: false, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: "off" });
  let context;
  const loader = new DefaultResourceLoader({ cwd: join(scratch, "workspace"), agentDir: join(scratch, "agent"), settingsManager: settings,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    additionalExtensionPaths: [join(repo, "extensions/codex-search/src/index.ts")],
    extensionFactories: [pi => { pi.on("session_start", (_event, ctx) => { context = ctx; }); }] });
  await loader.reload();
  ({ session } = await createAgentSession({ cwd: join(scratch, "workspace"), agentDir: join(scratch, "agent"), modelRuntime: runtime,
    model, resourceLoader: loader, sessionManager: manager, settingsManager: settings }));
  await session.bindExtensions({ onError: error => { throw new Error(sanitize({ error: String(error) })); } });
  console.log(JSON.stringify({ ready: true, root, pid: process.pid, tools: session.getActiveToolNames().filter(x => x.startsWith("codex_")) }));
  reader = createInterface({ input: process.stdin, terminal: false });
  for await (const line of reader) {
    const command = JSON.parse(line);
    if (command.quit) break;
    assert(/^[a-z0-9-]+$/.test(command.label), "Use a unique lowercase case label");
    const path = join(root, command.label + ".json");
    assert(!existsSync(path), "Do not overwrite evidence");
    assert(["codex_search", "codex_standalone_web"].includes(command.tool));
    const started = new Date().toISOString();
    let outcome;
    try {
      const tool = session.getToolDefinition(command.tool);
      assert(tool, "Production tool was not registered");
      active = new AbortController();
      const result = await tool.execute(`live-${command.label}`, command.args, AbortSignal.any([active.signal, AbortSignal.timeout(120000)]), undefined, context);
      outcome = { result, toolSucceeded: !result.isError };
    } catch (error) { outcome = { toolSucceeded: false, error: String(error) }; }
    writeFileSync(path, sanitize({ ...command, started, finished: new Date().toISOString(), ...outcome }) + "\n");
    const entry = { label: command.label, toolSucceeded: outcome.toolSucceeded, evidence: path };
    summary.cases.push(entry);
    console.log(JSON.stringify(entry));
    if (summary.interrupted) break;
  }
} catch (error) {
  summary.failure = sanitize({ error: String(error) });
  process.exitCode = 1;
} finally {
  reader?.close();
  try {
    if (session) {
      await session.abort(); await session.waitForIdle();
      await session.extensionRunner?.emit({ type: "session_shutdown", reason: "exit" });
      session.dispose();
    }
    if (existsSync(join(scratch, "sessions"))) cpSync(join(scratch, "sessions"), join(root, "sessions"), { recursive: true });
  } catch (error) {
    summary.cleanupError = sanitize({ error: String(error) });
    process.exitCode = 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  summary.cleanup = "removed";
  summary.credentialsRemoved = !existsSync(join(scratch, "agent/auth.json"));
  writeFileSync(join(root, "summary.json"), sanitize(summary) + "\n");
  process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  console.log(JSON.stringify({ summary: join(root, "summary.json"), cleanup: summary.cleanup, credentialsRemoved: summary.credentialsRemoved }));
}
