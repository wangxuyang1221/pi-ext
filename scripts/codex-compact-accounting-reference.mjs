import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { WindowUsageAccounting } from "../extensions/codex-compact/dist/usage-accounting.js";
import { approximateResponseItemTokens } from "../extensions/codex-compact/dist/native-compaction.js";

const root = ".tmp/codex-compact-window";
const prepared = JSON.parse(fs.readFileSync(`${root}/prepared.json`, "utf8"));
const file = fs.readdirSync(`${root}/snapshot-sessions`, { recursive: true }).find((file) => file.endsWith(".jsonl") && file.includes(prepared.thread));
const items = fs.readFileSync(`${root}/snapshot-sessions/${file}`, "utf8").trim().split("\n").map(JSON.parse).filter((event) => event.type === "response_item").map(({ payload }) => {
  delete payload.id;
  delete payload.internal_chat_message_metadata_passthrough;
  return payload;
});
if (createHash("sha256").update(JSON.stringify(items)).digest("hex") !== prepared.historySha256) throw new Error("Snapshot hash mismatch");
const cliTokens = [...fs.readFileSync(`${root}/boundary-0.stderr`, "utf8").matchAll(/total_usage_tokens=(\d+)/g)].map((match) => Number(match[1])).find((tokens) => tokens >= 244800 && tokens < 258400);
if (!cliTokens) throw new Error("Missing genuine CLI threshold trace");
const boundary = items.findLastIndex((item) => item.role === "user") + 1;
const response = { role: "assistant", stopReason: "stop", usage: { totalTokens: prepared.lastUsage } };
const accounting = new WindowUsageAccounting();
accounting.observeRequest("identical-prefix", items.slice(0, boundary));
accounting.observeResponse(response);
const samples = [];
let total;
for (let iteration = 0; iteration < 30; iteration++) {
  const start = performance.now();
  total = accounting.estimate("identical-prefix", items, response, approximateResponseItemTokens);
  samples.push(performance.now() - start);
}
const result = { items: items.length, requestBoundary: boundary, localHistory: approximateResponseItemTokens(items), serverTotal: prepared.lastUsage, pluginActiveTokens: total, cliActiveTokens: cliTokens, equalsCli: total === cliTokens, estimateMedianMs: samples.sort((a, b) => a - b)[15], estimateMaxMs: Math.max(...samples) };
fs.writeFileSync(".tmp/codex-accounting/accounting-snapshot.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
if (!result.equalsCli) process.exitCode = 1;
