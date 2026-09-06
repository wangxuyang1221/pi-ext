import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
/** Session-local ownership. Only bound full-mode rows may hide behind another row. */
export class BashGroups {
    cache;
    scheduler;
    members = new Map();
    candidates = new Map();
    membership = new Map();
    activeCandidates = [];
    notifying = false;
    nextGroup = 0;
    constructor(cache, scheduler) {
        this.cache = cache;
        this.scheduler = scheduler;
    }
    reset(ctx, preserveBound = false) {
        if (!preserveBound) {
            for (const member of this.members.values()) {
                this.scheduler.untrack(member.group.timerKey);
                member.invalidate = undefined;
            }
            this.members.clear();
        }
        this.candidates.clear();
        this.membership.clear();
        this.activeCandidates = [];
        if (ctx?.mode !== "tui")
            return;
        for (const entry of ctx.sessionManager.buildContextEntries()) {
            for (const message of sessionEntryToContextMessages(entry)) {
                if (message.role === "assistant")
                    this.discover(message, true);
            }
        }
        this.activeCandidates = [];
    }
    discover(message, start = false) {
        if (message.role !== "assistant" || !Array.isArray(message.content))
            return;
        if (start)
            this.activeCandidates = [];
        const next = [];
        let current;
        for (const block of message.content) {
            if (block?.type === "toolCall" && block.name === "bash" && typeof block.id === "string") {
                if (!current)
                    next.push(current = []);
                current.push(block.id);
            }
            else
                current = undefined;
        }
        const nextKeys = new Set(next.map(ids => ids[0]));
        for (const id of this.activeCandidates) {
            if (nextKeys.has(id))
                continue;
            const previous = this.candidates.get(id);
            for (const memberId of previous?.ids ?? []) {
                this.membership.delete(memberId);
                const member = this.members.get(memberId);
                if (member)
                    this.assign([member]);
            }
            this.candidates.delete(id);
        }
        for (const ids of next) {
            const key = ids[0];
            const previous = this.candidates.get(key);
            if (previous?.ids.length === ids.length && previous.ids.every((id, index) => id === ids[index]))
                continue;
            for (const id of previous?.ids ?? [])
                if (!ids.includes(id)) {
                    this.membership.delete(id);
                    const member = this.members.get(id);
                    if (member)
                        this.assign([member]);
                }
            this.candidates.set(key, { ids });
            for (const id of ids)
                this.membership.set(id, key);
            this.reflow(key);
        }
        this.activeCandidates = [...nextKeys];
    }
    bind(context) {
        const state = context.state;
        if (state.bashMember)
            return state.bashMember;
        const member = {
            id: context.toolCallId, cache: this.cache.scope(), group: undefined, command: "",
            commandRevision: 0, outputRevision: 0, status: "pending",
        };
        state.bashMember = member;
        // Duplicate IDs have ambiguous ownership. Keep the extra component independent.
        if (!this.members.has(member.id))
            this.members.set(member.id, member);
        this.assign([member]);
        const candidate = this.membership.get(member.id);
        if (candidate && this.members.get(member.id) === member)
            this.reflow(candidate);
        return member;
    }
    updateCall(member, context, component) {
        if (!member.cache.active)
            return;
        member.component = component;
        member.invalidate = context.invalidate;
        let changed = false;
        const args = context.args;
        const command = typeof args?.command === "string" ? args.command : "";
        if (member.command !== command) {
            member.command = command;
            member.commandRevision++;
            changed = true;
        }
        const status = context.isError ? "failed" : !context.isPartial ? "completed"
            : context.executionStarted ? "running" : "pending";
        if (status !== member.status) {
            member.group.counts[member.status]--;
            member.group.counts[status]++;
            member.group.running.delete(member);
            if (status === "running") {
                member.startedAt ??= Date.now();
                member.group.running.add(member);
            }
            else if (member.startedAt !== undefined)
                member.endedAt ??= Date.now();
            member.status = status;
            changed = true;
            this.schedule(member.group);
        }
        if (changed)
            this.changed(member);
    }
    updateResult(member, result) {
        if (!member.cache.active)
            return;
        const changed = member.content !== result.content || member.details !== result.details;
        if (member.content !== result.content) {
            member.content = result.content;
            member.outputRevision++;
        }
        member.details = result.details;
        if (changed)
            this.changed(member);
    }
    reflow(key) {
        let segment = [];
        const flush = () => { if (segment.length)
            this.assign(segment); segment = []; };
        for (const id of this.candidates.get(key)?.ids ?? []) {
            const member = this.members.get(id);
            if (member)
                segment.push(member);
            else
                flush(); // Unbound or low-power rows remain visible barriers.
        }
        flush();
    }
    assign(members) {
        for (const member of members)
            if (member.group)
                this.scheduler.untrack(member.group.timerKey);
        const group = { timerKey: `group-${this.nextGroup++}`, members,
            counts: { pending: 0, running: 0, completed: 0, failed: 0 }, running: new Set() };
        for (const member of members) {
            member.group = group;
            group.counts[member.status]++;
            if (member.status === "running")
                group.running.add(member);
        }
        this.schedule(group);
        for (const member of members)
            this.notify(member);
    }
    schedule(group) {
        if (group.running.size)
            this.scheduler.track(group.timerKey, () => this.notify(group.members[0]));
        else
            this.scheduler.untrack(group.timerKey);
    }
    changed(member) {
        const owner = member.group.members[0];
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
//# sourceMappingURL=bash-groups.js.map