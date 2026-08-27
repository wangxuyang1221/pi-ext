import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { encodeSettledCursor } from "./cursor.js";
import { getDirectChild, markDirectChildClosed, registerDirectChild, removeDirectChildren, } from "./ownership.js";
import { readSessionView, } from "./session-reader.js";
import { waitForSettled, } from "./wait.js";
export const PI_SUBAGENT_STATE_ROOT = "PI_SUBAGENT_STATE_ROOT";
export const PI_SUBAGENT_PARENT = "PI_SUBAGENT_PARENT";
export const PI_SUBAGENT_LAUNCH = "PI_SUBAGENT_LAUNCH";
export class SubagentManager {
    store;
    runtime;
    stateRoot;
    nativeSessionRoot;
    extensionPath;
    piPath;
    environment;
    createId;
    now;
    sleep;
    registrationTimeoutMs;
    pollIntervalMs;
    closeTimeoutMs;
    constructor(options) {
        this.store = options.store;
        this.runtime = options.runtime;
        this.stateRoot = options.stateRoot;
        this.nativeSessionRoot = options.nativeSessionRoot;
        this.extensionPath = options.extensionPath;
        this.piPath = options.piPath;
        this.environment = options.environment;
        this.createId = options.createId ?? randomUUID;
        this.now = options.now ?? (() => new Date().toISOString());
        this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolveDelay) => {
            setTimeout(resolveDelay, milliseconds);
        }));
        this.registrationTimeoutMs = options.registrationTimeoutMs ?? 10_000;
        this.pollIntervalMs = options.pollIntervalMs ?? 50;
        this.closeTimeoutMs = options.closeTimeoutMs ?? 5_000;
    }
    async spawn(parentSessionId, options, defaults) {
        const parent = await this.requireSession(parentSessionId);
        const registrationToken = this.createId();
        const processInstanceId = this.createId();
        const displayName = options.name?.trim() || `Subagent ${parent.children.length + 1}`;
        const cwd = resolve(defaults.cwd, options.cwd ?? ".");
        const model = options.model ?? defaults.model;
        const thinkingLevel = options.thinkingLevel ?? defaults.thinkingLevel;
        const sessionDir = join(this.nativeSessionRoot, parent.sessionId, processInstanceId);
        const parentOwnership = {
            sessionId: parent.sessionId,
            epoch: parent.epoch,
            registrationToken,
        };
        const launch = {
            cwd,
            sessionDir,
            ...(model ? { model } : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
            displayName,
            processInstanceId,
        };
        const args = [
            "--session-dir",
            sessionDir,
            "--name",
            displayName,
            "--extension",
            this.extensionPath,
            ...(model ? ["--model", model] : []),
            ...(thinkingLevel ? ["--thinking", thinkingLevel] : []),
        ];
        const locator = await this.runtime.launch({
            cwd,
            windowName: normalizeWindowName(displayName),
            command: this.piPath,
            args,
            environment: {
                ...this.environment,
                PI_SUBAGENT: "1",
                PI_SUBAGENT_ID: processInstanceId,
                [PI_SUBAGENT_STATE_ROOT]: this.stateRoot,
                [PI_SUBAGENT_PARENT]: JSON.stringify(parentOwnership),
                [PI_SUBAGENT_LAUNCH]: JSON.stringify(launch),
            },
        });
        try {
            const child = await this.waitForRegistration(parent, processInstanceId, registrationToken);
            await this.store.update(parent.sessionId, (latestParent) => (registerDirectChild(latestParent, child, this.now())));
            await this.runtime.sendPrompt(child.runtime.tmux ?? locator, options.task, "steer");
            return toManagedAgent(child);
        }
        catch (error) {
            await this.runtime.close(locator).catch(() => undefined);
            throw error;
        }
    }
    async close(parentSessionId, target) {
        await this.reconcileOwnedSessions(parentSessionId);
        const parent = await this.requireSession(parentSessionId);
        const roots = targetLinks(parent, target);
        const states = await this.collectSubtree(roots);
        const affected = await this.closeStates(states);
        const rootIds = new Set(roots.map((child) => child.agentId));
        await this.store.update(parentSessionId, (latestParent) => {
            let updated = latestParent;
            for (const agentId of rootIds) {
                updated = markDirectChildClosed(updated, agentId, this.now());
            }
            return updated;
        });
        return affected;
    }
    async forget(parentSessionId, target) {
        await this.reconcileOwnedSessions(parentSessionId);
        const parent = await this.requireSession(parentSessionId);
        const roots = targetLinks(parent, target);
        const states = await this.collectSubtree(roots);
        const affected = await this.closeStates(states);
        const rootIds = new Set(roots.map((child) => child.agentId));
        await this.store.update(parentSessionId, (latestParent) => (removeDirectChildren(latestParent, rootIds)));
        for (const state of states) {
            await this.store.delete(state.sessionId);
        }
        return affected;
    }
    async wait(parentSessionId, agentId, options, signal) {
        const initial = await this.requireDirectSession(parentSessionId, agentId);
        const result = await waitForSettled({
            agentId,
            afterSettled: options.afterSettled,
            timeoutMs: options.timeoutMs,
            pollIntervalMs: this.pollIntervalMs,
            signal,
            readState: () => this.requireSession(agentId),
            wasClosed: async () => {
                const parent = await this.store.load(parentSessionId);
                return parent?.children.find((child) => child.agentId === agentId)?.closedAt !== undefined;
            },
            isAlive: async (state) => state.runtime.tmux !== undefined
                && this.runtime.isAlive(state.runtime.tmux),
            sleep: this.sleep,
        });
        const child = await this.requireSession(agentId);
        if (child.epoch !== initial.child.epoch) {
            throw new Error(`Managed child epoch changed while waiting: ${agentId}`);
        }
        let activity = [];
        let activityCursor;
        let assistantCount = 0;
        let toolCount = 0;
        if (result.outcome === "settled") {
            const recent = await readSessionView({
                sessionFile: child.runtime.sessionFile,
                agentId,
                epoch: child.epoch,
                view: "recent_activity",
                assistantLimit: options.assistantLimit ?? 2,
                toolLimit: options.toolLimit ?? 3,
                ...(options.afterActivity ? { after: options.afterActivity } : {}),
                ...(child.runtime.leafId ? { leafId: child.runtime.leafId } : {}),
            });
            if (recent.view !== "recent_activity") {
                throw new Error("Internal error: wait activity projection returned the wrong view");
            }
            activity = recent.activity;
            activityCursor = recent.cursor;
            assistantCount = recent.assistantCount;
            toolCount = recent.toolCount;
        }
        const status = result.outcome === "settled"
            ? "settled"
            : result.outcome === "closed"
                ? "closed"
                : result.outcome === "interrupted"
                    ? "interrupted"
                    : child.runtime.status;
        return {
            ...result,
            agent: toManagedAgent(child, status),
            activity,
            ...(activityCursor ? { activityCursor } : {}),
            assistantCount,
            toolCount,
        };
    }
    async read(parentSessionId, agentId, options) {
        const { child } = await this.requireDirectSession(parentSessionId, agentId);
        return readSessionView({
            ...options,
            sessionFile: child.runtime.sessionFile,
            agentId,
            epoch: child.epoch,
            ...(child.runtime.leafId && !child.runtime.busy
                ? { leafId: child.runtime.leafId }
                : {}),
        });
    }
    async list(parentSessionId) {
        await this.reconcileOwnedSessions(parentSessionId);
        const parent = await this.requireSession(parentSessionId);
        return Promise.all(parent.children.map(async (link) => {
            const child = await this.store.load(link.agentId);
            if (!child || child.epoch !== link.epoch) {
                return managedAgentFromLink(link, "interrupted");
            }
            if (link.closedAt !== undefined)
                return toManagedAgent(child, "closed");
            if (child.runtime.status === "closed"
                || child.runtime.status === "interrupted"
                || child.runtime.status === "errored") {
                return toManagedAgent(child);
            }
            const alive = child.runtime.tmux
                ? await this.runtime.isAlive(child.runtime.tmux)
                : false;
            return toManagedAgent(child, alive ? child.runtime.status : "interrupted");
        }));
    }
    async prompt(parentSessionId, agentId, text, delivery) {
        const parent = await this.requireSession(parentSessionId);
        const link = getDirectChild(parent, agentId);
        if (link.closedAt !== undefined) {
            throw new Error(`Managed child is closed: ${agentId}`);
        }
        const child = await this.requireSession(agentId);
        if (child.epoch !== link.epoch) {
            throw new Error(`Managed child epoch does not match its direct link: ${agentId}`);
        }
        if (child.runtime.status !== "running" && child.runtime.status !== "settled") {
            throw new Error(`Managed child is not running: ${agentId}`);
        }
        const locator = child.runtime.tmux;
        if (!locator || !await this.runtime.isAlive(locator)) {
            throw new Error(`Managed child runtime was interrupted: ${agentId}`);
        }
        await this.runtime.sendPrompt(locator, text, delivery);
        return toManagedAgent(child);
    }
    async resume(parentSessionId, agentId) {
        const parent = await this.requireSession(parentSessionId);
        const link = getDirectChild(parent, agentId);
        const child = await this.requireSession(agentId);
        const explicitlyClosed = link.closedAt !== undefined || child.runtime.status === "closed";
        if (!explicitlyClosed) {
            throw new Error(`Managed child is not closed: ${agentId}`);
        }
        if (child.runtime.tmux && await this.runtime.isAlive(child.runtime.tmux)) {
            throw new Error(`Managed child still has a live tmux process: ${agentId}`);
        }
        const registrationToken = this.createId();
        const processInstanceId = this.createId();
        const parentOwnership = {
            sessionId: parent.sessionId,
            epoch: parent.epoch,
            registrationToken,
        };
        const launch = {
            ...link.launch,
            processInstanceId,
        };
        const args = [
            "--session-dir",
            launch.sessionDir,
            "--session",
            link.sessionFile,
            "--name",
            link.name,
            "--extension",
            this.extensionPath,
            ...(launch.model ? ["--model", launch.model] : []),
            ...(launch.thinkingLevel ? ["--thinking", launch.thinkingLevel] : []),
        ];
        const locator = await this.runtime.launch({
            cwd: link.cwd,
            windowName: normalizeWindowName(link.name),
            command: this.piPath,
            args,
            environment: {
                ...this.environment,
                PI_SUBAGENT: "1",
                PI_SUBAGENT_ID: processInstanceId,
                [PI_SUBAGENT_STATE_ROOT]: this.stateRoot,
                [PI_SUBAGENT_PARENT]: JSON.stringify(parentOwnership),
                [PI_SUBAGENT_LAUNCH]: JSON.stringify(launch),
            },
        });
        try {
            const registered = await this.waitForRegistration(parent, processInstanceId, registrationToken, agentId);
            await this.store.update(parent.sessionId, (latestParent) => (registerDirectChild(latestParent, registered, this.now())));
            return toManagedAgent(registered);
        }
        catch (error) {
            await this.runtime.close(locator).catch(() => undefined);
            throw error;
        }
    }
    async collectSubtree(roots) {
        const allStates = await this.store.list();
        const ordered = [];
        const visiting = new Set();
        const visited = new Set();
        const visit = async (link) => {
            if (visited.has(link.agentId))
                return;
            if (visiting.has(link.agentId)) {
                throw new Error(`Invalid subagent ownership cycle at ${link.agentId}`);
            }
            visiting.add(link.agentId);
            const state = await this.requireSession(link.agentId);
            if (state.epoch !== link.epoch) {
                throw new Error(`Managed child epoch does not match its direct link: ${link.agentId}`);
            }
            const linkedIds = new Set(state.children.map((child) => child.agentId));
            const children = allStates
                .filter((candidate) => (!linkedIds.has(candidate.sessionId)
                && candidate.parent?.sessionId === state.sessionId
                && candidate.parent.epoch === state.epoch
                && candidate.launch !== undefined
                && candidate.runtime.tmux !== undefined))
                .reduce((owner, candidate) => registerDirectChild(owner, candidate, this.now()), state)
                .children;
            for (const child of children)
                await visit(child);
            visiting.delete(link.agentId);
            visited.add(link.agentId);
            ordered.push(state);
        };
        for (const root of roots)
            await visit(root);
        return ordered;
    }
    async closeStates(states) {
        const affected = [];
        for (const state of states) {
            const locator = state.runtime.tmux;
            const ownsLiveProcess = (state.runtime.status === "starting"
                || state.runtime.status === "running"
                || state.runtime.status === "settled");
            if (locator && ownsLiveProcess) {
                await this.runtime.close(locator);
                await this.confirmClosed(locator);
            }
            affected.push(toManagedAgent(state, "closed"));
        }
        return affected;
    }
    async confirmClosed(locator) {
        const deadline = Date.now() + this.closeTimeoutMs;
        while (await this.runtime.isAlive(locator)) {
            if (Date.now() >= deadline) {
                throw new Error(`Timed out waiting for tmux window to close: ${locator.windowId}`);
            }
            await this.sleep(this.pollIntervalMs);
        }
    }
    async requireDirectSession(parentSessionId, agentId) {
        await this.reconcileOwnedSessions(parentSessionId);
        const parent = await this.requireSession(parentSessionId);
        const link = getDirectChild(parent, agentId);
        const child = await this.requireSession(agentId);
        if (child.epoch !== link.epoch) {
            throw new Error(`Managed child epoch does not match its direct link: ${agentId}`);
        }
        return { parent, child };
    }
    async reconcileOwnedSessions(parentSessionId) {
        const parent = await this.requireSession(parentSessionId);
        const linkedIds = new Set(parent.children.map((child) => child.agentId));
        const discovered = (await this.store.list()).filter((state) => (!linkedIds.has(state.sessionId)
            && state.parent?.sessionId === parent.sessionId
            && state.parent.epoch === parent.epoch
            && state.launch !== undefined
            && state.runtime.tmux !== undefined));
        if (discovered.length === 0)
            return;
        await this.store.update(parent.sessionId, (latestParent) => discovered.reduce((state, child) => state.children.some((link) => link.agentId === child.sessionId)
            ? state
            : registerDirectChild(state, child, this.now()), latestParent));
    }
    async requireSession(sessionId) {
        const state = await this.store.load(sessionId);
        if (!state)
            throw new Error(`Subagent namespace is not initialized: ${sessionId}`);
        return state;
    }
    async waitForRegistration(parent, processInstanceId, registrationToken, expectedAgentId) {
        const deadline = Date.now() + this.registrationTimeoutMs;
        while (true) {
            const matches = (await this.store.list()).filter((state) => (state.parent?.sessionId === parent.sessionId
                && state.parent.epoch === parent.epoch
                && state.parent.registrationToken === registrationToken
                && state.launch?.processInstanceId === processInstanceId
                && state.runtime.tmux !== undefined
                && (expectedAgentId === undefined || state.sessionId === expectedAgentId)));
            if (matches.length > 0) {
                return matches.sort((left, right) => (right.runtime.updatedAt.localeCompare(left.runtime.updatedAt)))[0];
            }
            if (Date.now() >= deadline) {
                throw new Error("Timed out waiting for child runtime registration");
            }
            await this.sleep(this.pollIntervalMs);
        }
    }
}
function toManagedAgent(state, status = state.runtime.status) {
    return {
        agentId: state.sessionId,
        name: state.launch?.displayName ?? state.sessionId,
        status,
        generation: state.runtime.generation,
        settledGeneration: state.runtime.settledGeneration,
        settledCursor: encodeSettledCursor({
            agentId: state.sessionId,
            epoch: state.epoch,
            generation: state.runtime.settledGeneration,
        }),
        ...(state.launch?.model ? { model: state.launch.model } : {}),
        ...(state.launch?.thinkingLevel ? { thinkingLevel: state.launch.thinkingLevel } : {}),
        ...(state.runtime.tmux ? { tmux: state.runtime.tmux } : {}),
        sessionFile: state.runtime.sessionFile,
    };
}
function targetLinks(parent, target) {
    return target === "all"
        ? [...parent.children]
        : [getDirectChild(parent, target)];
}
function managedAgentFromLink(link, status) {
    return {
        agentId: link.agentId,
        name: link.name,
        status,
        generation: 0,
        settledGeneration: 0,
        settledCursor: encodeSettledCursor({
            agentId: link.agentId,
            epoch: link.epoch,
            generation: 0,
        }),
        ...(link.launch.model ? { model: link.launch.model } : {}),
        ...(link.launch.thinkingLevel ? { thinkingLevel: link.launch.thinkingLevel } : {}),
        sessionFile: link.sessionFile,
    };
}
function normalizeWindowName(value) {
    const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
    return (normalized || "subagent").slice(0, 80);
}
//# sourceMappingURL=manager.js.map