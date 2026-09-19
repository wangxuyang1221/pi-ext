import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".tmp/codex-accounting");
const normal = fs.readFileSync(path.join(root, "normal-results.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
const sessionFiles = fs.readdirSync(root).filter((file) => /^session-result-\d+\.json$/.test(file)).sort();
const sessions = sessionFiles.map((file) => ({ file, ...JSON.parse(fs.readFileSync(path.join(root, file), "utf8")) }));
const final = sessions.at(-1);
if (!final) throw new Error("Missing real Pi session evidence");
const thresholds = fs.readdirSync(root).filter((file) => /^threshold-result-\d+\.json$/.test(file)).sort().map((file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8")));
const result = {
  accounting: JSON.parse(fs.readFileSync(path.join(root, "accounting-snapshot.json"), "utf8")),
  normalEntry: normal.map(({ repetition, inputHistorySha256, sourceServerUsage, autoLimit, effectiveWindow, localEstimate, compactionUsage, continuationUsage, score, elapsedMs, error }) => ({ repetition, inputHistorySha256, sourceServerUsage, autoLimit, effectiveWindow, localEstimate, compactionUsage, continuationUsage: continuationUsage && { input: continuationUsage.input_tokens, output: continuationUsage.output_tokens, total: continuationUsage.total_tokens }, score, elapsedMs, error })),
  piSession: {
    piVersion: final.piVersion, model: final.model, effort: final.effort, importedItems: final.importedItems,
    importIsNormalized: final.importIsNormalized, checkpoints: final.checkpoints,
    observations: final.observations.filter((observation) => observation.event !== "incoming"),
    answers: final.answers.map(({ usage, stopReason, score }) => ({ usage, stopReason, score })),
    error: final.error,
  },
  piThreshold: thresholds.map(({ piVersion, model, effort, rawWindow, autoLimit, effectiveWindow, piNativeAutoCompaction, observations, measurements, score, responseUsage, checkpoints, error }) => ({ piVersion, model, effort, rawWindow, autoLimit, effectiveWindow, piNativeAutoCompaction, observations, measurements, score, responseUsage, checkpoints, error })),
  excludedImportPilots: sessions.filter((session) => session.answers.some((answer) => !answer.score.taskPassed)).map((session) => ({ file: session.file, reason: "Importer omitted Pi textSignature v:1; not a valid native Pi fixture. Revealed unsafe suffix recovery, now rejected by regression test.", scores: session.answers.map((answer) => answer.score.correct) })),
};
fs.writeFileSync("docs/fixtures/codex-accounting-results.json", JSON.stringify(result, null, 2) + "\n");
console.log("Wrote docs/fixtures/codex-accounting-results.json");
