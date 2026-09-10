import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { GoalLoopDetector, LOOP_WINDOW, LOOP_WARN_REPEATS, LOOP_PAUSE_REPEATS } from "../dist/loop.js";

// Offline evidence replay only. This does not measure a real model's completion rate.
const observation = (n, text = "Same report") => ({ toolName: "read", input: { path: `report-${n}.md` }, content: [{ type: "text", text }], isError: false });
function replay(name, observations, baseline = false) {
  const detector = new GoalLoopDetector();
  const durations = [];
  let firstWarn = null, firstPause = null, maxRetained = 0;
  const beforeHeap = process.memoryUsage().heapUsed;
  const start = performance.now();
  observations.forEach((item, index) => {
    const before = performance.now();
    const decision = baseline ? "none" : detector.observe(item);
    durations.push(performance.now() - before);
    if (decision === "warn") firstWarn ??= index + 1;
    if (decision === "pause") firstPause ??= index + 1;
    maxRetained = Math.max(maxRetained, detector.state.retained);
  });
  const elapsedMs = performance.now() - start;
  durations.sort((a, b) => a - b);
  assert.ok(maxRetained <= LOOP_WINDOW);
  return { name, mode: baseline ? "detector-disabled" : "detector-enabled", observations: observations.length, firstWarn, firstPause, maxRetained,
    elapsedMs, meanMs: elapsedMs / observations.length, p95Ms: durations[Math.floor(durations.length * 0.95)] ?? 0, heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap };
}
const cases = [
  ["repeated-178", Array.from({ length: 178 }, () => observation(0))],
  ["alternating-178", Array.from({ length: 178 }, (_, i) => observation(i % 2))],
  ["research-178", Array.from({ length: 178 }, (_, i) => observation(i))],
  ["novel-results-178", Array.from({ length: 178 }, (_, i) => observation(0, `Evidence ${i}`))],
  ["live-waits-178", Array.from({ length: 178 }, () => ({ toolName: "subagent_wait", input: { agentId: "worker" }, content: [{ type: "text", text: JSON.stringify({ outcome: "timeout", agent: { agentId: "worker", status: "running" } }) }], isError: false }))],
  ["long-history-10000", Array.from({ length: 10000 }, (_, i) => observation(i))],
  ["output-50KiB-178", Array.from({ length: 178 }, () => observation(0, "x".repeat(50 * 1024)))],
  ["oversized-178", Array.from({ length: 178 }, () => observation(0, "x".repeat(200 * 1024)))],
];
if (process.argv[2]) {
  // Optional private transcript input; no transcript text is emitted or committed.
  const entries = (await readFile(process.argv[2], "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const calls = new Map();
  const observations = [];
  const first = Number(process.argv[3] ?? 1), last = Number(process.argv[4] ?? entries.length);
  entries.forEach((entry, index) => {
    const message = entry.message;
    if (message?.role === "assistant") for (const part of message.content ?? []) if (part.type === "toolCall") calls.set(part.id, part);
    if (message?.role !== "toolResult" || index + 1 < first || index + 1 > last) return;
    const call = calls.get(message.toolCallId);
    if (call) observations.push({ toolName: call.name, input: call.arguments, content: message.content, isError: message.isError ?? false });
  });
  cases.push([`transcript-records-${first}-${last}`, observations]);
}
const results = [];
// Warm up independently, then retain three trials rather than presenting a best run.
for (let i = 0; i < 1000; i++) new GoalLoopDetector().observe(observation(0));
for (let trial = 1; trial <= 3; trial++) for (const [name, observations] of cases) for (const baseline of [true, false]) results.push({ trial, ...replay(name, observations, baseline) });
const first = name => results.find(result => result.name === name && result.mode === "detector-enabled");
assert.equal(first("repeated-178").firstWarn, 5);
assert.equal(first("repeated-178").firstPause, 9);
assert.equal(first("alternating-178").firstPause, 10);
for (const name of ["research-178", "novel-results-178", "live-waits-178", "long-history-10000", "oversized-178"]) assert.equal(first(name).firstWarn, null);
console.log(JSON.stringify({ node: process.version, thresholds: { window: LOOP_WINDOW, warn: LOOP_WARN_REPEATS, pause: LOOP_PAUSE_REPEATS }, note: "Detector microbenchmark, not old/new scheduler or real-model A/B. Heap deltas include the measurement harness and GC.", results }, null, 2));
