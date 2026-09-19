import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import * as fixed from "../../../scripts/codex-compact-quality-fixed.mjs";
import { continuationTools, creationContinuationTools, fingerprintWorkspace } from "../../../scripts/codex-compact-quality-tools.mjs";
import { runContinuation } from "../../../scripts/codex-compact-quality-continuation.mjs";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function creationFixture(root: string) {
  const sourceWorkspace = path.join(root, "source"); fs.mkdirSync(sourceWorkspace);
  fs.writeFileSync(path.join(sourceWorkspace, "asset.bin"), Buffer.from([0, 255, 31]));
  const plugins = Object.fromEntries(["old", "new"].map(arm => {
    const directory = path.join(root, arm); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "remote-compaction.js"), `// ${arm}`);
    return [arm, { directory, fingerprint: fingerprintWorkspace(directory) }];
  }));
  const executable = path.join(root, "codex"); fs.writeFileSync(executable, "test binary");
  const history = [{ type: "message", role: "user", content: [{ type: "input_text", text: "Initial task" }] }];
  const task = { id: "creation", independenceId: "one-repository", history, inputSha256: sha(JSON.stringify(history)), sourceWorkspace,
    workspaceFingerprint: fingerprintWorkspace(sourceWorkspace), instructions: "Fixed instructions", request: "stage-0",
    cycleRequests: ["stage-0", "stage-1"], allowedPaths: ["new/code.txt", "new/asset.bin"], createPaths: ["new/code.txt", "new/asset.bin"] };
  return { seed: "creation-test", model: "gpt-5.6-sol", effort: "medium", track: "development-compaction-chain", compactionCycles: 2,
    compactionRepeats: 1, continuationRepeats: 1, plugins, cli: { executable, binarySha256: sha("test binary") }, tasks: [task] };
}

