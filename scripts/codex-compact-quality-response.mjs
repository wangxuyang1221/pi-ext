// Parse retained Responses SSE before any continuation tool executes.
import { usageCounts } from "./codex-compact-quality-metrics.mjs";

export function parseContinuationResponse(wire, allowedTools) {
  const events = wire.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n"))
    .filter(data => data && data !== "[DONE]").map(data => JSON.parse(data));
  if (events.some(event => ["error", "response.failed", "response.incomplete"].includes(event.type))) throw new Error("Failed response event");
  const completions = events.filter(event => event.type === "response.completed");
  if (completions.length !== 1) throw new Error("Missing or duplicated completed response");
  const completed = completions[0];
  if (completed.response.status !== "completed" || completed.response.error) throw new Error("Unsuccessful terminal response");
  const items = completed.response.output?.length ? completed.response.output : events.filter(event => event.type === "response.output_item.done").map(event => event.item);
  const callIds = new Set();
  for (const item of items) {
    if (!["message", "reasoning", "function_call"].includes(item.type)) throw new Error("Unsupported continuation output item");
    if (item.status !== undefined && item.status !== "completed") throw new Error("Unfinished output item");
    if (item.type === "function_call") {
      if (typeof item.call_id !== "string" || !item.call_id || callIds.has(item.call_id)) throw new Error("Missing or duplicate call ID");
      if (!allowedTools.includes(item.name)) throw new Error("Unsupported continuation tool");
      const args = JSON.parse(item.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid tool arguments");
      callIds.add(item.call_id);
    }
  }
  const calls = items.filter(item => item.type === "function_call");
  const answer = items.flatMap(item => item.content ?? []).filter(content => content.type === "output_text").map(content => content.text).join("\n");
  if (!calls.length && !answer.trim()) throw new Error("Empty continuation response");
  return { items, calls, answer, usage: usageCounts(completed.response.usage, "responses") };
}
