import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { scenarios } from "./codex-compact-cases.mjs";

const root = path.resolve(".tmp/codex-compact-audit/live");
if (!fs.readFileSync(path.join(root, "full.log"), "utf8").trim().endsWith("Evaluation finished")) throw new Error("Formal evaluation has not finished");
const rows = fs.readFileSync(path.join(root, "results.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const aggregate = (variant, round = 1) => {
  const expected = round === 1 ? 24 : 3;
  const selected = rows.filter((r) => r.variant === variant && (r.round ?? 1) === round && r.score);
  return { variant, round, expected, scored: selected.length, passed: selected.filter((r) => r.score.taskPassed).length, factsCorrect: selected.reduce((n, r) => n + Object.values(r.score.facts ?? {}).filter(Boolean).length, 0), factsExpected: expected * 6, codePassed: selected.filter((r) => r.score.codePassed).length };
};
const evaluated = await import(path.join(root, "new-dist/native-compaction.js"));
const optimized = await import(path.resolve("extensions/codex-compact/dist/native-compaction.js"));
const threads = new Set(rows.filter((r) => r.variant === "cli-native").map((r) => r.thread));
const sessions = path.join(root, "codex-home/sessions");
let equivalentHistories = 0;
const cliEffectiveWindows = new Set();
for (const file of fs.readdirSync(sessions, { recursive: true }).filter((f) => f.endsWith(".jsonl") && [...threads].some((thread) => f.includes(thread)))) {
  let history = [];
  for (const line of fs.readFileSync(path.join(sessions, file), "utf8").trim().split("\n")) {
    const event = JSON.parse(line);
    if (event.payload?.type === "token_count" && event.payload.info?.model_context_window) cliEffectiveWindows.add(event.payload.info.model_context_window);
    if (event.type === "response_item") {
      const item = structuredClone(event.payload);
      delete item.id;
      delete item.internal_chat_message_metadata_passthrough;
      history.push(item);
    }
    if (event.type === "compacted") {
      const checkpoint = { type: "compaction", encrypted_content: "synthetic-comparison-marker" };
      if (!isDeepStrictEqual(evaluated.buildReplacementHistory(history, checkpoint), optimized.buildReplacementHistory(history, checkpoint)) || evaluated.approximateResponseItemTokens(history) !== optimized.approximateResponseItemTokens(history)) throw new Error("Final UTF-8 optimization changed evaluated histories");
      equivalentHistories++;
      history = structuredClone(event.payload.replacement_history).map((item) => { delete item.id; delete item.internal_chat_message_metadata_passthrough; return item; });
    }
  }
}
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const imageInputTokens = Object.fromEntries(["cli", "old", "new"].map((variant) => [variant, mean(rows.filter((r) => r.key.startsWith("image-heavy-") && r.variant === variant && r.phase === "continue").map((r) => r.usage.input_tokens))]));
const hashes = (dir) => Object.fromEntries(fs.readdirSync(dir).filter((name) => name.endsWith(".js")).map((name) => [name, createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex")]));
const report = {
  model: "gpt-5.6-sol", effort: "medium", cliVersion: "0.154.0", baseline: "6ec995fae1086e5c00525d6e9a43055e3f625b21", referenceCommit: "6b9826e3aa83b1a5947db50f4332cb9c65f1b340", repetitions: 3,
  casesSha256: createHash("sha256").update(fs.readFileSync("scripts/codex-compact-cases.mjs")).digest("hex"),
  evaluatedCompiledSources: hashes(path.join(root, "new-dist")), finalCompiledSources: hashes("extensions/codex-compact/dist"), equivalentHistories,
  screenshotSha256: createHash("sha256").update(fs.readFileSync(path.join(root, "screenshot.png"))).digest("hex"), cliEffectiveWindows: [...cliEffectiveWindows], pluginRawWindow: 272000,
  scenarios, summary: [...["cli", "old", "new", "cli-native"].map((v) => aggregate(v)), ...["old", "new", "cli-native"].map((v) => aggregate(v, 2))], imageInputTokens,
  errors: rows.filter((r) => r.error).map(({ key, variant, phase, round, error }) => ({ key, variant, phase, round, error })),
  failures: rows.filter((r) => r.score && !r.score.taskPassed).map(({ key, variant, round, answer, score }) => ({ key, variant, round, answer, score })),
  measurements: rows.map(({ key, variant, phase, round, elapsedMs, inputEstimate, replacementEstimate, score, usage }) => ({ key, variant, phase, round, elapsedMs, inputEstimate, replacementEstimate, score, ...(phase === "continue" ? { usage: { inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens, cachedTokens: usage?.input_tokens_details?.cached_tokens } } : {}) })),
};
fs.mkdirSync("docs/fixtures", { recursive: true });
fs.writeFileSync("docs/fixtures/codex-compact-live-results.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ summary: report.summary, errors: report.errors, imageInputTokens, equivalentHistories }, null, 2));
