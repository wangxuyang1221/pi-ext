// Fixed-boundary paired experiment orchestration. Native scheduling is a separate track.
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeSchedule, makeRetrySchedule, runSchedule, assertRunDirectory } from "./codex-compact-quality-runner.mjs";
import { continuationTools, creationContinuationTools, validateCreatePaths, fingerprintWorkspace } from "./codex-compact-quality-tools.mjs";
import { runPluginCompaction } from "./codex-compact-quality-plugin.mjs";
import { runCliCompaction } from "./codex-compact-quality-cli.mjs";
import { runContinuation } from "./codex-compact-quality-continuation.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const defaults = { plugin: runPluginCompaction, cli: runCliCompaction, continuation: runContinuation };

export async function runFixedBoundary({ directory, specification, credentials, send, adapters = defaults,
  shouldStop, onProcess, requestTimeoutMs = 300_000, retry }) {
  directory = assertRunDirectory(directory);
  const config = structuredClone(specification);
  assert.equal(config.model, "gpt-5.6-sol", "Unsupported fixed-boundary model");
  assert.equal(config.effort, "medium", "Unsupported fixed-boundary effort");
  const chained = config.compactionCycles !== undefined;
  const tracks = chained ? ["development-compaction-chain", "pilot-compaction-chain", "holdout-compaction-chain"]
    : ["development-fixed-boundary", "pilot-fixed-boundary", "holdout-fixed-boundary"];
  assert.ok(tracks.includes(config.track), "Fixed-boundary adapter cannot represent native scheduling or an unlabelled compaction chain");
  assert.ok(Number.isSafeInteger(requestTimeoutMs) && requestTimeoutMs > 0, "Invalid request deadline");
  for (const arm of ["old", "new"]) {
    const plugin = config.plugins[arm];
    plugin.directory = assertRunDirectory(plugin.directory);
    assert.deepEqual(fingerprintWorkspace(plugin.directory), plugin.fingerprint, `${arm} plugin fingerprint mismatch`);
  }
  assert.equal(sha(fs.readFileSync(config.cli.executable)), config.cli.binarySha256, "CLI binary fingerprint mismatch");
  for (const task of config.tasks) {
    assert.ok(Array.isArray(task.history), "Missing task history");
    assert.equal(sha(JSON.stringify(task.history)), task.inputSha256, "Task history fingerprint mismatch");
    assert.equal(typeof task.instructions, "string", "Missing task instructions");
    assert.ok(typeof task.request === "string" && task.request.trim(), "Missing continuation request");
    if (chained) {
      assert.ok(Array.isArray(task.cycleRequests) && task.cycleRequests.length === config.compactionCycles
        && task.cycleRequests.every(request => typeof request === "string" && request.trim()), "Missing frozen cycle requests");
      assert.equal(task.cycleRequests[0], task.request, "First cycle request mismatch");
    }
    assert.ok(Array.isArray(task.allowedPaths) && task.allowedPaths.every(name => typeof name === "string"), "Invalid allowed paths");
    validateCreatePaths(task.allowedPaths, task.createPaths);
    if (task.toolDefinitions !== undefined) {
      const supportedTools = task.createPaths?.length ? creationContinuationTools : continuationTools;
      assert.ok(Array.isArray(task.toolDefinitions), "Unsupported tool definitions");
      assert.deepEqual(task.toolDefinitions.map(tool => tool.name).sort(), supportedTools.map(tool => tool.name).sort(), "Unsupported tool definitions");
    }
    task.sourceWorkspace = assertRunDirectory(task.sourceWorkspace);
    assert.deepEqual(fingerprintWorkspace(task.sourceWorkspace), task.workspaceFingerprint, "Task workspace fingerprint mismatch");
  }
  config.versions = { old: sha(JSON.stringify(config.plugins.old.fingerprint)), new: sha(JSON.stringify(config.plugins.new.fingerprint)), cli: config.cli.binarySha256 };
  config.requestTimeoutMs = requestTimeoutMs;
  config.adapterMode = adapters === defaults ? "maintained" : "injected-test";
  config.runnerFingerprints = Object.fromEntries(["fixed", "runner", "plugin", "cli", "continuation", "process", "rpc", "tools", "response", "metrics"].map(name => {
    const file = `codex-compact-quality-${name}.mjs`;
    return [file, sha(fs.readFileSync(new URL(file, import.meta.url)))];
  }));
  let schedule = makeSchedule(config);
  if (retry) {
    const attempt = makeRetrySchedule({ ...retry, executorFingerprints: config.runnerFingerprints });
    const { runnerFingerprints: _currentExecutor, ...current } = schedule.specification;
    const { runnerFingerprints: _sourceExecutor, retry: _retry, ...source } = attempt.specification;
    assert.deepEqual(current, source, "Retry inputs, versions or execution conditions differ from the source run");
    schedule = attempt;
  }
  const tasks = new Map(config.tasks.map(task => [task.id, task]));
  return runSchedule({ directory, schedule, shouldStop, execute: async ({ job, directory: jobDirectory, dependency }) => {
    const task = tasks.get(job.taskId);
    assert.deepEqual(fingerprintWorkspace(task.sourceWorkspace), task.workspaceFingerprint, "Source workspace changed between jobs");
    let sourceState = { workspacePath: task.sourceWorkspace, workspaceFingerprint: task.workspaceFingerprint };
    let history = structuredClone(task.history);
    if (chained && job.dependsOn) {
      assert.equal(dependency?.value?.arm, job.arm, "Chain arm mismatch");
      assert.equal(dependency.value.compactionRepeat, job.compactionRepeat, "Chain replicate mismatch");
      if (job.phase === "continuation") {
        assert.equal(dependency.value.compactionCycle, job.compactionCycle, "Chain cycle mismatch");
        sourceState = dependency.value.sourceState;
      } else {
        assert.equal(dependency.value.phase, "continuation", "Chain must follow a completed continuation");
        assert.equal(dependency.value.compactionCycle, job.compactionCycle - 1, "Chain cycle mismatch");
        const state = dependency.value.output.finalState;
        assert.ok(state, "Missing continuation final state");
        assert.equal(fs.realpathSync(state.historyPath), state.historyPath, "Invalid chain history path");
        assert.ok(fs.lstatSync(state.historyPath).isFile(), "Invalid chain history file");
        history = JSON.parse(fs.readFileSync(state.historyPath, "utf8"));
        assert.ok(Array.isArray(history) && history.length > 0, "Empty chain history");
        assert.equal(sha(JSON.stringify(history)), state.historySha256, "Chain history fingerprint mismatch");
        sourceState = { workspacePath: state.workspacePath, workspaceFingerprint: state.workspaceFingerprint };
      }
      assertRunDirectory(sourceState.workspacePath);
      assert.deepEqual(fingerprintWorkspace(sourceState.workspacePath), sourceState.workspaceFingerprint, "Chain workspace fingerprint mismatch");
    }
    const common = { directory: jobDirectory, sourceWorkspace: sourceState.workspacePath, expectedWorkspaceFingerprint: sourceState.workspaceFingerprint,
      history, instructions: task.instructions, executionTimeoutMs: requestTimeoutMs, onProcess };
    let output;
    if (job.phase === "prepare_reference") {
      output = { replacementHistory: structuredClone(history), source: "uncompressed-reference", requestCount: 0, usage: null };
    } else if (job.phase === "compaction") {
      if (job.arm === "cli") {
        output = await adapters.cli({ ...common, executable: config.cli.executable, binarySha256: config.cli.binarySha256, credentialFile: credentials.cli });
      } else {
        const plugin = config.plugins[job.arm];
        output = await adapters.plugin({ ...common, moduleDirectory: plugin.directory, expectedModuleFingerprint: plugin.fingerprint, credentialFile: credentials.pi });
      }
      assert.ok(Array.isArray(output.replacementHistory) && output.replacementHistory.length > 0, "Missing compaction history");
    } else {
      assert.equal(dependency?.value?.arm, job.arm, "Continuation arm mismatch");
      output = await adapters.continuation({ directory: jobDirectory, sourceWorkspace: sourceState.workspacePath, expectedWorkspaceFingerprint: sourceState.workspaceFingerprint,
        initialHistory: structuredClone(dependency.value.output.replacementHistory), instructions: task.instructions,
        request: chained ? task.cycleRequests[job.compactionCycle] : task.request, allowedPaths: task.allowedPaths, model: config.model, effort: config.effort,
        requestTimeoutMs, send, ...(task.createPaths === undefined ? {} : { createPaths: task.createPaths }),
        ...(chained ? { captureFinalState: true } : {}), ...(task.toolDefinitions ? { toolDefinitions: task.toolDefinitions } : {}) });
    }
    return { phase: job.phase, arm: job.arm, taskId: job.taskId, independenceId: job.independenceId,
      compactionRepeat: job.compactionRepeat, continuationRepeat: job.continuationRepeat, dependsOn: job.dependsOn,
      ...(chained ? { compactionCycle: job.compactionCycle, experimentMode: "fixed-opportunity-chain", sourceState } : {}),
      natural90PercentEvidence: false, humanReview: "pending", output };
  } });
}
