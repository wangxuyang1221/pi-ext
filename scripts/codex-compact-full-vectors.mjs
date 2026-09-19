import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fullEstimatorCases } from "./codex-compact-full-cases.mjs";

const root = ".tmp/codex-alignment/full-reference";
const provenance = JSON.parse(readFileSync(`${root}/provenance.json`, "utf8"));
const binary = `${root}/target/debug/codex-full-estimator-reference`;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
if (sha256(readFileSync(binary)) !== provenance.binarySha256) throw new Error("Reference binary fingerprint mismatch");
const cases = fullEstimatorCases();
const lines = execFileSync(binary, [], { input: cases.map((entry) => JSON.stringify(entry)).join("\n") + "\n", encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim().split("\n").map(JSON.parse);
if (lines.length !== cases.length) throw new Error("Incomplete full reference output");
// Reasoning content has a non-idempotent serde skip predicate: [] is omitted,
// while a subsequent deserialize of the absent field produces explicit null.
// Measure the round trip independently rather than assuming the counts agree.
const roundTrips = execFileSync(binary, [], { input: lines.map((entry) => JSON.stringify({ items: entry.normalized ?? [] })).join("\n") + "\n", encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim().split("\n").map(JSON.parse);
const vectors = cases.map((entry, index) => ({ name: entry.name, inputSha256: sha256(JSON.stringify(entry)), ...lines[index], roundTripCounts: roundTrips[index].counts, roundTripTotal: roundTrips[index].total }));
const output = process.argv[2] ?? `extensions/codex-compact/__tests__/fixtures/codex-full-reference-${process.platform}.json`;
writeFileSync(output, `${JSON.stringify({ provenance, vectors }, null, 2)}\n`);
console.log(`Generated ${vectors.length} full reference cases; ${vectors.filter((entry) => entry.error).length} serde rejections: ${output}`);
for (const entry of vectors.filter((entry) => entry.error)) console.log(entry.name, entry.error);
