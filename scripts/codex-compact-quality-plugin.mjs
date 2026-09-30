// Isolated, instrumented calls to frozen plugin code for fixed-boundary evaluation.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL, fileURLToPath } from "node:url";
import { assertRunDirectory } from "./codex-compact-quality-runner.mjs";
import { fingerprintWorkspace } from "./codex-compact-quality-tools.mjs";
import { stopProcessGroup } from "./codex-compact-quality-process.mjs";
import { usageCounts } from "./codex-compact-quality-metrics.mjs";
import { inspectPiHost, piVersion as installedPiVersion } from "./pi-host.mjs";

const save = (directory, name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const hash = value => createHash("sha256").update(value).digest("hex");

export async function runPluginCompaction({ directory, moduleDirectory, expectedModuleFingerprint,
  sourceWorkspace, expectedWorkspaceFingerprint, credentialFile, history, instructions,
  expectedPiVersion = "0.87.0", executionTimeoutMs = 300_000, onProcess = async () => {} }) {
  assert.ok(Number.isSafeInteger(executionTimeoutMs) && executionTimeoutMs > 0, "Invalid plugin execution deadline");
  directory = path.join(assertRunDirectory(directory), "plugin");
  moduleDirectory = assertRunDirectory(moduleDirectory);
  sourceWorkspace = assertRunDirectory(sourceWorkspace);
  assert.deepEqual(fingerprintWorkspace(moduleDirectory), expectedModuleFingerprint, "Plugin module fingerprint mismatch");
  assert.deepEqual(fingerprintWorkspace(sourceWorkspace), expectedWorkspaceFingerprint, "Plugin source workspace changed");
  fs.mkdirSync(directory);
  const home = path.join(directory, "pi-home"), tmp = path.join(directory, "tmp"), workspace = path.join(directory, "workspace");
  fs.mkdirSync(home); fs.mkdirSync(tmp);
  fs.cpSync(sourceWorkspace, workspace, { recursive: true });
  assert.deepEqual(fingerprintWorkspace(workspace), expectedWorkspaceFingerprint, "Plugin copied workspace changed");
  const configuration = { directory, home, workspace, moduleDirectory, expectedModuleFingerprint, expectedWorkspaceFingerprint,
    history, instructions, executionTimeoutMs, model: "gpt-5.6-sol", effort: "medium", piVersion: expectedPiVersion,
    runtime: inspectPiHost(undefined, installedPiVersion), natural90PercentEvidence: false };
  save(directory, "configuration.json", configuration);
  let child, stdout, stderr, result;
  const started = performance.now();
  try {
    fs.copyFileSync(credentialFile, path.join(home, "auth.json")); fs.chmodSync(path.join(home, "auth.json"), 0o600);
    stdout = fs.openSync(path.join(directory, "stdout.log"), "wx", 0o600);
    stderr = fs.openSync(path.join(directory, "stderr.log"), "wx", 0o600);
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", path.join(directory, "configuration.json")], {
      cwd: process.cwd(), detached: true, stdio: ["ignore", stdout, stderr],
      env: { ...process.env, PI_CODING_AGENT_DIR: home, HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp,
        XDG_CACHE_HOME: path.join(home, "cache"), XDG_CONFIG_HOME: path.join(home, "config"), XDG_DATA_HOME: path.join(home, "data"), XDG_STATE_HOME: path.join(home, "state") }
    });
    const exited = once(child, "exit", { signal: AbortSignal.timeout(executionTimeoutMs) });
    // Attach a handler before a caller's asynchronous resource registration.
    void exited.catch(() => {});
    if (child.pid) {
      const resource = { kind: "process-group", pid: child.pid, ownerPid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString() };
      save(directory, "process.json", resource); await onProcess(resource);
    }
    const [code, signal] = await exited;
    assert.equal(code, 0, `Plugin worker failed: ${code ?? signal}`);
    result = JSON.parse(fs.readFileSync(path.join(directory, "worker-result.json"), "utf8"));
    assert.equal(result.piVersion, expectedPiVersion, "Plugin runtime version mismatch");
    assert.equal(result.inputHistorySha256, hash(JSON.stringify(history)), "Plugin history fingerprint mismatch");
    assert.deepEqual(fingerprintWorkspace(workspace), expectedWorkspaceFingerprint, "Plugin compaction changed workspace");
    result.executionElapsedMs = performance.now() - started;
  } catch (error) {
    const workerFile = path.join(directory, "worker-failure.json");
    save(directory, "failure.json", { name: String(error.name), message: String(error.message),
      workerFailure: fs.existsSync(workerFile) ? JSON.parse(fs.readFileSync(workerFile, "utf8")) : null });
    throw error;
  } finally {
    try {
      if (child?.pid) save(directory, "cleanup.json", await stopProcessGroup(child));
    } catch (error) { save(directory, "cleanup-failure.json", { message: String(error.message) }); throw error; }
    finally {
      if (stdout !== undefined) fs.closeSync(stdout);
      if (stderr !== undefined) fs.closeSync(stderr);
      fs.rmSync(path.join(home, "auth.json"), { force: true });
    }
  }
  save(directory, "result.json", result);
  return result;
}