test("rejects invalid creation permissions and mismatched tool profiles before scheduling any model work", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-fixed-permissions-"));
  try {
    const specification = creationFixture(root);
    let calls = 0;
    const unexpected = async () => { calls++; throw new Error("Unexpected execution"); };
    const adapters = { plugin: unexpected, cli: unexpected, continuation: unexpected };
    for (const override of [
      { createPaths: ["undeclared.txt"] }, { createPaths: ["../escape"] }, { createPaths: "new/code.txt" },
      { createPaths: ["new/code.txt", "new/code.txt"] }, { createPaths: null },
      { toolDefinitions: continuationTools }, { createPaths: [], toolDefinitions: creationContinuationTools },
    ]) {
      const directory = fs.mkdtempSync(path.join(root, "invalid-"));
      const tasks = [{ ...specification.tasks[0], ...override }];
      await expect(fixed.runFixedBoundary({ directory, specification: { ...specification, tasks }, credentials: {}, adapters, send: unexpected })).rejects.toThrow(/creation permissions|tool definitions/);
      expect(calls).toBe(0);
      expect(fs.readdirSync(directory)).toEqual([]);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("freezes creation scopes across all four arms and retains new files through the next compaction", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-fixed-create-"));
  try {
    const specification = creationFixture(root);
    const directory = path.join(root, "run"); fs.mkdirSync(directory);
    let requests = 0, compactions = 0;
    const compact = async (options: any) => {
      compactions++;
      if (fs.existsSync(path.join(options.sourceWorkspace, "new/code.txt"))) {
        expect(fs.readFileSync(path.join(options.sourceWorkspace, "new/code.txt"), "utf8")).toBe("created");
        expect(options.history.filter((item: any) => item.type === "function_call_output")).toHaveLength(2);
      }
      return { replacementHistory: [{ type: "compaction", encrypted_content: "test-checkpoint" }], usage: null };
    };
    const adapters = { plugin: compact, cli: compact, continuation: runContinuation };
    const send = async ({ body }: any) => {
      requests++;
      expect(body.tools).toEqual(creationContinuationTools);
      const request = body.input.filter((item: any) => item.role === "user").at(-1).content[0].text;
      const items = body.input.at(-1).type === "function_call_output"
        ? [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "completed" }] }]
        : request === "stage-0"
          ? [{ type: "function_call", call_id: "create", name: "write_file", arguments: JSON.stringify({ path: "new/code.txt", content: "created" }) },
            { type: "function_call", call_id: "copy", name: "copy_file", arguments: JSON.stringify({ source_path: "asset.bin", path: "new/asset.bin" }) }]
          : [{ type: "function_call", call_id: "edit", name: "replace_text", arguments: JSON.stringify({ path: "new/code.txt", old_text: "created", new_text: "updated" }) }];
      const events = [...items.map(item => ({ type: "response.output_item.done", item })),
        { type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } }];
      return { ok: true, status: 200, wire: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") };
    };
    const result = await fixed.runFixedBoundary({ directory, specification, credentials: {}, adapters, send });
    expect(result.results).toHaveLength(16);
    expect(result.results.every((row: any) => row.status === "completed")).toBe(true);
    expect(compactions).toBe(6); expect(requests).toBe(16);
    const continuations = result.results.filter((row: any) => row.value?.phase === "continuation");
    expect(new Set(continuations.map((row: any) => row.value.arm)).size).toBe(4);
    expect(new Set(continuations.map((row: any) => row.value.output.workspacePath)).size).toBe(8);
    for (const row of continuations) {
      const { output, compactionCycle } = row.value;
      expect(output.scopePassed).toBe(true);
      expect(output.tools.every((event: any) => event.status === "ok")).toBe(true);
      expect(fs.readFileSync(path.join(output.workspacePath, "new/code.txt"), "utf8")).toBe(compactionCycle ? "updated" : "created");
      expect(fs.readFileSync(path.join(output.workspacePath, "new/asset.bin"))).toEqual(Buffer.from([0, 255, 31]));
      expect(fingerprintWorkspace(output.workspacePath)).toEqual(output.finalState.workspaceFingerprint);
      const config = JSON.parse(fs.readFileSync(path.join(path.dirname(output.workspacePath), "configuration.json"), "utf8"));
      expect(config.createPaths).toEqual(specification.tasks[0].createPaths);
    }
    expect(fingerprintWorkspace(specification.tasks[0].sourceWorkspace)).toEqual(specification.tasks[0].workspaceFingerprint);
    const resumed = await fixed.runFixedBoundary({ directory, specification, credentials: {}, adapters, send });
    expect(resumed.results).toEqual(result.results); expect(compactions).toBe(6); expect(requests).toBe(16);
    const changed = structuredClone(specification); changed.tasks[0].createPaths = ["new/code.txt"];
    await expect(fixed.runFixedBoundary({ directory, specification: changed, credentials: {}, adapters, send })).rejects.toThrow();
    expect(compactions).toBe(6); expect(requests).toBe(16);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("chains successive compactions through the preceding checkpoint, complete tool history and isolated workspace", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-chain-"));
  try {
    const sourceWorkspace = path.join(root, "source"); fs.mkdirSync(sourceWorkspace); fs.writeFileSync(path.join(sourceWorkspace, "source.txt"), "0");
    const plugins = Object.fromEntries(["old", "new"].map(arm => { const directory = path.join(root, arm); fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, "remote-compaction.js"), `// ${arm}`); return [arm, { directory, fingerprint: fingerprintWorkspace(directory) }]; }));
    const executable = path.join(root, "codex"); fs.writeFileSync(executable, "test binary");
    const history = [{ type: "message", role: "user", content: [{ type: "input_text", text: "Initial task" }] }];
    const task = { id: "chain", independenceId: "one-repository", history, inputSha256: sha(JSON.stringify(history)), sourceWorkspace,
      workspaceFingerprint: fingerprintWorkspace(sourceWorkspace), instructions: "Fixed instructions", request: "stage-0", cycleRequests: ["stage-0", "stage-1", "stage-2"], allowedPaths: ["source.txt"] };
    const specification = { seed: "chain-test", model: "gpt-5.6-sol", effort: "medium", track: "development-compaction-chain", compactionCycles: 3,
      compactionRepeats: 2, continuationRepeats: 1, plugins, cli: { executable, binarySha256: sha("test binary") }, tasks: [task] };
    const directory = path.join(root, "run"); fs.mkdirSync(directory);
    let compactions = 0, requests = 0;
    const compact = async (options: any, arm: string) => {
      const cycle = Number(fs.readFileSync(path.join(options.sourceWorkspace, "source.txt"), "utf8"));
      compactions++;
      if (cycle === 0) expect(options.history).toEqual(history);
      else {
        expect(options.history[0]).toEqual({ type: "compaction", encrypted_content: `${arm}:${cycle - 1}` });
        expect(options.history.at(-1).content[0].text).toBe(`completed-${cycle - 1}`);
        expect(options.history.some((item: any) => item.type === "function_call_output")).toBe(true);
      }
      return { replacementHistory: [{ type: "compaction", encrypted_content: `${arm}:${cycle}` }], usage: null };
    };
    const adapters = { plugin: (options: any) => compact(options, path.basename(options.moduleDirectory)), cli: (options: any) => compact(options, "cli"), continuation: runContinuation };
    const send = async ({ body }: any) => {
      requests++;
      const user = body.input.filter((item: any) => item.role === "user").at(-1).content[0].text;
      const stage = Number(user.slice(6));
      const item = body.input.at(-1).type === "function_call_output"
        ? { type: "message", role: "assistant", content: [{ type: "output_text", text: `completed-${stage}` }] }
        : { type: "function_call", call_id: `edit-${stage}`, name: "replace_text", arguments: JSON.stringify({ path: "source.txt", old_text: String(stage), new_text: String(stage + 1) }) };
      const events = [{ type: "response.output_item.done", item }, { type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } }];
      return { ok: true, status: 200, wire: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") };
    };
    const result = await fixed.runFixedBoundary({ directory, specification, credentials: {}, adapters, send });
    expect(result.results).toHaveLength(48);
    expect(result.results.every((row: any) => row.status === "completed")).toBe(true);
    expect(compactions).toBe(18); expect(requests).toBe(48);
    const continuations = result.results.filter((row: any) => row.value.phase === "continuation");
    expect(continuations).toHaveLength(24);
    for (const row of continuations) {
      const value = row.value;
      expect(value.independenceId).toBe("one-repository");
      expect(value.experimentMode).toBe("fixed-opportunity-chain");
      expect(fs.readFileSync(path.join(value.output.workspacePath, "source.txt"), "utf8")).toBe(String(value.compactionCycle + 1));
      expect(value.output.tools.every((event: any) => event.status === "ok")).toBe(true);
      const dependency = result.results.find((other: any) => other.jobId === value.dependsOn);
      expect(dependency.value.compactionCycle).toBe(value.compactionCycle);
      if (value.compactionCycle > 0) {
        const previous = result.results.find((other: any) => other.jobId === dependency.value.dependsOn);
        expect(previous.value.arm).toBe(value.arm);
        expect(previous.value.compactionRepeat).toBe(value.compactionRepeat);
        expect(previous.value.compactionCycle).toBe(value.compactionCycle - 1);
      }
    }
    expect(fs.readFileSync(path.join(sourceWorkspace, "source.txt"), "utf8")).toBe("0");
    const resumed = await fixed.runFixedBoundary({ directory, specification, credentials: {}, adapters, send });
    expect(resumed.results).toEqual(result.results); expect(compactions).toBe(18); expect(requests).toBe(48);
    for (const mutation of ["history", "workspace"]) {
      const partialDirectory = path.join(root, mutation); fs.mkdirSync(partialDirectory);
      const initialRequests = requests;
      const partial = await fixed.runFixedBoundary({ directory: partialDirectory, specification, credentials: {}, adapters, send,
        shouldStop: () => requests > initialRequests });
      expect(partial.status).toBe("stopped");
      const completed = partial.results.find((row: any) => row.value?.phase === "continuation");
      expect(completed.value.compactionCycle).toBe(0);
      const state = completed.value.output.finalState;
      if (mutation === "history") fs.writeFileSync(state.historyPath, JSON.stringify(history));
      else fs.writeFileSync(path.join(state.workspacePath, "source.txt"), "unexpected external modification");
      const resumedFailure = await fixed.runFixedBoundary({ directory: partialDirectory, specification, credentials: {}, adapters, send });
      const plan = JSON.parse(fs.readFileSync(path.join(partialDirectory, "schedule.json"), "utf8")).payload;
      const next = plan.jobs.find((job: any) => job.dependsOn === completed.jobId);
      const failure = resumedFailure.results.find((row: any) => row.jobId === next.id);
      expect(failure.status).toBe("failed");
      expect(failure.error.message).toMatch(new RegExp(`Chain ${mutation} fingerprint mismatch`));
      const children = resumedFailure.results.filter((row: any) => row.status === "dependency_failed");
      expect(children).toHaveLength(3);
      expect(resumedFailure.results.filter((row: any) => row.status === "failed")).toHaveLength(1);
    }
    for (const override of [{ compactionCycles: 1 }, { continuationRepeats: 2 }, { tasks: [{ ...task, cycleRequests: [task.request] }] }]) {
      const invalidDirectory = fs.mkdtempSync(path.join(root, "invalid-"));
      const before = requests;
      await expect(fixed.runFixedBoundary({ directory: invalidDirectory, specification: { ...specification, ...override }, credentials: {}, adapters, send })).rejects.toThrow();
      expect(requests).toBe(before);
      expect(fs.existsSync(path.join(invalidDirectory, "schedule.json"))).toBe(false);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("routes a frozen paired schedule through each compactor and its own dependent continuations", async () => {
  expect(typeof fixed.runFixedBoundary).toBe("function");
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp/quality-fixed-"));
  try {
    const sourceWorkspace = path.join(root, "source"); fs.mkdirSync(sourceWorkspace); fs.writeFileSync(path.join(sourceWorkspace, "source.txt"), "original");
    const modules = Object.fromEntries(["old", "new"].map(arm => { const directory = path.join(root, arm); fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, "remote-compaction.js"), `// ${arm}`); return [arm, { directory, fingerprint: fingerprintWorkspace(directory) }]; }));
    const executable = path.join(root, "codex"); fs.writeFileSync(executable, "test native binary");
    const history = [{ type: "message", role: "user", content: [{ type: "input_text", text: "historical task" }] }];
    const task = { id: "development-case", independenceId: "source-repository", inputSha256: sha(JSON.stringify(history)), history, instructions: "shared instructions", request: "continue", allowedPaths: ["source.txt"], sourceWorkspace, workspaceFingerprint: fingerprintWorkspace(sourceWorkspace) };
    const specification = { seed: "paired-test", model: "gpt-5.6-sol", effort: "medium", track: "development-fixed-boundary", compactionRepeats: 2, continuationRepeats: 2, plugins: modules, cli: { executable, binarySha256: sha("test native binary") }, tasks: [task] };
    const directory = path.join(root, "run"); fs.mkdirSync(directory);
    const observed: any[] = [];
    const adapters = {
      plugin: async (options: any) => { const arm = path.basename(options.moduleDirectory); observed.push({ phase: "compact", arm }); expect(options.history).toEqual(history); return { replacementHistory: [{ type: "compaction", encrypted_content: `${arm}:${observed.length}` }], usage: null }; },
      cli: async (options: any) => { observed.push({ phase: "compact", arm: "cli" }); expect(options.history).toEqual(history); return { replacementHistory: [{ type: "compaction", encrypted_content: `cli:${observed.length}` }], usage: null }; },
      continuation: async (options: any) => { observed.push({ phase: "continue", history: options.initialHistory }); expect(options.request).toBe(task.request); expect(options.instructions).toBe(task.instructions); return { status: "completed", input: options.initialHistory, humanReview: "pending" }; }
    };
    const result = await fixed.runFixedBoundary({ directory, specification, credentials: { pi: "unused-pi", cli: "unused-cli" }, send: async () => { throw new Error("Unexpected transport"); }, adapters });
    expect(result.status).toBe("completed"); expect(result.results).toHaveLength(24);
    expect(observed.filter(row => row.phase === "compact")).toHaveLength(6);
    expect(observed.filter(row => row.phase === "continue")).toHaveLength(16);
    for (const row of result.results) if (row.value?.phase === "continuation") {
      const parent = result.results.find((other: any) => other.jobId === row.value.dependsOn);
      expect(row.value.output.input).toEqual(parent.value.output.replacementHistory);
    }
    const count = observed.length;
    const resumed = await fixed.runFixedBoundary({ directory, specification, credentials: { pi: "unused-pi", cli: "unused-cli" }, send: async () => {}, adapters });
    expect(resumed.results).toEqual(result.results); expect(observed).toHaveLength(count);

    const failureDirectory = path.join(root, "failure-run"); fs.mkdirSync(failureDirectory);
    const failed = await fixed.runFixedBoundary({ directory: failureDirectory, specification, credentials: { pi: "unused", cli: "unused" }, send: async () => {}, adapters: { ...adapters,
      plugin: async (options: any) => { if (path.basename(options.moduleDirectory) === "old") throw new Error("Native old refusal"); return adapters.plugin(options); }
    } });
    expect(failed.results.filter((row: any) => row.status === "failed")).toHaveLength(2);
    expect(failed.results.filter((row: any) => row.status === "dependency_failed")).toHaveLength(4);
    expect(failed.results.filter((row: any) => row.status === "completed")).toHaveLength(18);
    const retryDirectory = path.join(root, "explicit-retry"); fs.mkdirSync(retryDirectory);
    const requested = failed.results.find((row: any) => row.status === "failed").jobId;
    const beforeRetry = observed.length;
    const retried = await fixed.runFixedBoundary({ directory: retryDirectory, specification, credentials: { pi: "unused", cli: "unused" }, send: async () => {}, adapters,
      retry: { sourceDirectory: failureDirectory, retryJobIds: [requested], reason: "Explicit diagnostic retry of one compaction replicate" },
    });
    expect(observed.length - beforeRetry).toBe(3);
    expect(retried.results.filter((row: any) => row.reusedFrom)).toHaveLength(21);
    expect(retried.results.filter((row: any) => row.status === "failed")).toHaveLength(1);
    expect(retried.results.filter((row: any) => row.status === "dependency_failed")).toHaveLength(2);
    const manifest = JSON.parse(fs.readFileSync(path.join(retryDirectory, "schedule.json"), "utf8")).payload;
    expect(manifest.specification.retry.executorFingerprints).toHaveProperty("codex-compact-quality-fixed.mjs");
    const originalFailure = JSON.parse(fs.readFileSync(path.join(failureDirectory, requested, "result.json"), "utf8"));
    expect(originalFailure.payload.status).toBe("failed");
    const beforeMutation = observed.length;
    fs.writeFileSync(path.join(sourceWorkspace, "source.txt"), "changed");
    await expect(fixed.runFixedBoundary({ directory, specification, credentials: {}, send: async () => {}, adapters })).rejects.toThrow(/workspace fingerprint/);
    expect(observed).toHaveLength(beforeMutation);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
