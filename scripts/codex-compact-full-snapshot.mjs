import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { approximateResponseItemTokens } from "../extensions/codex-compact/dist/native-compaction.js";
import { WindowUsageAccounting } from "../extensions/codex-compact/dist/usage-accounting.js";

const root = ".tmp/codex-compact-window";
const prepared = JSON.parse(readFileSync(`${root}/prepared.json`, "utf8"));
const file = readdirSync(`${root}/snapshot-sessions`, { recursive: true }).find((file) => file.endsWith(".jsonl") && file.includes(prepared.thread));
const items = readFileSync(`${root}/snapshot-sessions/${file}`, "utf8").trim().split("\n").map(JSON.parse).filter((event) => event.type === "response_item").map(({ payload }) => {
  delete payload.id;
  delete payload.internal_chat_message_metadata_passthrough;
  return payload;
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const historySha256 = sha256(JSON.stringify(items));
if (historySha256 !== prepared.historySha256) throw new Error("Snapshot hash mismatch");
const referenceRoot = ".tmp/codex-alignment/full-reference";
const provenance = JSON.parse(readFileSync(`${referenceRoot}/provenance.json`, "utf8"));
const binary = `${referenceRoot}/target/debug/codex-full-estimator-reference`;
if (sha256(readFileSync(binary)) !== provenance.binarySha256) throw new Error("Reference binary hash mismatch");
const native = JSON.parse(execFileSync(binary, [], { input: `${JSON.stringify({ items, instructions: "" })}\n`, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }));
if (native.error) throw new Error(native.error);
const counts = items.map((item) => approximateResponseItemTokens([item]));
const mismatches = counts.flatMap((count, index) => count === native.counts[index] ? [] : [{ index, type: items[index].type, plugin: count, rust: native.counts[index] }]);
const boundary = items.findLastIndex((item) => item.role === "user") + 1;
const response = { role: "assistant", stopReason: "stop", usage: { totalTokens: prepared.lastUsage } };
const accounting = new WindowUsageAccounting();
accounting.observeRequest("snapshot", items.slice(0, boundary));
accounting.observeResponse(response);
const result = { historySha256, referenceBinarySha256: provenance.binarySha256, items: items.length, pluginHistory: approximateResponseItemTokens(items), rustHistory: native.total,
  pluginActive: accounting.estimate("snapshot", items, response, approximateResponseItemTokens),
  rustActive: prepared.lastUsage + native.oldReasoningTokens + native.tailTokens,
  rustOldReasoning: native.oldReasoningTokens, rustTail: native.tailTokens, mismatches };
writeFileSync(".tmp/codex-alignment/full-snapshot-result.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
if (mismatches.length || result.pluginActive !== result.rustActive) process.exitCode = 1;
