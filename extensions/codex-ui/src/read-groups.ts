import { sessionEntryToContextMessages, type ExtensionContext, type ReadToolDetails, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { RenderCacheScope, ToolRenderCache } from "./render-cache.js";

type RenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
type SourceMessage = { role: string; content?: unknown };
type ReadDetails = Readonly<Omit<ReadToolDetails, "truncation">> & {
  readonly truncation?: Readonly<NonNullable<ReadToolDetails["truncation"]>>;
};
interface ReadFields {
  id: string;
  cache: RenderCacheScope;
  path: string;
  fullPath: string;
  offset?: number;
  limit?: number;
  status: "pending" | "running" | "completed" | "failed";
  content?: readonly { readonly type: string; readonly text?: string }[];
  details?: ReadDetails;
  revision: number;
}

export type ReadRow = Readonly<ReadFields>;
export interface ReadMember extends ReadRow {
  readonly group: { readonly members: readonly ReadMember[]; readonly version: number };
}

const RESULT_PRIORITY = { row: 0, partial: 1, execution: 2, message: 3 } as const;
type ResultOrigin = keyof typeof RESULT_PRIORITY;
type ReadResult = { content?: ReadRow["content"]; details?: unknown };
interface MutableMember extends ReadFields {
  group: { members: readonly ReadMember[]; version: number };
  origin: ResultOrigin;
  hasImage?: boolean;
}
// Source calls without execution/result facts stay standalone, even when a view exists.
interface ReadRecord extends MutableMember { known: boolean }
interface ReadView {
  current(): ReadMember;
  updateCall(context: RenderContext): void;
  updateResult(result: ReadResult, partial: boolean, error: boolean): void;
}
interface ReadRowState { readView?: ReadView }

/** Source-owned facts and grouping. Row callbacks only update their own fallback data. */
export class ReadGroups {
  private readonly records = new Map<string, ReadRecord>();
  private readonly occurrences = new Map<string, number>();
  private readonly candidates = new Map<number, string[]>();
  private readonly membership = new Map<string, number>();
  private readonly dirtyGroups = new Set<number>();
  // Binding is an observed fact, not a claim that a previously bound host row is still mounted.
  private readonly bound = new Set<string>();
  private activeCounts = new Map<string, number>();
  private activeKeys: number[] = [];
  private nextKey = 0;
  private generation = 0;
  private cwd = "";

  constructor(private readonly cache: ToolRenderCache,
    private readonly formatPath: (path: string, cwd: string) => string = path => path) {}

  reset(ctx?: ExtensionContext, preserveBound = false, messages?: Iterable<SourceMessage & { toolCallId?: string; toolName?: string; isError?: boolean }>): void {
    if (!preserveBound) { this.generation++; this.bound.clear(); }
    this.records.clear(); this.occurrences.clear(); this.candidates.clear(); this.membership.clear(); this.dirtyGroups.clear();
    this.activeCounts.clear(); this.activeKeys = []; this.nextKey = 0;
    if (ctx?.mode !== "tui") return;
    this.cwd = ctx.cwd ?? ctx.sessionManager.getCwd();
    const visit = (message: SourceMessage & { toolCallId?: string; toolName?: string; isError?: boolean }) => {
      if (message.role === "assistant") this.discover(message, true);
      else if (message.role === "toolResult" && message.toolName === "read" && typeof message.toolCallId === "string") {
        this.result(message.toolCallId, message as unknown as ReadResult, "message", Boolean(message.isError));
      }
    };
    if (messages) {
      for (const message of messages) visit(message);
    } else {
      for (const entry of ctx.sessionManager.buildContextEntries()) {
        for (const message of sessionEntryToContextMessages(entry)) visit(message);
      }
    }
    this.activeCounts = new Map(); this.activeKeys = [];
  }

  discover(message: SourceMessage, start = false): void {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    if (start) { this.activeCounts = new Map(); this.activeKeys = []; }
    const counts = new Map<string, number>();
    for (const block of message.content) if (block?.type === "toolCall" && typeof block.id === "string") {
      counts.set(block.id, (counts.get(block.id) ?? 0) + 1);
    }
    const dirty = new Set<number>();
    // Updates/end are snapshots of the current assistant message, not new occurrences.
    for (const id of new Set([...this.activeCounts.keys(), ...counts.keys()])) {
      const delta = (counts.get(id) ?? 0) - (this.activeCounts.get(id) ?? 0);
      if (!delta) continue;
      const total = (this.occurrences.get(id) ?? 0) + delta;
      if (total) this.occurrences.set(id, total); else this.occurrences.delete(id);
      const key = this.membership.get(id);
      if (key !== undefined) dirty.add(key);
    }
    this.activeCounts = counts;
    const next: string[][] = [];
    let current: string[] | undefined;
    for (const block of message.content) {
      if (block?.type !== "toolCall" || block.name !== "read" || typeof block.id !== "string"
        || this.occurrences.get(block.id) !== 1) { current = undefined; continue; }
      let record = this.records.get(block.id);
      if (!record) {
        record = Object.assign(this.createMember(block.id), { known: false });
        this.records.set(block.id, record);
      }
      if (RESULT_PRIORITY[record.origin] < RESULT_PRIORITY.execution) this.setArgs(record, block.arguments, this.cwd);
      if (!current) next.push(current = []);
      current.push(block.id);
    }
    const keys: number[] = [];
    for (let index = 0; index < Math.max(this.activeKeys.length, next.length); index++) {
      const key = this.activeKeys[index] ?? this.nextKey++;
      const previous = this.candidates.get(key) ?? [], ids = next[index] ?? [];
      if (ids.length) keys.push(key);
      if (previous.length === ids.length && previous.every((id, i) => id === ids[i])) continue;
      for (const id of previous) if (this.membership.get(id) === key) {
        this.membership.delete(id);
        const member = this.records.get(id); if (member) this.assign([member]);
      }
      if (!ids.length) this.candidates.delete(key);
      else {
        this.candidates.set(key, ids);
        for (const id of ids) this.membership.set(id, key);
        dirty.add(key);
      }
    }
    this.activeKeys = keys;
    for (const key of dirty) this.reflow(key);
  }

  start(id: string, args: unknown): void {
    const record = this.unique(id);
    if (!record || RESULT_PRIORITY[record.origin] >= RESULT_PRIORITY.execution) return;
    this.setArgs(record, args, this.cwd);
    record.known = true;
    if (record.status !== "running") { record.status = "running"; this.changed(record); }
    this.reflowMember(record);
  }

  result(id: string, result: ReadResult, source: Exclude<ResultOrigin, "row">, error: boolean): void {
    const record = this.unique(id);
    // message_end may replace the execution result. Never accept lower-priority replays;
    // settled sources are consumed once, while partial snapshots can keep advancing.
    if (!record || RESULT_PRIORITY[source] < RESULT_PRIORITY[record.origin]) return;
    if (source === record.origin && source !== "partial") return;
    const wasKnown = record.known, image = record.hasImage;
    record.known = true;
    this.setResult(record, result, source === "partial", error, source);
    if (!wasKnown || image !== record.hasImage) this.reflowMember(record);
  }

  bind(context: RenderContext): ReadView {
    const state = context.state as ReadRowState;
    if (state.readView) return state.readView;
    const local = this.createMember(context.toolCallId);
    const generation = this.generation;
    const view: ReadView = {
      current: () => this.resolve(local, generation),
      updateCall: context => this.updateCall(local, context),
      updateResult: (result, partial, error) => {
        if (local.cache.active) this.setResult(local, result, partial, error, "row");
      },
    };
    state.readView = view;
    if (!this.bound.has(context.toolCallId)) {
      this.bound.add(context.toolCallId);
      const key = this.membership.get(context.toolCallId);
      if (key !== undefined) this.reflow(key);
    }
    return view;
  }

  private updateCall(local: MutableMember, context: RenderContext): void {
    if (!local.cache.active) return;
    this.setArgs(local, context.args, context.cwd);
    const status = context.isError ? "failed" : !context.isPartial && local.content ? "completed"
      : context.executionStarted ? "running" : "pending";
    if (local.status !== status) { local.status = status; this.changed(local); }
  }

  private resolve(local: MutableMember, generation: number): ReadMember {
    if (generation !== this.generation || !local.cache.active) return local;
    const record = this.unique(local.id);
    const key = this.membership.get(local.id);
    if (key !== undefined && this.dirtyGroups.delete(key)) this.refreshGroup(key);
    return record?.known ? record : local;
  }

  private unique(id: string): ReadRecord | undefined {
    return this.occurrences.get(id) === 1 ? this.records.get(id) : undefined;
  }

  private createMember(id: string): MutableMember {
    const members: MutableMember[] = [];
    const member: MutableMember = {
      id, cache: this.cache.scope(), group: { members, version: 0 }, origin: "row",
      path: "", fullPath: "", status: "pending", revision: 0,
    };
    members.push(member);
    return member;
  }

  private setArgs(member: MutableMember, input: unknown, cwd: string): void {
    const args = input as { path?: unknown; offset?: number; limit?: number } | undefined;
    const fullPath = typeof args?.path === "string" ? args.path : "";
    const path = this.formatPath(fullPath, cwd);
    if (member.path === path && member.fullPath === fullPath && member.offset === args?.offset && member.limit === args?.limit) return;
    Object.assign(member, { path, fullPath, offset: args?.offset, limit: args?.limit }); this.changed(member);
  }

  private setResult(member: MutableMember, result: ReadResult, partial: boolean, error: boolean, origin: ResultOrigin): void {
    const status = partial ? "running" : error ? "failed" : "completed";
    const details = result.details && typeof result.details === "object" ? result.details as ReadToolDetails : undefined;
    // A higher-priority source may have edited the same payload in place.
    if (member.origin === origin && member.content === result.content && member.details === details && member.status === status) return;
    member.origin = origin;
    member.content = result.content; member.details = details; member.status = status;
    member.hasImage = result.content?.some(block => block.type === "image") ?? false;
    this.changed(member);
  }

  private reflowMember(member: MutableMember): void {
    const key = this.membership.get(member.id);
    if (key !== undefined) this.reflow(key);
  }

  private reflow(key: number): void { this.dirtyGroups.add(key); }

  private refreshGroup(key: number): void {
    // Coalesce source, result and binding changes until the next paint.
    let segment: MutableMember[] = [];
    const flush = () => { if (segment.length) this.assign(segment); segment = []; };
    for (const id of this.candidates.get(key) ?? []) {
      const member = this.records.get(id);
      if (!member || !this.bound.has(id) || !member.known || this.occurrences.get(id) !== 1 || member.hasImage) {
        flush(); if (member) this.assign([member]);
      } else segment.push(member);
    }
    flush();
  }

  private assign(members: MutableMember[]): void {
    const previous = members[0]?.group;
    if (previous?.members.length === members.length && previous.members.every((member, i) => member === members[i])) return;
    const group = { members, version: 0 };
    for (const member of members) member.group = group;
  }

  private changed(member: MutableMember): void { member.revision++; member.group.version++; }
}
