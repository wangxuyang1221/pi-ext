import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { classifyWindowEvidence } from "./codex-compact-window-evidence.mjs";
import { scoreAnswer } from "./codex-compact-cases.mjs";

const root = path.resolve(".tmp/codex-compact-window");
if (!fs.readFileSync(path.join(root, "run.log"), "utf8").trim().endsWith("Window evaluation finished")) throw new Error("Window evaluation is incomplete");
const config = JSON.parse(fs.readFileSync(path.join(root, "configuration.json"), "utf8"));
const prepared = JSON.parse(fs.readFileSync(path.join(root, "prepared.json"), "utf8"));
const rows = fs.readFileSync(path.join(root, "results.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
if (config.flags.some((v) => v.includes("auto_compact_token_limit") || v.startsWith("model_context_window="))) throw new Error("Threshold or context window was overridden");
if (!classifyWindowEvidence(config.rawWindow, prepared.lastUsage).thresholdOnly) throw new Error("Measured boundary does not isolate 90%");
const trace = fs.readdirSync(root).filter((f) => /^boundary-\d+\.stderr$/.test(f)).flatMap((f) => fs.readFileSync(path.join(root, f), "utf8").split("\n")).findLast((line) => /auto_compact_scope_limit=Some\(244800\)/.test(line) && /full_context_window_limit=Some\(258400\)/.test(line) && /full_context_window_limit_reached=false/.test(line) && / token_limit_reached=true/.test(line));
if (!trace) throw new Error("Missing native CLI trace showing the 90% gate without the hard cap");
const auditKeys = ["audit_early", "audit_middle", "audit_late"];
const auditCoverage = (items) => Object.fromEntries(auditKeys.map((key) => [key, items.some((item) => JSON.stringify(item).includes(config.expected[key]))]));
const sessionRoot = path.join(root, "cli-home-1/sessions");
const file = fs.readdirSync(sessionRoot, { recursive: true }).find((f) => f.endsWith(".jsonl") && f.includes(prepared.thread));
const events = fs.readFileSync(path.join(sessionRoot, file), "utf8").trim().split("\n").map(JSON.parse);
const input = [];
let replacement;
for (const event of events) {
  if (event.type === "compacted") { replacement = event.payload.replacement_history; break; }
  if (event.type === "response_item") { const item = structuredClone(event.payload); delete item.id; delete item.internal_chat_message_metadata_passthrough; input.push(item); }
}
const instructions = events.find((e) => e.type === "session_meta").payload.base_instructions.text;
const localPreflight = [];
for (const variant of ["old", "new"]) {
  const module = await import(path.join(root, `${variant}-dist/native-compaction.js`));
  const window = variant === "old" ? config.rawWindow : Math.floor(config.rawWindow * 0.95);
  const reservedTokens = module.approximateCompactionRequestTokens({ input: [], instructions, tools: [] });
  const trimmed = module.trimFunctionCallHistoryToFitContextWindow(input, window, reservedTokens);
  const rewrittenOutputs = trimmed.filter((item, index) => JSON.stringify(item) !== JSON.stringify(input[index])).length;
  localPreflight.push({ variant, window, reservedTokens, beforeEstimate: module.approximateCompactionRequestTokens({ input, instructions, tools: [] }), afterEstimate: module.approximateCompactionRequestTokens({ input: trimmed, instructions, tools: [] }), rewrittenOutputs, rawAudits: auditCoverage(input), sentAudits: auditCoverage(trimmed) });
}
const scored = rows.filter((r) => r.answer !== undefined).map((r) => ({ ...r, score: scoreAnswer(r.answer, config.expected) }));
const summary = ["cli-native", "cli", "old", "new"].map((variant) => {
  const selected = scored.filter((r) => variant === "cli-native" ? r.phase === "cli-native" : r.phase === "continue" && r.variant === variant);
  return { variant, expected: 3, scored: selected.length, passed: selected.filter((r) => r.score.taskPassed).length, factsCorrect: selected.reduce((n, r) => n + Object.values(r.score.facts ?? {}).filter(Boolean).length, 0), factsExpected: 27, auditCorrect: selected.reduce((n, r) => n + auditKeys.filter((key) => r.score.facts?.[key]).length, 0), auditExpected: 9 };
});
const hashes = (dir) => Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => [f, createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex")]));
const nativeCompactionUsage = [1, 2, 3].map((repetition) => {
  const dir = path.join(root, `cli-home-${repetition}/sessions`);
  const name = fs.readdirSync(dir, { recursive: true }).find((f) => f.endsWith(".jsonl") && f.includes(prepared.thread));
  const compacted = fs.readFileSync(path.join(dir, name), "utf8").trim().split("\n").map(JSON.parse).find((e) => e.type === "compacted").payload;
  return { repetition, responseId: compacted.compaction_response_id, usage: compacted.latest_token_usage_record?.usage };
});
let remoteDiagnostic;
if (fs.existsSync(path.join(root, "remote.log")) && fs.readFileSync(path.join(root, "remote.log"), "utf8").trim().endsWith("Remote diagnostic finished")) {
  const measurements = fs.readFileSync(path.join(root, "remote-results.jsonl"), "utf8").trim().split("\n").map(JSON.parse).map(({ usage, ...row }) => row);
  remoteDiagnostic = {
    bypassedLocalPreflight: true,
    summary: ["old", "new", "cli"].map((variant) => {
      const selected = measurements.filter((r) => r.variant === variant && r.score);
      return { variant, expected: 3, scored: selected.length, passed: selected.filter((r) => r.score.taskPassed).length, factsCorrect: selected.reduce((n, r) => n + Object.values(r.score.facts ?? {}).filter(Boolean).length, 0), factsExpected: 27 };
    }),
    measurements,
  };
}
const report = { config, prepared, nativeCompactionUsage, remoteDiagnostic, nativeGateTrace: trace, corpus: JSON.parse(fs.readFileSync(path.join(root, "corpus-manifest.json"), "utf8")), snapshotHashes: rows.filter((r) => r.phase === "cli-native").map((r) => r.inputHistorySha256), localPreflight, plaintextAuditsInCliReplacement: auditCoverage(replacement), compiledSources: { old: hashes(path.join(root, "old-dist")), new: hashes(path.join(root, "new-dist")) }, summary, preparation: rows.filter((r) => ["prepare", "boundary"].includes(r.phase)), compactions: rows.filter((r) => r.phase === "compact"), answers: scored, errors: rows.filter((r) => r.error) };
fs.mkdirSync("docs/fixtures", { recursive: true });
fs.writeFileSync("docs/fixtures/codex-compact-window-results.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ prepared, summary, localPreflight, errors: report.errors }, null, 2));
