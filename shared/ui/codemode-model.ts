import { clean, inline, record, resultText, snapshot, ResultCache } from "./codemode-data.js";

export type CallStatus = "running" | "ok" | "error" | "cancelled" | "unknown";
export type ScriptStatus = "pending" | "running" | "completed" | "failed" | "interrupted" | "timed_out" | "unknown";
export interface CodemodeCall {
  id: string; name: string; parentId: string; depth: number; args: Record<string, unknown>; argsComplete: boolean;
  status: CallStatus; startedAt?: number; startMs?: number; durationMs?: number; error?: string; cost?: number;
  revision: number; model: boolean;
}
export interface CodemodeRow {
  id: string; code: string; output: string; outputPath?: string; status: ScriptStatus; startedAt?: number; durationMs?: number;
  calls: CodemodeCall[]; index: Map<string, CodemodeCall>; children: Map<string, CodemodeCall[]>; failures: Map<string, CodemodeCall>;
  counts: Record<CallStatus, number>; incomplete: boolean; evicted: boolean; restored: boolean;
  revision: number; priority: number; generation: number; snapshotLength: number; modelSlots: Set<number>;
}
export interface CodemodeEvent {
  type: string; toolName: string; toolCallId: string; parentToolCallId?: string;
  args?: unknown; result?: unknown; partialResult?: unknown; isError?: boolean; durationMs?: number;
}
const argsOf = (input: unknown): unknown => {
  if (typeof input !== "string") return input;
  try { return JSON.parse(input); } catch { return { preview: input }; }
};