async function worker(configurationFile) {
  const config = JSON.parse(fs.readFileSync(configurationFile, "utf8"));
  const directory = assertRunDirectory(config.directory);
  const moduleDirectory = assertRunDirectory(config.moduleDirectory);
  assert.deepEqual(fingerprintWorkspace(moduleDirectory), config.expectedModuleFingerprint, "Worker plugin fingerprint mismatch");
  assert.deepEqual(fingerprintWorkspace(config.workspace), config.expectedWorkspaceFingerprint, "Worker workspace fingerprint mismatch");
  const host = inspectPiHost(undefined, config.piVersion);
  const piVersion = host.versions["pi-coding-agent"];
  const { ModelRuntime, ModelRegistry } = await import("@earendil-works/pi-coding-agent");
  const runtime = await ModelRuntime.create({ authPath: path.join(config.home, "auth.json"), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false, signal: AbortSignal.timeout(config.executionTimeoutMs) });
  const registry = new ModelRegistry(runtime);
  const model = runtime.getModel("openai-codex", "gpt-5.6-sol");
  assert.ok(model, "Required plugin model is unavailable");
  assert.equal(model.contextWindow, 272000, "Unexpected model context window");
  assert.equal(model.api, "openai-codex-responses", "Unexpected plugin model API");
  save(directory, "model.json", { id: model.id, provider: model.provider, api: model.api, contextWindow: model.contextWindow, cost: model.cost });
  const entry = await import(pathToFileURL(path.join(moduleDirectory, "remote-compaction.js")).href);
  const originalFetch = globalThis.fetch;
  const requests = [], captures = [];
  // Observe only compaction transport in this child. Never capture auth headers or OAuth exchanges.
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.endsWith("/codex/responses") || typeof options?.body !== "string") return originalFetch(input, options);
    const body = JSON.parse(options.body);
    assert.equal(body.model, config.model, "Observed compaction model mismatch");
    assert.equal(body.reasoning?.effort, config.effort, "Observed compaction reasoning mismatch");
    assert.equal(body.instructions, config.instructions, "Observed compaction instructions mismatch");
    const index = requests.length, started = performance.now();
    const observation = { index, url: url.origin + url.pathname, responseRecorded: false };
    requests.push(observation);
    save(directory, `request-${index}.json`, { url: observation.url, body });
    try {
      const response = await originalFetch(input, options);
      observation.status = response.status;
      const capture = response.clone().text().then(text => {
        fs.writeFileSync(path.join(directory, `response-${index}.sse`), text, { flag: "wx", mode: 0o600 });
        observation.responseRecorded = true;
      }).catch(error => { observation.error = String(error.message); }).finally(() => { observation.elapsedMs = performance.now() - started; });
      captures.push(capture);
      return response;
    } catch (error) { observation.error = String(error.message); observation.elapsedMs = performance.now() - started; throw error; }
  };
  try {
    const sessionId = randomUUID();
    const ctx = { model, thinkingLevel: "medium", cwd: config.workspace, isProjectTrusted: () => false,
      modelRegistry: registry, sessionManager: { getSessionId: () => sessionId }, getSystemPrompt: () => config.instructions };
    const started = performance.now();
    const checkpoint = await entry.createNativeCheckpoint({ ctx, model, input: structuredClone(config.history), allTools: [], activeToolNames: [], signal: AbortSignal.timeout(config.executionTimeoutMs) });
    const compactionElapsedMs = performance.now() - started;
    await Promise.all(captures);
    save(directory, "transport.json", requests);
    assert.ok(requests.some(request => request.status >= 200 && request.status < 300 && request.responseRecorded), "Missing successful compaction transport evidence");
    assert.equal(checkpoint.details.kind, "openai-codex-native-compaction", "Unexpected checkpoint kind");
    assert.equal(checkpoint.details.version, 2, "Unexpected checkpoint version");
    assert.equal(checkpoint.details.modelKey, "openai-codex:openai-codex-responses:gpt-5.6-sol", "Checkpoint model mismatch");
    assert.ok(checkpoint.details.replacementHistory.some(item => item.type === "compaction" && typeof item.encrypted_content === "string" && item.encrypted_content.length > 0), "Missing plugin compaction payload");
    save(directory, "worker-result.json", { piVersion, runtime: host, source: "frozen-plugin-native-entry", model: config.model, effort: config.effort,
      inputHistorySha256: hash(JSON.stringify(config.history)), replacementHistory: checkpoint.details.replacementHistory,
      usage: checkpoint.usage ? usageCounts(checkpoint.usage, "pi") : null, requestCount: requests.length,
      compactionElapsedMs, natural90PercentEvidence: false });
  } catch (error) {
    await Promise.all(captures);
    if (!fs.existsSync(path.join(directory, "transport.json"))) save(directory, "transport.json", requests);
    save(directory, "worker-failure.json", { name: String(error.name), message: String(error.message), requestCount: requests.length });
    throw error;
  } finally { globalThis.fetch = originalFetch; }
}

if (process.argv[2] === "--worker" && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  worker(process.argv[3]).catch(error => { console.error(String(error.message)); process.exitCode = 1; });
}
