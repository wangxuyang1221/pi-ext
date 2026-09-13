import { setTimeout as delay } from "node:timers/promises";

export const QUERIES = [
  "Anthropic 争议言论与官方回应",
  "Dario Amodei statements about AI safety and regulation",
  "Responsible Scaling Policy official updates",
  "Claude constitution model welfare discussion",
  "Independent reporting and primary-source fact checks",
];
export const OUTCOMES = ["success", "partial", "timeout", "error", "empty", "interrupted"];
export function fixtureResult(outcome, total = 5, elapsedMs = 5000, completed = total) {
  const status = { success: "completed", empty: "completed", partial: "partial", timeout: "timed_out", error: "failed", interrupted: "interrupted", running: "running" }[outcome];
  if (!status) throw new Error(`Unknown fixture outcome: ${outcome}`);
  const failed = outcome === "partial" ? 1 : 0;
  const sourceCount = outcome === "success" ? total * 3 + 2 : outcome === "partial" ? Math.max(0, (total - 1) * 3 + 2) : 0;
  return { content: [{ type: "text", text: "Offline fixture. No web request was made." }], details: {
    status, total, completed, failed, elapsedMs,
    message: outcome === "timeout" ? "Request timed out" : outcome === "interrupted" ? "Search cancelled" : "Search service unavailable",
    sources: Array.from({ length: sourceCount }, (_, i) => ({ title: `Example source ${i + 1} (fixture)`, url: `https://example.com/research/${i + 1}` })),
  } };
}
export async function runFixture({ outcome, total, signal, onUpdate, stepMs = 900, finish }) {
  const start = Date.now();
  let completed = 0;
  onUpdate?.(fixtureResult("running", total, 0, completed));
  try {
    if (finish) outcome = await finish;
    else for (let step = 1; step <= total; step++) {
      await delay(stepMs, undefined, { signal });
      completed = step;
      onUpdate?.(fixtureResult("running", total, Date.now() - start, completed));
    }
  } catch (error) {
    if (error.name !== "AbortError") throw error;
    outcome = "interrupted";
  }
  if (signal?.aborted) outcome = "interrupted";
  return fixtureResult(outcome, total, Date.now() - start, completed);
}
