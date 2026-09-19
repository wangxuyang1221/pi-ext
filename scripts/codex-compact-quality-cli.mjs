// Pinned CLI-only experiment adapter; never imported by the production extension.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isDeepStrictEqual } from "node:util";
import { spawn, execFileSync } from "node:child_process";
import { LineRpc } from "./codex-compact-quality-rpc.mjs";
import { assertRunDirectory } from "./codex-compact-quality-runner.mjs";
import { fingerprintWorkspace } from "./codex-compact-quality-tools.mjs";
import { stopProcessGroup } from "./codex-compact-quality-process.mjs";
import { usageCounts } from "./codex-compact-quality-metrics.mjs";

export async function runCliCompaction({ directory, executable, binarySha256, credentialFile,
  sourceWorkspace, expectedWorkspaceFingerprint, history, instructions, executionTimeoutMs = 300_000,
  onProcess = async () => {} }) {
  directory = path.join(assertRunDirectory(directory), "cli");
  sourceWorkspace = assertRunDirectory(sourceWorkspace);
  executable = fs.realpathSync(executable);
  assert.equal(createHash("sha256").update(fs.readFileSync(executable)).digest("hex"), binarySha256, "CLI binary fingerprint mismatch");
  assert.equal(execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim(), "codex-cli 0.154.0", "CLI executable version mismatch");
  fs.mkdirSync(directory);
  const home = path.join(directory, "codex-home"), tmp = path.join(directory, "tmp"), workspace = path.join(directory, "workspace");
  fs.mkdirSync(home); fs.mkdirSync(tmp);
  assert.deepEqual(fingerprintWorkspace(sourceWorkspace), expectedWorkspaceFingerprint, "CLI source workspace changed");
  fs.cpSync(sourceWorkspace, workspace, { recursive: true });
  assert.deepEqual(fingerprintWorkspace(workspace), expectedWorkspaceFingerprint, "CLI copied workspace changed");
  const flags = ["app-server", "--listen", "stdio://", "-c", 'model="gpt-5.6-sol"', "-c", 'model_reasoning_effort="medium"',
    "-c", "project_doc_max_bytes=0", "-c", "features.remote_compaction_v2=true", "-c", "features.token_budget=false",
    "-c", "features.code_mode=false", "-c", "features.code_mode_only=false", "-c", `log_dir=${JSON.stringify(path.join(home, "log"))}`];
  const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  save("configuration.json", { binarySha256, version: "0.154.0", flags, executionTimeoutMs, history, instructions,
    trigger: "manual-thread-compact-start", natural90PercentEvidence: false });
  let child, client, stderr, result;
  const started = performance.now();
  try {
    fs.copyFileSync(credentialFile, path.join(home, "auth.json")); fs.chmodSync(path.join(home, "auth.json"), 0o600);
    stderr = fs.openSync(path.join(directory, "stderr.log"), "wx", 0o600);
    child = spawn(executable, flags, { cwd: workspace,
      env: { ...process.env, CODEX_HOME: home, CODEX_SQLITE_HOME: home, HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp, XDG_CACHE_HOME: path.join(home, "cache"), XDG_CONFIG_HOME: path.join(home, "config"), XDG_DATA_HOME: path.join(home, "data"), XDG_STATE_HOME: path.join(home, "state") },
      detached: true, stdio: ["pipe", "pipe", stderr] });
    client = new LineRpc(child, { record: row => {
      if (!String(row.row.method ?? "").startsWith("account/")) fs.appendFileSync(path.join(directory, "rpc.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n", { mode: 0o600 });
    } });
    if (child.pid) {
      const resource = { kind: "process-group", pid: child.pid, ownerPid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), binarySha256 };
      save("process.json", resource); await onProcess(resource);
    }
    const session = await compactCliSession(client, { history, instructions, cwd: workspace, executionTimeoutMs });
    save("session.json", session);
    const archive = path.join(home, "archived_sessions");
    const files = fs.readdirSync(archive).filter(file => file.endsWith(".jsonl"));
    assert.equal(files.length, 1, "Missing or duplicate archived CLI rollout");
    const bytes = fs.readFileSync(path.join(archive, files[0]));
    const rows = bytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line));
    const checkpoint = extractCliCheckpoint(rows, { threadId: session.threadId, history, instructions });
    assert.deepEqual(fingerprintWorkspace(workspace), expectedWorkspaceFingerprint, "CLI compaction changed the workspace");
    result = { ...checkpoint, threadId: session.threadId, binarySha256,
      compactionElapsedMs: session.compactionElapsedMs, executionElapsedMs: performance.now() - started,
      rolloutSha256: createHash("sha256").update(bytes).digest("hex"), natural90PercentEvidence: false };
    save("checkpoint.json", result);
  } catch (error) {
    save("failure.json", { name: String(error.name), message: String(error.message), at: new Date().toISOString() });
    throw error;
  } finally {
    try {
      if (child?.pid) save("cleanup.json", await stopProcessGroup(child));
    } catch (error) {
      save("cleanup-failure.json", { message: String(error.message), at: new Date().toISOString() });
      throw error;
    } finally {
      client?.dispose();
      if (stderr !== undefined) fs.closeSync(stderr);
      fs.rmSync(path.join(home, "auth.json"), { force: true });
    }
  }
  save("result.json", result);
  return result;
}

