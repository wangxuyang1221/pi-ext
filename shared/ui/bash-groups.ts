import { sessionEntryToContextMessages, type BashToolDetails, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
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
  component?: Component;
  invalidate?: () => void;
}
export interface BashGroup {
  members: BashMember[];
}
export interface BashGroupRowState { bashMember?: BashMember }
interface Candidate { ids: string[]; positions: Map<string, number> }
interface SourceMessage { role: string; content?: unknown }

/** Session-local ownership. Only bound rows may hide behind another row. */
export class BashGroups {
  private readonly members = new Map<string, BashMember>();
  private readonly candidates = new Map<string, Candidate>();
  private readonly membership = new Map<string, string>();
  private readonly ambiguousIds = new Set<string>();
  private activeCandidates: string[] = [];
  private notifying = false;

  constructor(private readonly cache: ToolRenderCache) {}

  reset(ctx?: ExtensionContext, preserveBound = false, messages?: Iterable<SourceMessage>): void {
    if (!preserveBound) {
      for (const member of this.members.values()) {
        member.invalidate = undefined;
      }
      this.members.clear();
    }
    this.candidates.clear(); this.membership.clear(); this.ambiguousIds.clear(); this.activeCandidates = [];
    if (ctx?.mode !== "tui") return;
    if (messages) {
      for (const message of messages) {
        if (message.role === "assistant") this.discover(message, true);
      }
    } else {
      for (const entry of ctx.sessionManager.buildContextEntries()) {
        for (const message of sessionEntryToContextMessages(entry)) {
          if (message.role === "assistant") this.discover(message, true);
        }
      }
    }
    this.activeCandidates = [];
  }

  discover(message: SourceMessage, start = false): void {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    if (start) this.activeCandidates = [];
    const next: string[][] = [];
    let current: string[] | undefined;
    const seen = new Set<string>();
    const activeKeys = new Set(this.activeCandidates);
    for (const block of message.content) {
      if (block?.type !== "toolCall" || block.name !== "bash" || typeof block.id !== "string") {
        current = undefined;
        continue;
      }
      const existingKey = this.membership.get(block.id);
      const historical = existingKey !== undefined && !activeKeys.has(existingKey);
      if (seen.has(block.id) || historical) {
        // Even an unbound first occurrence reserves its historical slot.
        // Existing owners stay put; no later binding may claim an ambiguous ID.
        this.ambiguousIds.add(block.id);
        current = undefined;
        continue;
      }
      seen.add(block.id);
      if (!current) next.push(current = []);
      current.push(block.id);
    }
    const nextKeys = new Set(next.map(ids => ids[0]!));
    for (const id of this.activeCandidates) {
      if (nextKeys.has(id)) continue;
      const previous = this.candidates.get(id);
      for (const memberId of previous?.ids ?? []) {
        this.membership.delete(memberId);
        const member = this.members.get(memberId);
        if (member) this.assign([member], true);
      }
      this.candidates.delete(id);
    }
    for (const ids of next) {
      const key = ids[0]!;
      const previous = this.candidates.get(key);
      if (previous?.ids.length === ids.length && previous.ids.every((id, index) => id === ids[index])) continue;
      const retained = new Set(ids);
      for (const id of previous?.ids ?? []) if (!retained.has(id)) {
        this.membership.delete(id);
        const member = this.members.get(id);
        if (member) this.assign([member], true);
      }
      const positions = new Map<string, number>();
      for (let index = 0; index < ids.length; index++) positions.set(ids[index]!, index);
      this.candidates.set(key, { ids, positions });
      for (const id of ids) this.membership.set(id, key);
      this.reflow(key, true);
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
    const tracked = !this.ambiguousIds.has(member.id) && !this.members.has(member.id);
    if (tracked) this.members.set(member.id, member);
    member.group = { members: [member] };
    const candidateKey = tracked ? this.membership.get(member.id) : undefined;
    if (candidateKey) this.attach(member, candidateKey);
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
      member.status = status;
      changed = true;
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

  /** Incrementally merge a newly bound member with its immediate bound neighbors in the candidate run. */
  private attach(member: BashMember, key: string): void {
    const candidate = this.candidates.get(key);
    const pos = candidate?.positions.get(member.id);
    if (!candidate || pos === undefined) return;
    const leftId = pos > 0 ? candidate.ids[pos - 1] : undefined;
    const rightId = pos + 1 < candidate.ids.length ? candidate.ids[pos + 1] : undefined;
    const left = leftId !== undefined && this.membership.get(leftId) === key ? this.members.get(leftId) : undefined;
    const right = rightId !== undefined && this.membership.get(rightId) === key ? this.members.get(rightId) : undefined;
    if (left && !right) {
      // Common sequential binding fast path: append in O(1) without rescanning or cascading host invalidations.
      left.group.members.push(member);
      member.group = left.group;
      left.group.members[0]?.component?.invalidate();
      return;
    }
    if (left && right) {
      const target = left.group;
      const merged = right.group.members;
      target.members.push(member, ...merged);
      member.group = target;
      for (const item of merged) item.group = target;
      target.members[0]?.component?.invalidate();
      right.component?.invalidate();
      return;
    }
    if (right) {
      const merged = [member, ...right.group.members];
      const group: BashGroup = { members: merged };
      for (const item of merged) item.group = group;
      right.component?.invalidate();
    }
  }

  private reflow(key: string, notifyHost: boolean): void {
    let segment: BashMember[] = [];
    const flush = () => { if (segment.length) this.assign(segment, notifyHost); segment = []; };
    const seen = new Set<string>();
    for (const id of this.candidates.get(key)?.ids ?? []) {
      // Extra rows with ambiguous IDs bind independently. Never reuse the first
      // row's member for a second source occurrence or group across that row.
      if (seen.has(id)) { flush(); continue; }
      seen.add(id);
      const member = this.members.get(id);
      if (member) segment.push(member);
      else flush(); // Unbound rows remain visible barriers.
    }
    flush();
  }

  private assign(members: BashMember[], notifyHost: boolean): void {
    const previous = members[0]?.group;
    if (previous?.members.length === members.length && previous.members.every((member, index) => member === members[index])) {
      return;
    }
    const formerOwners = new Set<BashMember>();
    for (const member of members) {
      const owner = member.group?.members[0];
      if (owner) formerOwners.add(owner);
    }
    const group: BashGroup = { members };
    for (const member of members) member.group = group;
    const owner = members[0];
    if (owner) formerOwners.add(owner);
    // Only invalidate/notify rows whose visible ownership or owned group changed, never unchanged followers.
    for (const affected of formerOwners) {
      affected.component?.invalidate();
      if (notifyHost) this.notify(affected);
    }
  }

  private changed(member: BashMember): void {
    const owner = member.group.members[0]!;
    owner.component?.invalidate();
  }

  private notify(member: BashMember): void {
    member.component?.invalidate();
    if (this.notifying || !member.cache.active) return;
    this.notifying = true;
    try { member.invalidate?.(); } finally { this.notifying = false; }
  }
}
