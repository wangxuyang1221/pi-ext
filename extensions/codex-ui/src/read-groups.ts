import { sessionEntryToContextMessages, type ExtensionContext, type ReadToolDetails, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { RenderCacheScope, ToolRenderCache } from "./render-cache.js";

type RenderContext = Parameters<NonNullable<ToolDefinition["renderCall"]>>[2];
export interface ReadMember {
  id: string;
  cache: RenderCacheScope;
  group: ReadMember[];
  path: string;
  fullPath: string;
  offset?: number;
  limit?: number;
  status: "pending" | "running" | "completed" | "failed";
  content?: Array<{ type: string; text?: string }>;
  details?: ReadToolDetails;
  revision: number;
  hasImage?: boolean;
  component?: Component;
  invalidate?: () => void;
}
export interface ReadRowState { readMember?: ReadMember }

/** Discover adjacency from assistant source blocks; never infer it from result arrival. */
export class ReadGroups {
  private readonly members = new Map<string, ReadMember>();
  private readonly candidates = new Map<string, string[]>();
  private readonly membership = new Map<string, string>();
  private active: string[] = [];
  private notifying = false;

  constructor(private readonly cache: ToolRenderCache) {}

  reset(ctx?: ExtensionContext, preserveBound = false): void {
    if (!preserveBound) {
      for (const member of this.members.values()) member.invalidate = undefined;
      this.members.clear();
    }
    this.candidates.clear(); this.membership.clear(); this.active = [];
    if (preserveBound) for (const member of this.members.values()) this.assign([member]);
    if (ctx?.mode !== "tui") return;
    for (const entry of ctx.sessionManager.buildContextEntries()) {
      for (const message of sessionEntryToContextMessages(entry)) {
        if (message.role === "assistant") this.discover(message, true);
      }
    }
    this.active = [];
  }

  discover(message: { role: string; content?: unknown }, start = false): void {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    if (start) this.active = [];
    const next: string[][] = [];
    let current: string[] | undefined;
    const seen = new Set<string>();
    for (const block of message.content) {
      if (block?.type === "toolCall" && block.name === "read" && typeof block.id === "string" && !seen.has(block.id)) {
        seen.add(block.id);
        if (!current) next.push(current = []);
        current.push(block.id);
      } else current = undefined;
    }
    const nextKeys = new Set(next.map(ids => ids[0]!));
    for (const key of this.active) if (!nextKeys.has(key)) {
      for (const id of this.candidates.get(key) ?? []) {
        this.membership.delete(id);
        const member = this.members.get(id);
        if (member) this.assign([member]);
      }
      this.candidates.delete(key);
    }
    for (const ids of next) {
      const key = ids[0]!;
      const previous = this.candidates.get(key);
      if (previous?.length === ids.length && previous.every((id, index) => id === ids[index])) continue;
      const retained = new Set(ids);
      for (const id of previous ?? []) if (!retained.has(id)) {
        this.membership.delete(id);
        const member = this.members.get(id);
        if (member) this.assign([member]);
      }
      this.candidates.set(key, ids);
      for (const id of ids) this.membership.set(id, key);
      this.reflow(key);
    }
    this.active = [...nextKeys];
  }

  bind(context: RenderContext): ReadMember {
    const state = context.state as ReadRowState;
    if (state.readMember) return state.readMember;
    const member: ReadMember = { id: context.toolCallId, cache: this.cache.scope(), group: [],
      path: "", fullPath: "", status: "pending", revision: 0, hasImage: false };
    state.readMember = member;
    member.group = [member];
    // A second row with the same ID has no unambiguous owner. Keep it independent.
    if (!this.members.has(member.id)) {
      this.members.set(member.id, member);
      const key = this.membership.get(member.id);
      if (key) this.reflow(key);
    }
    return member;
  }

  updateCall(member: ReadMember, context: RenderContext, component: Component, path: string): void {
    if (!member.cache.active) return;
    member.component = component;
    member.invalidate = context.invalidate;
    const args = context.args as { path?: unknown; offset?: number; limit?: number };
    const fullPath = typeof args.path === "string" ? args.path : "";
    const status = context.isError ? "failed" : !context.isPartial && member.content ? "completed"
      : context.executionStarted ? "running" : "pending";
    if (member.path !== path || member.fullPath !== fullPath || member.offset !== args.offset || member.limit !== args.limit || member.status !== status) {
      Object.assign(member, { path, fullPath, offset: args.offset, limit: args.limit, status });
      this.changed(member);
    }
  }

  updateResult(member: ReadMember, result: Pick<ReadMember, "content" | "details">, isPartial: boolean, isError: boolean): void {
    if (!member.cache.active) return;
    const status = isError ? "failed" : isPartial ? member.status : "completed";
    if (member.content !== result.content || member.details !== result.details || member.status !== status) {
      member.content = result.content; member.details = result.details; member.status = status; member.revision++;
      const hasImage = result.content?.some(block => block.type === "image") ?? false;
      if (member.hasImage !== hasImage) {
        member.hasImage = hasImage;
        const key = this.membership.get(member.id);
        if (key) this.reflow(key);
      }
      this.changed(member);
    }
  }

  private reflow(key: string): void {
    let segment: ReadMember[] = [];
    const flush = () => { if (segment.length) this.assign(segment); segment = []; };
    for (const id of this.candidates.get(key) ?? []) {
      const member = this.members.get(id);
      if (member?.hasImage) {
        // Attachments are rendered by the host outside our component. Keep their row intact.
        flush(); this.assign([member]);
      } else if (member) segment.push(member);
      else flush(); // A row we do not own must not be hidden or crossed.
    }
    flush();
  }

  private assign(members: ReadMember[]): void {
    for (const member of members) member.group = members;
    for (const member of members) this.notify(member);
  }

  private changed(member: ReadMember): void {
    const owner = member.group[0]!;
    owner.component?.invalidate();
    if (owner !== member) this.notify(owner);
  }

  private notify(member: ReadMember): void {
    member.component?.invalidate();
    if (this.notifying || !member.cache.active) return;
    this.notifying = true;
    try { member.invalidate?.(); } finally { this.notifying = false; }
  }
}