/** Active-branch UI evidence; execution and persisted messages stay authoritative. */
export class CodemodeStore {
  private rows = new Map<string, CodemodeRow>();
  private owners = new Map<string, CodemodeRow>();
  readonly results: ResultCache;
  readonly listeners = new Set<(row?: CodemodeRow) => void>();
  generation = 0;
  constructor(readonly limits = { rows: 32, calls: 1024 }, results = new ResultCache(), private readonly now = () => performance.now()) { this.results = results; }
  get(id: string): CodemodeRow | undefined { return this.rows.get(id); }
  latest(): CodemodeRow | undefined { return [...this.rows.values()].at(-1); }
  ensure(id: string, code?: unknown): CodemodeRow {
    let row = this.rows.get(id);
    if (!row) {
      while (this.rows.size >= this.limits.rows && this.rows.size) this.evict(this.rows.values().next().value!);
      row = { id, code: "", output: "", status: "pending", calls: [], index: new Map(), children: new Map(), failures: new Map(), counts: { running: 0, ok: 0, error: 0, cancelled: 0, unknown: 0 }, incomplete: false, evicted: false, restored: false, revision: 0, priority: 0, generation: this.generation, snapshotLength: 0, modelSlots: new Set() };
      this.rows.set(id, row);
    }
    if (typeof code === "string" && row.code !== code) { row.code = clean(code, 65536); if (code.length > 65536) row.incomplete = true; row.revision++; }
    return row;
  }
  private evict(row: CodemodeRow): void {
    for (const call of row.calls) { this.owners.delete(call.id); this.results.delete(call.id); }
    row.calls = []; row.index.clear(); row.children.clear(); row.failures.clear(); row.modelSlots.clear(); row.code = ""; row.output = row.output.slice(0, 512);
    row.incomplete = true; row.evicted = true; row.revision++;
    this.rows.delete(row.id); this.notify(row);
  }
  clear(): void {
    this.generation++;
    for (const row of [...this.rows.values()]) this.evict(row);
    this.owners.clear(); this.results.clear(); this.notify();
  }
  notify(row?: CodemodeRow): void { for (const listener of this.listeners) listener(row); }
  private touch(row: CodemodeRow, call?: CodemodeCall): void { row.revision++; if (call) call.revision++; this.notify(row); }
  private add(row: CodemodeRow, id: string, name: string, args: unknown, parentId: string): CodemodeCall | undefined {
    if (id.endsWith("/?")) return undefined;
    const existing = row.index.get(id); if (existing) return existing;
    if (row.calls.length >= this.limits.calls) { row.incomplete = true; return undefined; }
    while (this.owners.size >= 4096) {
      const victim = [...this.rows.values()].find(item => item !== row);
      if (!victim) { row.incomplete = true; return undefined; }
      this.evict(victim);
    }
    const captured = snapshot(argsOf(args), 4096, true);
    const parent = row.index.get(parentId);
    const call: CodemodeCall = { id, name: inline(name, 256), parentId, depth: parent ? parent.depth + 1 : 0,
      args: record(captured.value) ?? {}, argsComplete: captured.complete && args !== undefined, status: "running", revision: 0, model: name.startsWith("models.") };
    row.calls.push(call); row.index.set(id, call); this.owners.set(id, row); row.counts.running++;
    const siblings = row.children.get(parentId) ?? []; siblings.push(call); row.children.set(parentId, siblings);
    if (!call.argsComplete) row.incomplete = true;
    return call;
  }
  private status(row: CodemodeRow, call: CodemodeCall, status: CallStatus): void {
    if (call.status === status) return;
    row.counts[call.status]--; row.counts[status]++; call.status = status; call.revision++;
    if (status === "error" || status === "cancelled") row.failures.set(call.id, call); else row.failures.delete(call.id);
  }
  private merge(row: CodemodeRow, input: unknown, nested: boolean): void {
    const data = record(input), calls = data?.calls;
    if (!Array.isArray(calls)) return;
    if (nested && data?.complete === false && row.restored) row.incomplete = true;
    // Metadata snapshots are host-bounded for history; live snapshots may be larger.
    for (const item of calls.slice(0, this.limits.calls)) {
      const value = record(item);
      if (typeof value?.id !== "string" || typeof value.name !== "string") continue;
      const id = value.id;
      const parentId = row.index.has(id.slice(0, id.lastIndexOf("/"))) ? id.slice(0, id.lastIndexOf("/")) : row.id;
      const call = this.add(row, id, value.name, nested ? value.arguments : value.args, parentId);
      if (!call) continue;
      const state = value.status;
      const next: CallStatus = state === "ok" || state === "error" ? state : state === "cancelled" ? "cancelled" : state === "unfinished" ? "unknown" : "running";
      if ((next !== "running" && next !== "unknown") || call.status === "running") this.status(row, call, next);
      if (typeof value.durationMs === "number") call.durationMs = value.durationMs;
      if (typeof value.error === "string") call.error = clean(value.error, 512);
      if (typeof value.cost === "number") call.cost = value.cost;
    }
    if (calls.length > this.limits.calls) row.incomplete = true;
  }
  event(event: CodemodeEvent): void {
    if (event.parentToolCallId) {
      const row = this.rows.get(event.parentToolCallId) ?? this.owners.get(event.parentToolCallId);
      if (!row || row.priority >= 2) return;
      const call = this.add(row, event.toolCallId, event.toolName, event.args, event.parentToolCallId);
      if (!call) { this.touch(row); return; }
      if (event.type === "tool_execution_start" && call.startedAt === undefined) {
        call.startedAt = this.now(); call.startMs = row.startedAt === undefined ? undefined : call.startedAt - row.startedAt;
      } else if (event.type === "tool_execution_update" && call.status === "running") {
        this.results.set(call.id, event.partialResult);
      } else if (event.type === "tool_execution_end" && call.status === "running") {
        this.results.set(call.id, event.result);
        call.durationMs = event.durationMs ?? (call.startedAt === undefined ? undefined : this.now() - call.startedAt);
        call.error = event.isError ? resultText(event.result, 512) : undefined;
        this.status(row, call, event.isError ? "error" : "ok");
      }
      this.touch(row, call); return;
    }
    if (event.toolName !== "codemode") return;
    const row = this.ensure(event.toolCallId, record(event.args)?.code);
    if (row.priority >= 2) return;
    if (event.type === "tool_execution_start") { row.startedAt ??= this.now(); row.status = "running"; }
    else if (event.type === "tool_execution_update") {
      // Normal tools have richer execution events. Only model calls need the snapshot while live.
      const details = record(record(event.partialResult)?.details);
      if (Array.isArray(details?.calls)) {
        const calls = details.calls;
        for (let index = row.snapshotLength; index < Math.min(calls.length, this.limits.calls); index++) {
          if (String(record(calls[index])?.name).startsWith("models.")) row.modelSlots.add(index);
        }
        row.snapshotLength = calls.length;
        for (const index of row.modelSlots) {
          this.merge(row, { calls: [calls[index]] }, false);
          if (record(calls[index])?.status !== "running") row.modelSlots.delete(index);
        }
      }
    } else if (event.type === "tool_execution_end") this.finish(row, event.result, event.isError === true, event.durationMs, 2);
    this.touch(row);
  }
  finish(row: CodemodeRow, input: unknown, isError: boolean, durationMs?: number, priority = 3): void {
    if (row.evicted || priority < row.priority) return;
    row.output = resultText(input);
    if (row.restored && !Array.isArray(record(record(input)?.details)?.calls) && !record(input)?.nestedCalls) row.incomplete = true;
    row.durationMs = durationMs ?? row.durationMs ?? (row.startedAt === undefined ? undefined : this.now() - row.startedAt);
    const errorOffset = row.output.lastIndexOf("Script error:\n");
    const diagnostic = errorOffset < 0 ? "" : row.output.slice(errorOffset);
    row.status = !isError ? "completed" : /^Script error:\nScript timed out:/u.test(diagnostic) ? "timed_out"
      : /^Script error:\nScript aborted:/u.test(diagnostic) ? "interrupted" : "failed";
    this.merge(row, record(input)?.nestedCalls, true);
    this.merge(row, record(input)?.details, false);
    for (const call of row.calls) if (call.status === "running") this.status(row, call, "unknown");
    const path = record(record(input)?.details)?.fullOutputPath;
    if (typeof path === "string") row.outputPath = clean(path, 2048);
    row.priority = priority;
    this.touch(row);
  }
  message(message: unknown, restored = false): void {
    const msg = record(message);
    if (msg?.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) { const item = record(block); if (item?.type === "toolCall" && item.name === "codemode" && typeof item.id === "string") this.ensure(item.id, record(item.arguments)?.code); }
    } else if (msg?.role === "toolResult" && msg.toolName === "codemode" && typeof msg.toolCallId === "string") {
      const row = this.ensure(msg.toolCallId);
      row.restored ||= restored;
      this.finish(row, message, msg.isError === true, typeof msg.durationMs === "number" ? msg.durationMs : undefined);
    }
  }
  rebuild(messages: Iterable<unknown>): void {
    this.clear();
    for (const message of messages) this.message(message, true);
    for (const row of this.rows.values()) if (row.priority === 0) { row.status = "unknown"; row.incomplete = true; }
  }
  get size(): number { return this.rows.size; }
}
