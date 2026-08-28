import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { encodeActivityCursor, encodeSettledCursor } from "./cursor.js";
import { getDirectChild, registerDirectChild, removeDirectChildren, } from "./ownership.js";
import { readSessionView, } from "./session-reader.js";
import { waitForSettled, } from "./wait.js";
export const PI_SUBAGENT_MAX_ACTIVE = "PI_SUBAGENT_MAX_ACTIVE";
export const PI_SUBAGENT_STATE_ROOT = "PI_SUBAGENT_STATE_ROOT";
export const PI_SUBAGENT_PARENT = "PI_SUBAGENT_PARENT";
export const PI_SUBAGENT_LAUNCH = "PI_SUBAGENT_LAUNCH";
const WAIT_PAYLOAD_MAX_BYTES = 72 * 1024;
export class DeliveryUnconfirmedError extends Error {
    deliveryId;
    code = "delivery_unconfirmed";
    constructor(deliveryId) {
        super("delivery_unconfirmed: Child Pi may already have accepted the prompt");
        this.deliveryId = deliveryId;
        this.name = "DeliveryUnconfirmedError";
    }
}
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
    promptAckTimeoutMs;
    closeTimeoutMs;
    maxActive;
    reservationTtlMs;
    nowMs;
    promptLocks = new Map();
    inFlightSpawns = new Map();
    closingNamespaces = new Set();
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
        this.promptAckTimeoutMs = options.promptAckTimeoutMs ?? 1_000;
        this.closeTimeoutMs = options.closeTimeoutMs ?? 5_000;
        this.maxActive = options.maxActive ?? 3;
        if (!Number.isSafeInteger(this.maxActive) || this.maxActive <= 0) {
            throw new Error("Subagent max active must be a positive integer");
        }
        this.reservationTtlMs = options.reservationTtlMs
            ?? Math.max(30_000, this.registrationTimeoutMs * 2);
        if (!Number.isSafeInteger(this.reservationTtlMs) || this.reservationTtlMs <= 0) {
            throw new Error("Subagent reservation TTL must be a positive integer");
        }
        this.nowMs = options.nowMs ?? Date.now;
    }
    spawn(parentSessionId, options, defaults) {
        const operation = this.spawnInternal(parentSessionId, options, defaults);
        const inFlight = this.inFlightSpawns.get(parentSessionId) ?? new Set();
        inFlight.add(operation);
        this.inFlightSpawns.set(parentSessionId, inFlight);
        const untrack = () => {
            inFlight.delete(operation);
            if (inFlight.size === 0)
                this.inFlightSpawns.delete(parentSessionId);
        };
        void operation.then(untrack, untrack);
        return operation;
    }
    async spawnInternal(parentSessionId, options, defaults) {
        if (this.closingNamespaces.has(parentSessionId)) {
            throw new Error(`Subagent namespace is closing: ${parentSessionId}`);
        }
        const initialParent = await this.requireSession(parentSessionId);
        if (initialParent.parent) {
            throw new Error("Managed sessions cannot spawn subagents");
        }
        await this.reconcileOwnedSessions(parentSessionId);
        const parent = await this.requireSession(parentSessionId);
        this.assertRootNamespace(parent);
        const registrationToken = this.createId();
        const processInstanceId = this.createId();
        const reservation = {
            reservationId: registrationToken,
            processInstanceId,
            createdAt: this.now(),
            expiresAt: new Date(this.nowMs() + this.reservationTtlMs).toISOString(),
        };
        await this.reserveSpawn(parent.sessionId, reservation);
        const displayName = options.name?.trim() || `Subagent ${parent.children.length + 1}`;
        const cwd = resolve(defaults.cwd, options.cwd ?? ".");
        const model = options.model ?? defaults.model;
        const thinkingLevel = options.thinkingLevel ?? defaults.thinkingLevel;
        const sessionDir = join(this.nativeSessionRoot, parent.sessionId, processInstanceId);
        const sessionFile = join(sessionDir, "session.jsonl");
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
            "--session",
            sessionFile,
            "--name",
            displayName,
            "--extension",
            this.extensionPath,
            ...(model ? ["--model", model] : []),
            ...(thinkingLevel ? ["--thinking", thinkingLevel] : []),
        ];
        let locator;
        let registeredChild;
        try {
            await mkdir(sessionDir, { recursive: true });
            await writeFile(sessionFile, "", { encoding: "utf8", mode: 0o600, flag: "wx" });
            locator = await this.runtime.launch({
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
            await this.attachReservationLocator(parent.sessionId, registrationToken, locator);
            const child = await this.waitForRegistration(parent, processInstanceId, registrationToken);
            this.assertManagedLeaf(child);
            registeredChild = child;
            await this.store.update(parent.sessionId, (latestParent) => ({
                ...registerDirectChild(latestParent, child, this.now()),
                reservations: latestParent.reservations.filter((candidate) => candidate.reservationId !== registrationToken),
            }));
            const initialDelivery = await this.prompt(parent.sessionId, child.sessionId, options.task, "steer");
            return initialDelivery.agent;
        }
        catch (error) {
            if (locator) {
                try {
                    await this.runtime.close(locator);
                    await this.confirmClosed(locator);
                }
                catch (cleanupError) {
                    throw new AggregateError([error, cleanupError], "Failed to clean up a failed subagent spawn");
                }
            }
            const failedChildren = (await this.store.list()).filter((state) => (state.parent?.sessionId === parent.sessionId
                && state.parent.epoch === parent.epoch
                && state.parent.registrationToken === registrationToken
                && state.launch?.processInstanceId === processInstanceId));
            if (registeredChild
                && !failedChildren.some((state) => state.sessionId === registeredChild?.sessionId)) {
                failedChildren.push(registeredChild);
            }
            const failedChildIds = new Set(failedChildren.map((state) => state.sessionId));
            await this.store.update(parent.sessionId, (latestParent) => ({
                ...removeDirectChildren(latestParent, failedChildIds),
                reservations: latestParent.reservations.filter((candidate) => candidate.reservationId !== registrationToken),
            }));
            for (const child of failedChildren) {
                await this.store.delete(child.sessionId);
            }
            throw error;
        }
    }
    close(parentSessionId, target) {
        if (target !== "all")
            return this.closeDirect(parentSessionId, target);
        if (this.closingNamespaces.has(parentSessionId)) {
            return Promise.reject(new Error(`Subagent namespace is already closing: ${parentSessionId}`));
        }
        this.closingNamespaces.add(parentSessionId);
        return this.closeAll(parentSessionId).finally(() => {
            this.closingNamespaces.delete(parentSessionId);
        });
    }
    async closeAll(parentSessionId) {
        const inFlight = [...(this.inFlightSpawns.get(parentSessionId) ?? [])];
        await Promise.allSettled(inFlight);
        await this.reconcileOwnedSessions(parentSessionId);
        await this.closeReservations(parentSessionId);
        return this.closeDirect(parentSessionId, "all");
    }
    async closeReservations(parentSessionId) {
        const parent = await this.requireSession(parentSessionId);
        this.assertRootNamespace(parent);
        const childProcessIds = new Set();
        for (const link of parent.children) {
            const child = await this.store.load(link.agentId);
            if (child?.epoch !== link.epoch)
                continue;
            childProcessIds.add(child.runtime.processInstanceId ?? link.launch.processInstanceId);
        }
        for (const child of await this.store.list()) {
            if (child.parent?.sessionId !== parent.sessionId
                || child.parent.epoch !== parent.epoch
                || !child.launch
                || !child.runtime.tmux) {
                continue;
            }
            this.assertManagedLeaf(child);
            childProcessIds.add(child.runtime.processInstanceId ?? child.launch.processInstanceId);
        }
        const closedProcessIds = new Set();
        for (const reservation of parent.reservations) {
            if (childProcessIds.has(reservation.processInstanceId)
                || closedProcessIds.has(reservation.processInstanceId)) {
                continue;
            }
            if (reservation.tmux) {
                await this.runtime.close(reservation.tmux);
                await this.confirmClosed(reservation.tmux);
            }
            closedProcessIds.add(reservation.processInstanceId);
        }
        const reservationIds = new Set(parent.reservations.map((reservation) => (reservation.reservationId)));
        await this.store.update(parentSessionId, (latestParent) => ({
            ...latestParent,
            reservations: latestParent.reservations.filter((reservation) => !reservationIds.has(reservation.reservationId)),
        }));
    }
    async closeDirect(parentSessionId, target) {
        await this.reconcileOwnedSessions(parentSessionId);
        const parent = await this.requireSession(parentSessionId);
        this.assertRootNamespace(parent);
        const links = targetLinks(parent, target);
        const states = await Promise.all(links.map(async (link) => {
            const state = await this.requireSession(link.agentId);
            if (state.epoch !== link.epoch
                || state.parent?.sessionId !== parent.sessionId
                || state.parent.epoch !== parent.epoch) {
                throw new Error(`Managed child ownership does not match its direct link: ${link.agentId}`);
            }
            this.assertManagedLeaf(state);
            return state;
        }));
        const selectedIds = new Set(states.map((state) => state.sessionId));
        const siblingStates = (await Promise.all(parent.children
            .filter((link) => !selectedIds.has(link.agentId))
            .map((link) => this.store.load(link.agentId))))
            .filter((state) => state !== undefined);
        const activeStates = [];
        for (const state of states) {
            const hasActiveStatus = state.runtime.status === "starting"
                || state.runtime.status === "running"
                || state.runtime.status === "settled"
                || state.runtime.status === "closing";
            if (!hasActiveStatus) {
                const hasLiveLocator = target === "all"
                    && state.runtime.tmux !== undefined
                    && await this.runtime.isAlive(state.runtime.tmux);
                if (hasLiveLocator)
                    activeStates.push(state);
                continue;
            }
            const processInstanceId = state.runtime.processInstanceId
                ?? state.launch?.processInstanceId;
            const newerSiblingLiveness = processInstanceId === undefined
                ? []
                : await Promise.all(siblingStates
                    .filter((sibling) => ((sibling.runtime.processInstanceId ?? sibling.launch?.processInstanceId)
                    === processInstanceId
                    && sibling.runtime.updatedAt > state.runtime.updatedAt
                    && (sibling.runtime.status === "starting"
                        || sibling.runtime.status === "running"
                        || sibling.runtime.status === "settled"
                        || sibling.runtime.status === "closing")
                    && sibling.runtime.tmux !== undefined))
                    .map(async (sibling) => this.runtime.isAlive(sibling.runtime.tmux)));
            const hasNewerLiveSibling = newerSiblingLiveness.some(Boolean);
            if (!hasNewerLiveSibling)
                activeStates.push(state);
        }
        for (const state of activeStates) {
            await this.store.update(state.sessionId, (latest) => ({
                ...latest,
                runtime: {
                    ...latest.runtime,
                    status: "closing",
                    updatedAt: this.now(),
                },
            }));
        }
        const closedProcessIds = new Set();
        try {
            for (const state of activeStates) {
                const processInstanceId = state.runtime.processInstanceId
                    ?? state.launch?.processInstanceId
                    ?? state.sessionId;
                if (closedProcessIds.has(processInstanceId))
                    continue;
                const locator = state.runtime.tmux;
                if (locator) {
                    await this.runtime.close(locator);
                    await this.confirmClosed(locator);
                }
                closedProcessIds.add(processInstanceId);
            }
        }
        catch (error) {
            for (const state of activeStates) {
                await this.store.update(state.sessionId, (latest) => ({
                    ...latest,
                    runtime: {
                        ...latest.runtime,
                        status: "closing",
                        updatedAt: this.now(),
                    },
                })).catch(() => undefined);
            }
            throw error;
        }
        const agentIds = new Set(states.map((state) => state.sessionId));
        await this.store.update(parent.sessionId, (latestParent) => (removeDirectChildren(latestParent, agentIds)));
        for (const state of states) {
            await this.store.delete(state.sessionId);
        }
        return states.map((state) => toManagedAgent(state, "closed"));
    }
    async wait(parentSessionId, agentId, options, signal) {
        const initial = await this.requireDirectSession(parentSessionId, agentId);
        const result = await waitForSettled({
            agentId,
            afterSettled: options.afterSettled,
            timeoutMs: options.timeoutMs,
            pollIntervalMs: this.pollIntervalMs,
            signal,
            readState: () => this.store.load(agentId),
            wasClosed: async () => {
                const parent = await this.store.load(parentSessionId);
                return parent !== undefined
                    && !parent.children.some((child) => child.agentId === agentId);
            },
            isAlive: async (state) => state.runtime.tmux !== undefined
                && this.runtime.isAlive(state.runtime.tmux),
            sleep: this.sleep,
        });
        let currentChild = await this.store.load(agentId);
        if (currentChild && result.outcome === "interrupted") {
            currentChild = await this.markInterrupted(currentChild);
        }
        const child = currentChild ?? initial.child;
        if (currentChild && child.epoch !== initial.child.epoch) {
            throw new Error(`Managed child epoch changed while waiting: ${agentId}`);
        }
        if (!currentChild && result.outcome !== "closed") {
            throw new Error(`Subagent state disappeared while waiting: ${agentId}`);
        }
        const status = result.outcome === "settled"
            ? "settled"
            : result.outcome === "closed"
                ? "closed"
                : result.outcome === "interrupted"
                    ? "interrupted"
                    : child.runtime.status;
        const agent = toManagedAgent(child, status);
        if (result.outcome !== "settled") {
            return finalizeManagedWaitResult({
                ...result,
                agent,
                activity: [],
                assistantCount: 0,
                toolCount: 0,
                omittedAssistant: 0,
                omittedTools: 0,
                hasMore: false,
            });
        }
        let maximumBytes = WAIT_PAYLOAD_MAX_BYTES;
        while (true) {
            const recent = await readSessionView({
                sessionFile: child.runtime.sessionFile,
                agentId,
                epoch: child.epoch,
                view: "recent_activity",
                assistantLimit: options.assistantLimit ?? 2,
                toolLimit: options.toolLimit ?? 3,
                maximumBytes,
                ...(options.afterActivity ? { after: options.afterActivity } : {}),
                ...(child.runtime.leafId ? { leafId: child.runtime.leafId } : {}),
            });
            if (recent.view !== "recent_activity") {
                throw new Error("Internal error: wait activity projection returned the wrong view");
            }
            const managed = finalizeManagedWaitResult({
                ...result,
                agent,
                activity: recent.activity,
                activityCursor: recent.cursor,
                assistantCount: recent.assistantCount,
                toolCount: recent.toolCount,
                omittedAssistant: recent.omittedAssistant,
                omittedTools: recent.omittedTools,
                hasMore: recent.hasMore,
            });
            if (managed.returnedBytes <= WAIT_PAYLOAD_MAX_BYTES || maximumBytes === 0) {
                return managed;
            }
            const overflow = managed.returnedBytes - WAIT_PAYLOAD_MAX_BYTES;
            maximumBytes = Math.max(0, maximumBytes - Math.max(overflow, 1024));
        }
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
        const parent = await this.store.update(parentSessionId, async (latestParent) => (this.reapExpiredReservations(latestParent)));
        this.assertRootNamespace(parent);
        const entries = await Promise.all(parent.children.map(async (link) => {
            const child = await this.store.load(link.agentId);
            if (!child || child.epoch !== link.epoch) {
                return {
                    agent: managedAgentFromLink(link, "interrupted"),
                    activeProcessId: undefined,
                };
            }
            this.assertDirectOwnership(parent, link, child);
            this.assertManagedLeaf(child);
            if (child.runtime.status === "closed"
                || child.runtime.status === "interrupted"
                || child.runtime.status === "errored") {
                return { agent: toManagedAgent(child), activeProcessId: undefined };
            }
            const alive = child.runtime.status === "closing" || (child.runtime.tmux !== undefined
                && await this.runtime.isAlive(child.runtime.tmux));
            if (!alive) {
                const interrupted = await this.markInterrupted(child);
                return {
                    agent: toManagedAgent(interrupted),
                    activeProcessId: undefined,
                };
            }
            return {
                agent: toManagedAgent(child),
                activeProcessId: child.runtime.processInstanceId ?? link.launch.processInstanceId,
            };
        }));
        const activeProcessIds = new Set(entries.flatMap((entry) => (entry.activeProcessId ? [entry.activeProcessId] : [])));
        const pendingProcessIds = new Set(parent.reservations.flatMap((reservation) => (activeProcessIds.has(reservation.processInstanceId)
            ? []
            : [reservation.processInstanceId])));
        const used = activeProcessIds.size + pendingProcessIds.size;
        return {
            agents: entries.map((entry) => entry.agent),
            capacity: {
                active: activeProcessIds.size,
                pending: pendingProcessIds.size,
                limit: this.maxActive,
                available: Math.max(0, this.maxActive - used),
            },
        };
    }
    async prompt(parentSessionId, agentId, text, delivery) {
        return this.withPromptLock(agentId, () => (this.deliverPrompt(parentSessionId, agentId, text, delivery)));
    }
    async deliverPrompt(parentSessionId, agentId, text, delivery) {
        const { wireText, deliveryId, marker } = createPromptEnvelope(text);
        const { child } = await this.requireDirectSession(parentSessionId, agentId);
        if (child.runtime.status !== "running" && child.runtime.status !== "settled") {
            throw new Error(`Managed child is not running: ${agentId}`);
        }
        const locator = child.runtime.tmux;
        if (!locator || !await this.runtime.isAlive(locator)) {
            if (locator)
                await this.markInterrupted(child);
            throw new Error(`Managed child runtime was interrupted: ${agentId}`);
        }
        const baselineCursor = await this.readPromptBaseline(child);
        await this.runtime.sendPrompt(locator, wireText, delivery);
        const confirmation = await this.waitForPromptConfirmation({
            child,
            locator,
            deliveryId,
            marker,
            after: baselineCursor,
        });
        return {
            agent: toManagedAgent(child),
            deliveryId,
            confirmation,
        };
    }
    async withPromptLock(agentId, operation) {
        const previous = this.promptLocks.get(agentId) ?? Promise.resolve();
        let release;
        const gate = new Promise((resolveGate) => {
            release = resolveGate;
        });
        const tail = previous.catch(() => undefined).then(() => gate);
        this.promptLocks.set(agentId, tail);
        await previous.catch(() => undefined);
        try {
            return await operation();
        }
        finally {
            release();
            if (this.promptLocks.get(agentId) === tail)
                this.promptLocks.delete(agentId);
        }
    }
    async readPromptBaseline(child) {
        const deadline = this.nowMs() + this.promptAckTimeoutMs;
        while (true) {
            try {
                const baseline = await readSessionView({
                    sessionFile: child.runtime.sessionFile,
                    agentId: child.sessionId,
                    epoch: child.epoch,
                    view: "turns",
                    limit: 0,
                });
                if (baseline.view !== "turns") {
                    throw new Error("Internal error: prompt baseline returned the wrong view");
                }
                return baseline.cursor;
            }
            catch (error) {
                if (!isPendingPromptBaseline(error))
                    throw error;
                if (child.runtime.generation === 0 && child.runtime.settledGeneration === 0) {
                    return encodeActivityCursor({
                        agentId: child.sessionId,
                        epoch: child.epoch,
                        view: "turns",
                        position: 0,
                    });
                }
            }
            const remaining = deadline - this.nowMs();
            if (remaining <= 0) {
                throw new Error("Timed out waiting for child session baseline");
            }
            await this.sleep(Math.min(this.pollIntervalMs, remaining));
        }
    }
    async waitForPromptConfirmation(options) {
        const deadline = this.nowMs() + this.promptAckTimeoutMs;
        while (true) {
            const [sessionResult, paneResult] = await Promise.allSettled([
                readSessionView({
                    sessionFile: options.child.runtime.sessionFile,
                    agentId: options.child.sessionId,
                    epoch: options.child.epoch,
                    view: "turns",
                    after: options.after,
                    limit: 200,
                }),
                this.runtime.capturePane(options.locator),
            ]);
            if (sessionResult.status === "fulfilled"
                && sessionResult.value.view === "turns"
                && sessionResult.value.turns.some((turn) => turn.user.text.includes(options.marker))) {
                return "session";
            }
            if (paneResult.status === "fulfilled") {
                if (paneResult.value.includes(`Steering: ${options.marker}`)) {
                    return "steering_queue";
                }
                if (paneResult.value.includes(`Follow-up: ${options.marker}`)) {
                    return "follow_up_queue";
                }
            }
            const remaining = deadline - this.nowMs();
            if (remaining <= 0) {
                throw new DeliveryUnconfirmedError(options.deliveryId);
            }
            await this.sleep(Math.min(this.pollIntervalMs, remaining));
        }
    }
    async reserveSpawn(parentSessionId, reservation) {
        await this.store.update(parentSessionId, async (parent) => {
            if (this.closingNamespaces.has(parentSessionId) && !this.inFlightSpawns.has(parentSessionId)) {
                throw new Error(`Subagent namespace is closing: ${parentSessionId}`);
            }
            this.assertRootNamespace(parent);
            const cleanedParent = await this.reapExpiredReservations(parent);
            const activeProcessIds = await this.activeProcessIds(cleanedParent);
            const pendingProcessIds = new Set(cleanedParent.reservations.flatMap((candidate) => (activeProcessIds.has(candidate.processInstanceId)
                ? []
                : [candidate.processInstanceId])));
            const used = activeProcessIds.size + pendingProcessIds.size;
            if (used >= this.maxActive) {
                throw new Error(`Subagent capacity reached (${used}/${this.maxActive}). Reuse an existing child with subagent_prompt, or close one before spawning another.`);
            }
            return {
                ...cleanedParent,
                reservations: [...cleanedParent.reservations, reservation],
            };
        });
    }
    async reapExpiredReservations(parent) {
        const registeredProcessIds = new Set((await this.store.list()).flatMap((state) => (state.parent?.sessionId === parent.sessionId
            && state.parent.epoch === parent.epoch
            && state.launch
            && state.runtime.tmux
            ? [state.launch.processInstanceId]
            : [])));
        const retained = [];
        for (const reservation of parent.reservations) {
            const expiresAt = Date.parse(reservation.expiresAt);
            if (registeredProcessIds.has(reservation.processInstanceId))
                continue;
            if (Number.isFinite(expiresAt) && expiresAt > this.nowMs()) {
                retained.push(reservation);
                continue;
            }
            if (!reservation.tmux)
                continue;
            try {
                await this.runtime.close(reservation.tmux);
                await this.confirmClosed(reservation.tmux);
            }
            catch {
                retained.push(reservation);
            }
        }
        return retained.length === parent.reservations.length
            ? parent
            : { ...parent, reservations: retained };
    }
    async attachReservationLocator(parentSessionId, reservationId, locator) {
        await this.store.update(parentSessionId, (parent) => {
            if (!parent.reservations.some((candidate) => candidate.reservationId === reservationId)) {
                throw new Error(`Spawn reservation is no longer active: ${reservationId}`);
            }
            return {
                ...parent,
                reservations: parent.reservations.map((candidate) => (candidate.reservationId === reservationId
                    ? { ...candidate, tmux: locator }
                    : candidate)),
            };
        });
    }
    async activeProcessIds(parent) {
        const candidates = new Map();
        for (const link of parent.children) {
            const child = await this.store.load(link.agentId);
            if (!child || child.epoch !== link.epoch)
                continue;
            this.assertDirectOwnership(parent, link, child);
            this.assertManagedLeaf(child);
            candidates.set(child.sessionId, {
                child,
                processInstanceId: child.runtime.processInstanceId
                    ?? link.launch.processInstanceId,
            });
        }
        for (const child of await this.store.list()) {
            if (candidates.has(child.sessionId)
                || child.parent?.sessionId !== parent.sessionId
                || child.parent.epoch !== parent.epoch
                || !child.launch) {
                continue;
            }
            this.assertManagedLeaf(child);
            candidates.set(child.sessionId, {
                child,
                processInstanceId: child.runtime.processInstanceId
                    ?? child.launch.processInstanceId,
            });
        }
        const active = new Set();
        for (const { child, processInstanceId } of candidates.values()) {
            if (child.runtime.status === "closing") {
                active.add(processInstanceId);
                continue;
            }
            if (child.runtime.status !== "starting"
                && child.runtime.status !== "running"
                && child.runtime.status !== "settled") {
                continue;
            }
            if (child.runtime.tmux && await this.runtime.isAlive(child.runtime.tmux)) {
                active.add(processInstanceId);
            }
            else {
                await this.markInterrupted(child);
            }
        }
        return active;
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
        this.assertRootNamespace(parent);
        const link = getDirectChild(parent, agentId);
        const child = await this.requireSession(agentId);
        this.assertDirectOwnership(parent, link, child);
        this.assertManagedLeaf(child);
        return { parent, child };
    }
    async reconcileOwnedSessions(parentSessionId) {
        const parent = await this.requireSession(parentSessionId);
        this.assertRootNamespace(parent);
        const linkedIds = new Set(parent.children.map((child) => child.agentId));
        for (const link of parent.children) {
            const child = await this.store.load(link.agentId);
            if (!child || child.epoch !== link.epoch)
                continue;
            this.assertDirectOwnership(parent, link, child);
            this.assertManagedLeaf(child);
        }
        const discovered = (await this.store.list()).filter((state) => (!linkedIds.has(state.sessionId)
            && state.parent?.sessionId === parent.sessionId
            && state.parent.epoch === parent.epoch
            && state.launch !== undefined
            && state.runtime.tmux !== undefined));
        for (const child of discovered)
            this.assertManagedLeaf(child);
        if (discovered.length === 0)
            return;
        const discoveredProcessIds = new Set(discovered.flatMap((child) => (child.launch ? [child.launch.processInstanceId] : [])));
        await this.store.update(parent.sessionId, (latestParent) => {
            const linked = discovered.reduce((state, child) => state.children.some((link) => link.agentId === child.sessionId)
                ? state
                : registerDirectChild(state, child, this.now()), latestParent);
            return {
                ...linked,
                reservations: linked.reservations.filter((reservation) => !discoveredProcessIds.has(reservation.processInstanceId)),
            };
        });
    }
    async markInterrupted(child) {
        return this.store.update(child.sessionId, (latest) => {
            if (latest.epoch !== child.epoch
                || (latest.runtime.status !== "starting"
                    && latest.runtime.status !== "running"
                    && latest.runtime.status !== "settled")) {
                return latest;
            }
            return {
                ...latest,
                runtime: {
                    ...latest.runtime,
                    status: "interrupted",
                    busy: false,
                    updatedAt: this.now(),
                },
            };
        });
    }
    assertRootNamespace(state) {
        if (state.parent)
            throw new Error("Managed sessions cannot manage subagents");
    }
    assertManagedLeaf(state) {
        if (state.children.length > 0) {
            throw new Error(`Subagent topology corruption: managed child has children: ${state.sessionId}`);
        }
    }
    assertDirectOwnership(parent, link, child) {
        if (child.epoch !== link.epoch
            || child.parent?.sessionId !== parent.sessionId
            || child.parent.epoch !== parent.epoch) {
            throw new Error(`Managed child ownership does not match its direct link: ${link.agentId}`);
        }
    }
    async requireSession(sessionId) {
        const state = await this.store.load(sessionId);
        if (!state)
            throw new Error(`Subagent namespace is not initialized: ${sessionId}`);
        return state;
    }
    async waitForRegistration(parent, processInstanceId, registrationToken) {
        const deadline = Date.now() + this.registrationTimeoutMs;
        while (true) {
            const matches = (await this.store.list()).filter((state) => (state.parent?.sessionId === parent.sessionId
                && state.parent.epoch === parent.epoch
                && state.parent.registrationToken === registrationToken
                && state.launch?.processInstanceId === processInstanceId
                && state.runtime.tmux !== undefined));
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
function finalizeManagedWaitResult(value) {
    let returnedBytes = 0;
    while (true) {
        const result = { ...value, returnedBytes };
        const serializedBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
        if (serializedBytes === returnedBytes)
            return result;
        returnedBytes = serializedBytes;
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
function createPromptEnvelope(text) {
    const normalizedInput = text
        .replace(/\r\n/gu, "\n")
        .replace(/\r/gu, "\n")
        .replace(/\t/gu, "    ");
    if (/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(normalizedInput)) {
        throw new Error("Subagent prompt contains an unsafe control character");
    }
    const normalized = normalizedInput.trim();
    if (normalized.length === 0)
        throw new Error("Cannot deliver an empty subagent prompt");
    const deliveryId = randomUUID().replaceAll("-", "").slice(0, 12);
    const marker = `[subagent:${deliveryId}]`;
    return {
        wireText: `${marker}\n${normalized}`,
        deliveryId,
        marker,
    };
}
function isPendingPromptBaseline(error) {
    return (error instanceof Error
        && (("code" in error && error.code === "ENOENT")
            || error.message === "Pi session has no complete header"));
}
function normalizeWindowName(value) {
    const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
    return (normalized || "subagent").slice(0, 80);
}
//# sourceMappingURL=manager.js.map