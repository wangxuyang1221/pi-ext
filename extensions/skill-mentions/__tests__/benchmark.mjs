import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import { findReferences, completionReference } from "../dist/references.js";

console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, target: "100 KiB draft median below 100 ms; parser-only, no filesystem reads" }));
const unit = "用 $alpha 正文\n- ~~~\n  $beta\n  ~~~\n再次 $alpha\n\n";
for (const bytes of [1024, 10240, 102400]) {
  const count = Math.ceil(bytes / Buffer.byteLength(unit));
  const draft = unit.repeat(count) + "$al";
  if (findReferences(draft).length !== count * 2 + 1) throw new Error("Code boundary regression");
  for (let index = 0; index < 5; index++) completionReference(draft, draft.length);
  const samples = Array.from({ length: 20 }, () => {
    const start = performance.now();
    if (completionReference(draft, draft.length)?.name !== "al") throw new Error("Completion regression");
    return performance.now() - start;
  }).sort((a, b) => a - b);
  console.log(JSON.stringify({ bytes: Buffer.byteLength(draft), references: count * 2 + 1, medianMs: samples[10], maxMs: samples.at(-1) }));
  if (samples[10] >= 100) process.exitCode = 1;
}