export async function compactCliSession(client, { history, instructions, cwd, executionTimeoutMs = 300_000 }) {
  assert.ok(Number.isSafeInteger(executionTimeoutMs) && executionTimeoutMs > 0, "Invalid CLI execution deadline");
  const deadline = performance.now() + executionTimeoutMs;
  const remaining = () => {
    const milliseconds = Math.ceil(deadline - performance.now());
    if (milliseconds <= 0) throw new Error("CLI compaction execution deadline exceeded");
    return milliseconds;
  };
  await client.request("initialize", { clientInfo: { name: "codex_compact_quality", version: "1" }, capabilities: { experimentalApi: true } }, remaining());
  client.send({ method: "initialized", params: {} });
  const resumed = await client.request("thread/resume", { threadId: randomUUID(), history,
    model: "gpt-5.6-sol", cwd, sandbox: "read-only", approvalPolicy: "never",
    baseInstructions: instructions, developerInstructions: "", config: { model_reasoning_effort: "medium" } }, remaining());
  assert.equal(resumed.model, "gpt-5.6-sol", "CLI resumed model mismatch");
  assert.equal(resumed.reasoningEffort, "medium", "CLI resumed reasoning mismatch");
  const threadId = resumed.thread.id;
  assert.ok(typeof threadId === "string" && threadId.length > 0, "Missing CLI thread ID");
  const cursor = client.events.length;
  const started = performance.now();
  await client.request("thread/compact/start", { threadId }, remaining());
  const terminal = event => event.params?.threadId === threadId && (
    (event.method === "item/completed" && event.params?.item?.type === "contextCompaction") ||
    (event.method === "error" && event.params?.willRetry !== true) ||
    (event.method === "turn/completed" && event.params?.turn?.status === "failed")
  );
  let completion;
  while (!completion) {
    try { completion = await client.waitFor(terminal, cursor, Math.min(30_000, remaining())); }
    catch (error) {
      if (error.message !== "RPC notification wait timed out; process state is unchanged") throw error;
      remaining();
    }
  }
  assert.equal(completion?.method, "item/completed", "CLI compaction failed");
  const compactionElapsedMs = performance.now() - started;
  await client.request("thread/archive", { threadId }, remaining());
  return { threadId, resumed, completion, compactionElapsedMs };
}

export function extractCliCheckpoint(rows, { threadId, history, instructions }) {
  const metadata = rows.filter(row => row.type === "session_meta");
  assert.equal(metadata.length, 1, "Missing or duplicate CLI session metadata");
  assert.equal(metadata[0].payload.id, threadId, "CLI thread mismatch");
  assert.equal(metadata[0].payload.cli_version, "0.154.0", "CLI version mismatch");
  assert.equal(metadata[0].payload.base_instructions.text, instructions, "CLI instructions mismatch");
  const compactions = rows.filter(row => row.type === "compacted");
  assert.equal(compactions.length, 1, "Missing or duplicate CLI compaction");
  const compact = compactions[0].payload;
  const imported = rows.slice(0, rows.indexOf(compactions[0])).filter(row => row.type === "response_item").map(row => row.payload);
  assert.equal(imported.length, history.length, "CLI imported history length mismatch");
  const importNormalizations = [];
  imported.forEach((item, index) => {
    const actual = structuredClone(item), expected = structuredClone(history[index]);
    if (!Object.hasOwn(expected, "id")) delete actual.id;
    // Codex 0.154.0 models.rs omits these empty or completed wire-only fields.
    // Do not normalize nonempty evidence, unknown metadata, or provider payloads.
    if (expected.type === "reasoning" && !Object.hasOwn(actual, "content") && Array.isArray(expected.content) && expected.content.length === 0) {
      delete expected.content; importNormalizations.push({ index, field: "content", reason: "empty-reasoning-content" });
    }
    if (["message", "function_call"].includes(expected.type) && !Object.hasOwn(actual, "status") && expected.status === "completed") {
      delete expected.status; importNormalizations.push({ index, field: "status", reason: "completed-wire-status" });
    }
    if (expected.type === "message" && Array.isArray(expected.content) && Array.isArray(actual.content)) {
      expected.content.forEach((part, position) => {
        if (part.type !== "output_text" || actual.content[position]?.type !== "output_text") return;
        for (const field of ["annotations", "logprobs"]) if (!Object.hasOwn(actual.content[position], field) && Array.isArray(part[field]) && part[field].length === 0) {
          delete part[field]; importNormalizations.push({ index, field: `content[${position}].${field}`, reason: "empty-output-metadata" });
        }
      });
    }
    // A failed assertion must not copy opaque checkpoints or private history into logs.
    assert.ok(isDeepStrictEqual(actual, expected), `CLI imported history mismatch at item ${index}`);
  });
  assert.ok(Array.isArray(compact.replacement_history) && compact.replacement_history.some(item => item.type === "compaction" && typeof item.encrypted_content === "string" && item.encrypted_content.length > 0), "Missing native compaction payload");
  assert.ok(typeof compact.compaction_response_id === "string" && compact.compaction_response_id.length > 0, "Missing CLI response provenance");
  assert.equal(compact.latest_token_usage_record.thread_id, threadId, "CLI usage thread mismatch");
  assert.equal(compact.latest_token_usage_record.response_id, compact.compaction_response_id, "CLI usage response mismatch");
  return { source: "actual-codex-cli-0.154.0", importNormalizations, replacementHistory: compact.replacement_history,
    usage: usageCounts(compact.latest_token_usage_record.usage, "codex-record") };
}
