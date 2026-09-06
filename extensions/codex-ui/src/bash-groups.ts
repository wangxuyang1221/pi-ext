import { sessionEntryToContextMessages, type BashToolDetails, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { BashRefreshScheduler } from "./bash-refresh-scheduler.js";
import type { RenderCacheScope, ToolRenderCache } from "./render-cache.js";

type ToolRenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];

export type BashStatus = "pending" | "running" | "completed" | "failed";
export interface BashMember {
  id: string;
  cache: RenderCacheScope;
  group: BashGroup;
  command: string;
  commandRevision: number;
  outputRevision: number;
  status: BashStatus;
  content?: Array<{ type: string; text?: string }>;
  details?: BashToolDetails;
  startedAt?: number;
  endedAt?: number;
  component?: Component;
  invalidate?: () => void;
}
export interface BashGroup {
  timerKey: string;
  members: BashMember[];
  counts: Record<BashStatus, number>;
  running: Set<BashMember>;
}
export interface BashGroupRowState { bashMember?: BashMember }
interface Candidate { ids: string[] }
interface SourceMessage { role: string; content?: unknown }

/** Session-local ownership. Only bound full-mode rows may hide behind another row. */
export class BashGroups {
  private readonly members = new Map<string, BashMember>();
  private readonly candidates = new Map<string, Candidate>();
  private readonly membership = new Map<string, string>();
  private activeCandidates: string[] = [];
  private notifying = false;
  private nextGroup = 0;

  constructor(private readonly cache: ToolRenderCache, private readonly scheduler: BashRefreshScheduler) {}

  reset(ctx?: ExtensionContext, preserveBound = false): void {
    if (!preserveBound) {
      for (const member of this.members.values()) {
        this.scheduler.untrack(member.group.timerKey);
        member.invalidate = undefined;
      }
      this.members.clear();
    }
    this.candidates.clear(); this.membership.clear(); this.activeCandidates = [];
    if (ctx?.mode !== "tui") return;
    for (const entry of ctx.sessionManager.buildContextEntries()) {
      for (const message of sessionEntryToContextMessages(entry)) {
        if (message.role === "assistant") this.discover(message, true);
      }
    }
    this.activeCandidates = [];
  }

  discover(message: SourceMessage, start = false): void {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    if (start) this.activeCandidates = [];
    const next: string[][] = [];
    let current: string[] | undefined;
    for (const block of message.content) {
      if (block?.type === "toolCall" && block.name === "bash" && typeof block.id === "string") {
        if (!current) next.push(current = []);
        current.push(block.id);
      } else current = undefined;
    }
    const nextKeys = new Set(next.map(ids => ids[0]!));
    for (const id of this.activeCandidates) {
      if (nextKeys.has(id)) continue;
      const previous = this.candidates.get(id);
      for (const memberId of previous?.ids ?? []) {
        this.membership.delete(memberId);
        const member = this.members.get(memberId);
        if (member) this.assign([member]);
      }
      this.candidates.delete(id);
    }
    for (const ids of next) {
      const key = ids[0]!;
      const previous = this.candidates.get(key);
      if (previous?.ids.length === ids.length && previous.ids.every((id, index) => id === ids[index])) continue;
      for (const id of previous?.ids ?? []) if (!ids.includes(id)) {
        this.membership.delete(id);
        const member = this.members.get(id);
        if (member) this.assign([member]);
      }
      this.candidates.set(key, { ids });
      for (const id of ids) this.membership.set(id, key);
      this.reflow(key);
    }
    this.activeCandidates = [...nextKeys];
  }

  bind(context: ToolRenderContext & { state: BashGroupRowState }): BashMember {
    const state = context.state;
    if (state.bashMember) return state.bashMember;
    const member: BashMember = {
      id: context.toolCallId, cache: this.cache.scope(), group: undefined!, command: "",
      commandRevision: 0, outputRevision: 0, status: "pending",
    };
    state.bashMember = member;
    // Duplicate IDs have ambiguous ownership. Keep the extra component independent.
    if (!this.members.has(member.id)) this.members.set(member.id, member);
    this.assign([member]);
    const candidate = this.membership.get(member.id);
    if (candidate && this.members.get(member.id) === member) this.reflow(candidate);
    return member;
  }

  updateCall(member: BashMember, context: ToolRenderContext, component: Component): void {
    if (!member.cache.active) return;
    member.component = component;
    member.invalidate = context.invalidate;
    let changed = false;
    const args = context.args as { command?: unknown } | undefined;
    const command = typeof args?.command === "string" ? args.command : "";
    if (member.command !== command) { member.command = command; member.commandRevision++; changed = true; }
    const status: BashStatus = context.isError ? "failed" : !context.isPartial ? "completed"
      : context.executionStarted ? "running" : "pending";
    if (status !== member.status) {
      member.group.counts[member.status]--;
      member.group.counts[status]++;
      member.group.running.delete(member);
      if (status === "running") {
        member.startedAt ??= Date.now();
        member.group.running.add(member);
      } else if (member.startedAt !== undefined) member.endedAt ??= Date.now();
      member.status = status;
      changed = true;
      this.schedule(member.group);
    }
    if (changed) this.changed(member);
  }

  updateResult(member: BashMember, result: { content: BashMember["content"]; details?: BashToolDetails }): void {
    if (!member.cache.active) return;
    const changed = member.content !== result.content || member.details !== result.details;
    if (member.content !== result.content) { member.content = result.content; member.outputRevision++; }
    member.details = result.details;
    if (changed) this.changed(member);
  }

  private reflow(key: string): void {
    let segment: BashMember[] = [];
    const flush = () => { if (segment.length) this.assign(segment); segment = []; };
    for (const id of this.candidates.get(key)?.ids ?? []) {
      const member = this.members.get(id);
      if (member) segment.push(member);
      else flush(); // Unbound or low-power rows remain visible barriers.
    }
    flush();
  }

  private assign(members: BashMember[]): void {
    for (const member of members) if (member.group) this.scheduler.untrack(member.group.timerKey);
    const group: BashGroup = { timerKey: `group-${this.nextGroup++}`, members,
      counts: { pending: 0, running: 0, completed: 0, failed: 0 }, running: new Set() };
    for (const member of members) {
      member.group = group; group.counts[member.status]++;
      if (member.status === "running") group.running.add(member);
    }
    this.schedule(group);
    for (const member of members) this.notify(member);
  }

  private schedule(group: BashGroup): void {
    if (group.running.size) this.scheduler.track(group.timerKey, () => this.notify(group.members[0]!));
    else this.scheduler.untrack(group.timerKey);
  }

  private changed(member: BashMember): void {
    const owner = member.group.members[0]!;
    owner.component?.invalidate();
    if (owner !== member) this.notify(owner);
  }

  private notify(member: BashMember): void {
    member.component?.invalidate();
    if (this.notifying || !member.cache.active) return;
    this.notifying = true;
    try { member.invalidate?.(); } finally { this.notifying = false; }
  }
}
