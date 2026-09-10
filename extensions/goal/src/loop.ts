import { createHash } from "node:crypto";
export const LOOP_WINDOW = 32;
export const LOOP_WARN_REPEATS = 4;
export const LOOP_PAUSE_REPEATS = 8;
export type LoopDecision = "none" | "warn" | "pause";
export interface LoopObservation { toolName: string; input: unknown; content: unknown; isError: boolean }
export const LOOP_MAX_BYTES = 128 * 1024;
/** Hash JSON-like evidence with bounded work. Unknown evidence is never a match. */
function fingerprint(value: unknown): string | undefined {
  const hash = createHash("sha256");
  const active = new Set<object>();
  let bytes = 0;
  let nodes = 0;
  const add = (text: string) => {
    if (text.length > LOOP_MAX_BYTES || (bytes += Buffer.byteLength(text)) > LOOP_MAX_BYTES) throw new Error("Fingerprint limit");
    hash.update(text);
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 4096 || depth > 16) throw new Error("Fingerprint limit");
    if (item === null || typeof item === "boolean" || typeof item === "number") { add(JSON.stringify(item)); return; }
    if (typeof item === "string") { if (item.length > LOOP_MAX_BYTES) throw new Error("Fingerprint limit"); add(JSON.stringify(item)); return; }
    if (!item || typeof item !== "object" || active.has(item)) throw new Error("Unsupported evidence");
    active.add(item);
    if (Array.isArray(item)) {
      if (item.length > 4096) throw new Error("Fingerprint limit");
      add("["); for (const child of item) { visit(child, depth + 1); add(","); } add("]");
    } else {
      const keys: string[] = [];
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        if (keys.length >= 4096 || key.length > LOOP_MAX_BYTES) throw new Error("Fingerprint limit");
        keys.push(key);
      }
      add("{");
      for (const key of keys.sort()) {
        add(JSON.stringify(key)); add(":");
        visit((item as Record<string, unknown>)[key], depth + 1); add(",");
      }
      add("}");
    }
    active.delete(item);
  };
  try { visit(value, 0); return hash.digest("hex"); } catch { return undefined; }
}
function verifiedWait(observation: LoopObservation): boolean {
  if (observation.toolName !== "subagent_wait" || !Array.isArray(observation.content) || observation.content.length !== 1) return false;
  const part = observation.content[0];
  const input = observation.input as { agentId?: unknown } | null;
  if (!input || typeof input.agentId !== "string" || !input.agentId || part?.type !== "text" || typeof part.text !== "string" || part.text.length > LOOP_MAX_BYTES) return false;
  try {
    const receipt = JSON.parse(part.text);
    return receipt?.outcome === "timeout" && receipt.agent?.agentId === input.agentId && receipt.agent?.status === "running";
  } catch { return false; }
}
/** Detect bounded, observable repetition, not semantic task completion. */
export class GoalLoopDetector {
  private recent: string[] = [];
  private calls: string[] = [];
  wouldRepeat(toolName: string, input: unknown): boolean {
    const key = fingerprint({ toolName, input });
    return !!key && this.calls.includes(key);
  }
  private repeats = 0;
  get state() { return { retained: this.recent.length, repeats: this.repeats }; }
  observe(observation: LoopObservation): LoopDecision {
    if (observation.isError || verifiedWait(observation)) { this.reset(); return "none"; }
    const key = fingerprint(observation);
    const call = fingerprint({ toolName: observation.toolName, input: observation.input });
    if (!key || !call) { this.reset(); return "none"; }
    this.repeats = this.recent.includes(key) ? Math.min(LOOP_PAUSE_REPEATS, this.repeats + 1) : 0;
    this.recent.push(key);
    this.calls.push(call);
    if (this.recent.length > LOOP_WINDOW) { this.recent.shift(); this.calls.shift(); }
    if (this.repeats >= LOOP_PAUSE_REPEATS) return "pause";
    return this.repeats === LOOP_WARN_REPEATS ? "warn" : "none";
  }
  reset(): void { this.recent = []; this.calls = []; this.repeats = 0; }
}
