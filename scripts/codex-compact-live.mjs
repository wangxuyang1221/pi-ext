import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { ModelRuntime, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { scenarios, scenarioInput, scoreAnswer } from "./codex-compact-cases.mjs";

const root = path.resolve(".tmp/codex-compact-audit/live");
const baseline = "6ec995fae1086e5c00525d6e9a43055e3f625b21";
const modelId = "gpt-5.6-sol";
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 3);
if (!Number.isSafeInteger(repetitions) || repetitions < 1) throw new Error("EVAL_REPETITIONS must be a positive integer");
process.env.PI_CODING_AGENT_DIR = path.join(root, "pi-home");
const selected = scenarios.filter((s) => !process.env.EVAL_SCENARIOS || process.env.EVAL_SCENARIOS.split(",").includes(s.id));
fs.mkdirSync(root, { recursive: true });
const resultsPath = path.join(root, "results.jsonl");
const configuration = { baseline, model: modelId, effort: "medium", repetitions, scenarios: selected, cliVersion: execFileSync("codex", ["--version"], { encoding: "utf8" }).trim(), casesSha256: createHash("sha256").update(fs.readFileSync("scripts/codex-compact-cases.mjs")).digest("hex"), startedAt: new Date().toISOString() };
if (configuration.cliVersion !== "codex-cli 0.154.0") throw new Error("The live reference requires codex-cli 0.154.0");
configuration.newSources = Object.fromEntries(fs.readdirSync("extensions/codex-compact/src").filter((name) => name.endsWith(".ts")).map((name) => [name, createHash("sha256").update(fs.readFileSync(path.join("extensions/codex-compact/src", name))).digest("hex")]));
fs.writeFileSync(path.join(root, `configuration-${Date.now()}.json`), JSON.stringify(configuration, null, 2));
function record(value) { fs.appendFileSync(resultsPath, JSON.stringify(value) + "\n"); console.log(JSON.stringify(value)); }
function compile(variant) {
  const out = path.join(root, variant + "-dist");
  fs.mkdirSync(out, { recursive: true });
  const sourceDir = "extensions/codex-compact/src";
  const names = variant === "old" ? execFileSync("git", ["ls-tree", "--name-only", `${baseline}:${sourceDir}`], { encoding: "utf8" }).trim().split("\n") : fs.readdirSync(sourceDir);
  for (const name of names.filter((name) => name.endsWith(".ts"))) {
    const source = variant === "old" ? execFileSync("git", ["show", `${baseline}:${sourceDir}/${name}`], { encoding: "utf8" }) : fs.readFileSync(path.join(sourceDir, name), "utf8");
    fs.writeFileSync(path.join(out, name.replace(/\.ts$/, ".js")), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  }
  return import(pathToFileURL(path.join(out, "remote-compaction.js")).href);
}
const variants = { old: await compile("old"), new: await compile("new") };
const native = await import(pathToFileURL(path.join(root, "new-dist/native-compaction.js")).href);
const runtime = await ModelRuntime.create({ authPath: path.join(root, "pi-home/auth.json"), modelsPath: null, modelsStorePath: path.join(root, "pi-home/models-store.json"), refreshOnCreate: false });
const registry = new ModelRegistry(runtime);
const model = runtime.getModel("openai-codex", modelId);
if (!model) throw new Error("Evaluation model unavailable");
const flags = ["--ignore-user-config", "--skip-git-repo-check", "--json", "-m", modelId, "-c", 'model_reasoning_effort="medium"', "-c", "project_doc_max_bytes=0", "-c", "features.remote_compaction_v2=true", "-c", "features.token_budget=false", "-c", "model_auto_compact_token_limit=2000", "-c", 'sandbox_mode="read-only"'];
async function cli(prompt, prefix, thread, images = 0) {
  const args = ["exec", ...(thread ? ["resume"] : []), ...flags];
  if (!thread) args.push("-C", path.join(root, "workspace"));
  for (let i = 0; i < images; i++) args.push("-i", path.join(root, "screenshot.png"));
  args.push(...(thread ? [thread, "-"] : ["-"]));
  const started = performance.now();
  const stdout = fs.openSync(path.join(root, prefix + ".jsonl"), "w");
  const stderr = fs.openSync(path.join(root, prefix + ".stderr"), "w");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("codex", args, { cwd: path.join(root, "workspace"), env: { ...process.env, CODEX_HOME: path.join(root, "codex-home"), TMPDIR: path.resolve(".tmp/codex-compact-audit/tmp") }, stdio: ["pipe", stdout, stderr] });
      const timeout = setTimeout(() => child.kill("SIGTERM"), 600_000);
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("close", (code) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`CLI exit ${code}; see ${prefix}.stderr`)); });
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    });
  } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  const events = fs.readFileSync(path.join(root, prefix + ".jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  return { thread: events.find((e) => e.type === "thread.started")?.thread_id ?? thread, answer: events.filter((e) => e.type === "item.completed" && e.item.type === "agent_message").map((e) => e.item.text).join("\n"), elapsedMs: Math.round(performance.now() - started), usage: events.findLast((e) => e.type === "turn.completed")?.usage };
}
function findRollout(thread) {
  const base = path.join(root, "codex-home/sessions");
  const matches = fs.readdirSync(base, { recursive: true }).filter((p) => p.endsWith(".jsonl") && p.includes(thread));
  if (matches.length !== 1) throw new Error(`Expected one rollout, got ${matches.length}`);
  return fs.readFileSync(path.join(base, matches[0]), "utf8").trim().split("\n").map(JSON.parse);
}
function clean(item) {
  const copy = structuredClone(item);
  delete copy.id;
  delete copy.internal_chat_message_metadata_passthrough;
  return copy;
}
function snapshot(events) {
  let history = [];
  const points = [];
  for (const e of events) {
    if (e.type === "response_item") history.push(clean(e.payload));
    if (e.type === "compacted") {
      points.push({ input: history, replacement: e.payload.replacement_history.map(clean) });
      history = e.payload.replacement_history.map(clean);
    }
  }
  return { instructions: events.find((e) => e.type === "session_meta").payload.base_instructions.text, points };
}
async function continueHistory(history, instructions, question) {
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) throw new Error("Evaluation authentication unavailable");
  const sessionId = randomUUID();
  const body = { model: modelId, instructions, input: [...history, { type: "message", role: "user", content: [{ type: "input_text", text: question }] }], store: false, stream: true, tools: [], tool_choice: "auto", parallel_tool_calls: true, include: ["reasoning.encrypted_content"], reasoning: { effort: "medium", summary: "auto" }, text: { verbosity: "low" }, prompt_cache_key: sessionId };
  const started = performance.now();
  const response = await fetch(`${(auth.baseUrl ?? model.baseUrl).replace(/\/$/, "")}/codex/responses`, { method: "POST", headers: native.buildCodexHeaders({ apiKey: auth.apiKey, headers: auth.headers, sessionId }), body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`Continuation HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  const text = await response.text();
  const events = text.split(/\r?\n/).filter((line) => line.startsWith("data: ") && line !== "data: [DONE]").map((line) => JSON.parse(line.slice(6)));
  const completed = events.findLast((e) => e.type === "response.completed");
  if (!completed) throw new Error(`Continuation did not complete: ${JSON.stringify(events.findLast((e) => e.type === "error" || e.type === "response.failed"))}`);
  const output = completed.response.output?.length ? completed.response.output : events.filter((e) => e.type === "response.output_item.done").map((e) => e.item);
  const answer = events.filter((e) => e.type === "response.output_text.delta").map((e) => e.delta).join("") || output.flatMap((i) => i.content ?? []).filter((p) => p.type === "output_text" || p.type === "text").map((p) => p.text).join("");
  if (!answer) fs.writeFileSync(path.join(root, `empty-response-${sessionId}.json`), JSON.stringify(events));
  return { answer, usage: completed.response.usage, elapsedMs: Math.round(performance.now() - started) };
}
for (const scenario of selected) for (let repetition = 1; repetition <= repetitions; repetition++) {
  const key = `${scenario.id}-${repetition}`;
  const { seed, question, expected } = scenarioInput(scenario, repetition);
  try {
    const first = await cli(seed, key + "-seed", undefined, scenario.images ?? 0);
    const official = await cli(question, key + "-resume", first.thread);
    let data = snapshot(findRollout(first.thread));
    if (!data.points.length) throw new Error("CLI produced no compaction checkpoint");
    record({ key, variant: "cli-native", ...official, score: scoreAnswer(official.answer, expected), checkpoints: data.points.length });
    const point = data.points[0];
    const histories = { cli: point.replacement };
    for (const [variant, module] of Object.entries(variants)) {
      const started = performance.now();
      try {
        const ctx = { model, thinkingLevel: "medium", cwd: path.join(root, "workspace"), isProjectTrusted: () => false, modelRegistry: registry, sessionManager: { getSessionId: randomUUID }, getSystemPrompt: () => data.instructions };
        const result = await module.createNativeCheckpoint({ ctx, model, input: point.input, allTools: [], activeToolNames: [], signal: AbortSignal.timeout(300_000) });
        histories[variant] = result.details.replacementHistory;
        record({ key, variant, phase: "compact", elapsedMs: Math.round(performance.now() - started), usage: result.usage, inputEstimate: native.approximateResponseItemTokens(point.input), replacementEstimate: native.approximateResponseItemTokens(histories[variant]), inputItems: point.input.length, replacementItems: histories[variant].length });
      } catch (error) { record({ key, variant, phase: "compact", error: error.message }); }
    }
    for (const [variant, history] of Object.entries(histories)) {
      try { const answer = await continueHistory(history, data.instructions, question); record({ key, variant, phase: "continue", ...answer, score: scoreAnswer(answer.answer, expected) }); }
      catch (error) { record({ key, variant, phase: "continue", error: error.message }); }
    }
    if (scenario.rounds === 2) {
      const update = "Keep all accepted values and invariants. The task is still unfinished. Do not use tools. Reply exactly ACK.";
      await cli(update, key + "-second-seed", first.thread);
      const second = await cli(question, key + "-second-resume", first.thread);
      data = snapshot(findRollout(first.thread));
      record({ key, variant: "cli-native", round: 2, ...second, score: scoreAnswer(second.answer, expected), checkpoints: data.points.length });
      // Recompact each plugin's own checkpoint, without giving it previous scored answers.
      for (const variant of ["old", "new"]) if (histories[variant]) {
        try {
          const ctx = { model, thinkingLevel: "medium", cwd: path.join(root, "workspace"), isProjectTrusted: () => false, modelRegistry: registry, sessionManager: { getSessionId: randomUUID }, getSystemPrompt: () => data.instructions };
          const input = [...histories[variant], { type: "message", role: "user", content: [{ type: "input_text", text: update }] }];
          const result = await variants[variant].createNativeCheckpoint({ ctx, model, input, allTools: [], activeToolNames: [], signal: AbortSignal.timeout(300_000) });
          const answer = await continueHistory(result.details.replacementHistory, data.instructions, question);
          record({ key, variant, round: 2, phase: "continue", ...answer, score: scoreAnswer(answer.answer, expected) });
        } catch (error) { record({ key, variant, round: 2, error: error.message }); }
      }
    }
  } catch (error) { record({ key, variant: "setup", error: error.message }); }
}
console.log("Evaluation finished");
