import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
/** Discover adjacency from assistant source blocks; never infer it from result arrival. */
export class ReadGroups {
    cache;
    members = new Map();
    candidates = new Map();
    membership = new Map();
    active = [];
    notifying = false;
    constructor(cache) {
        this.cache = cache;
    }
    reset(ctx, preserveBound = false) {
        if (!preserveBound) {
            for (const member of this.members.values())
                member.invalidate = undefined;
            this.members.clear();
        }
        this.candidates.clear();
        this.membership.clear();
        this.active = [];
        if (preserveBound)
            for (const member of this.members.values())
                this.assign([member]);
        if (ctx?.mode !== "tui")
            return;
        for (const entry of ctx.sessionManager.buildContextEntries()) {
            for (const message of sessionEntryToContextMessages(entry)) {
                if (message.role === "assistant")
                    this.discover(message, true);
            }
        }
        this.active = [];
    }
    discover(message, start = false) {
        if (message.role !== "assistant" || !Array.isArray(message.content))
            return;
        if (start)
            this.active = [];
        const next = [];
        let current;
        const seen = new Set();
        for (const block of message.content) {
            if (block?.type === "toolCall" && block.name === "read" && typeof block.id === "string" && !seen.has(block.id)) {
                seen.add(block.id);
                if (!current)
                    next.push(current = []);
                current.push(block.id);
            }
            else
                current = undefined;
        }
        const nextKeys = new Set(next.map(ids => ids[0]));
        for (const key of this.active)
            if (!nextKeys.has(key)) {
                for (const id of this.candidates.get(key) ?? []) {
                    this.membership.delete(id);
                    const member = this.members.get(id);
                    if (member)
                        this.assign([member]);
                }
                this.candidates.delete(key);
            }
        for (const ids of next) {
            const key = ids[0];
            const previous = this.candidates.get(key);
            if (previous?.length === ids.length && previous.every((id, index) => id === ids[index]))
                continue;
            const retained = new Set(ids);
            for (const id of previous ?? [])
                if (!retained.has(id)) {
                    this.membership.delete(id);
                    const member = this.members.get(id);
                    if (member)
                        this.assign([member]);
                }
            this.candidates.set(key, ids);
            for (const id of ids)
                this.membership.set(id, key);
            this.reflow(key);
        }
        this.active = [...nextKeys];
    }
    bind(context) {
        const state = context.state;
        if (state.readMember)
            return state.readMember;
        const member = { id: context.toolCallId, cache: this.cache.scope(), group: [],
            path: "", fullPath: "", status: "pending", revision: 0, hasImage: false };
        state.readMember = member;
        member.group = [member];
        // A second row with the same ID has no unambiguous owner. Keep it independent.
        if (!this.members.has(member.id)) {
            this.members.set(member.id, member);
            const key = this.membership.get(member.id);
            if (key)
                this.reflow(key);
        }
        return member;
    }
    updateCall(member, context, component, path) {
        if (!member.cache.active)
            return;
        member.component = component;
        member.invalidate = context.invalidate;
        const args = context.args;
        const fullPath = typeof args.path === "string" ? args.path : "";
        const status = context.isError ? "failed" : !context.isPartial && member.content ? "completed"
            : context.executionStarted ? "running" : "pending";
        if (member.path !== path || member.fullPath !== fullPath || member.offset !== args.offset || member.limit !== args.limit || member.status !== status) {
            Object.assign(member, { path, fullPath, offset: args.offset, limit: args.limit, status });
            this.changed(member);
        }
    }
    updateResult(member, result, isPartial, isError) {
        if (!member.cache.active)
            return;
        const status = isError ? "failed" : isPartial ? member.status : "completed";
        if (member.content !== result.content || member.details !== result.details || member.status !== status) {
            member.content = result.content;
            member.details = result.details;
            member.status = status;
            member.revision++;
            const hasImage = result.content?.some(block => block.type === "image") ?? false;
            if (member.hasImage !== hasImage) {
                member.hasImage = hasImage;
                const key = this.membership.get(member.id);
                if (key)
                    this.reflow(key);
            }
            this.changed(member);
        }
    }
    reflow(key) {
        let segment = [];
        const flush = () => { if (segment.length)
            this.assign(segment); segment = []; };
        for (const id of this.candidates.get(key) ?? []) {
            const member = this.members.get(id);
            if (member?.hasImage) {
                // Attachments are rendered by the host outside our component. Keep their row intact.
                flush();
                this.assign([member]);
            }
            else if (member)
                segment.push(member);
            else
                flush(); // A row we do not own must not be hidden or crossed.
        }
        flush();
    }
    assign(members) {
        for (const member of members)
            member.group = members;
        for (const member of members)
            this.notify(member);
    }
    changed(member) {
        const owner = member.group[0];
        owner.component?.invalidate();
        if (owner !== member)
            this.notify(owner);
    }
    notify(member) {
        member.component?.invalidate();
        if (this.notifying || !member.cache.active)
            return;
        this.notifying = true;
        try {
            member.invalidate?.();
        }
        finally {
            this.notifying = false;
        }
    }
}
//# sourceMappingURL=read-groups.js.map