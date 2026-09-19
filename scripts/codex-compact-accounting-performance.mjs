import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { approximateResponseItemTokens } from "../extensions/codex-compact/dist/native-compaction.js";
import { WindowUsageAccounting } from "../extensions/codex-compact/dist/usage-accounting.js";

function measure(operation) {
  for (let index = 0; index < 5; index++) operation();
  const samples = Array.from({ length: 25 }, () => { const start = performance.now(); operation(); return performance.now() - start; }).sort((a, b) => a - b);
  return { medianMs: samples[12], p95Ms: samples[23] };
}
const results = [];
for (const count of [25, 100, 400, 1600]) {
  const input = Array.from({ length: count }, (_, index) => ({ type: "message", role: index % 2 ? "assistant" : "user", content: [{ type: index % 2 ? "output_text" : "input_text", text: `${index}: ${"x".repeat(2560)}` }] }));
  input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] });
  const response = { role: "assistant", stopReason: "stop", usage: { totalTokens: 100000 } };
  const accounting = new WindowUsageAccounting();
  accounting.observeRequest("prefix", input.slice(0, -1));
  accounting.observeResponse(response);
  const primitive = measure(() => { for (const item of input) createHash("sha256").update(JSON.stringify(item)).digest(); });
  const local = measure(() => approximateResponseItemTokens(input));
  const covered = measure(() => {
    if (accounting.estimate("prefix", input, response, approximateResponseItemTokens) !== 100000) throw new Error("Unexpected accounting result");
  });
  results.push({ items: input.length, bytes: Buffer.byteLength(JSON.stringify(input)), primitive, local, covered });
}
// Reference work must itself encode and hash the payload. Allow ten times that
// cost for schema projection and coverage validation, not an observed-runtime
// threshold fitted to this implementation. Check growth over a 16x input span.
const largest = results.at(-1);
const smaller = results[1];
const gates = {
  localWork: largest.local.medianMs <= 10 * largest.primitive.medianMs,
  coveredWork: largest.covered.medianMs <= 10 * largest.primitive.medianMs,
  localGrowth: largest.local.medianMs <= 40 * smaller.local.medianMs,
  coveredGrowth: largest.covered.medianMs <= 40 * smaller.covered.medianMs,
};
const report = { node: process.version, platform: process.platform, arch: process.arch, measuredRuns: 25, warmupRuns: 5, results, gates };
writeFileSync(".tmp/codex-alignment/performance.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
if (Object.values(gates).some((passed) => !passed)) process.exitCode = 1;
