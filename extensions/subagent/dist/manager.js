import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { encodeActivityCursor, encodeSettledCursor } from "./cursor.js";
import { currentOperation, DeadlineExceeded, withOperation } from "./operation.js";
import { acquireFileLock } from "./file-lock.js";
import { getDirectChild, registerDirectChild, removeDirectChildren, } from "./ownership.js";
import { readSessionView, readSessionSnapshot, hasPersistedPrompt, } from "./session-reader.js";
import { SESSION_STATE_SCHEMA_VERSION } from "./state-store.js";
import { waitForSettled, } from "./wait.js";
export const PI_SUBAGENT_MAX_ACTIVE = "PI_SUBAGENT_MAX_ACTIVE";
export const PI_SUBAGENT_STATE_ROOT = "PI_SUBAGENT_STATE_ROOT";
export const PI_SUBAGENT_PARENT = "PI_SUBAGENT_PARENT";
export const PI_SUBAGENT_LAUNCH = "PI_SUBAGENT_LAUNCH";
const WAIT_PAYLOAD_MAX_BYTES = 72 * 1024;
export class DeliveryUnconfirmedError extends Error {
    deliveryId;
    code = "delivery_unconfirmed";
    constructor(deliveryId, cause) {
        super(`delivery_unconfirmed: Child Pi may already have accepted the prompt (deliveryId: ${deliveryId})`, { cause });
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
    beforePrompt;
    promptLocks = new Map();
    inFlightSpawns = new Map();
    closingNamespaces = new Set();
    controllers = new Map();
    controllerSignals = new Map();
    operations = new Map();
    runOperation(sessionId, timeout, signal, work) {
        let controller = this.controllerSignals.get(sessionId);
        if (!controller) {
            controller = new AbortController();
            this.controllerSignals.set(sessionId, controller);
        }
        const pending = withOperation(timeout, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, work);
        const active = this.operations.get(sessionId) ?? new Set();
        active.add(pending);
        this.operations.set(sessionId, active);
        const untrack = () => { active.delete(pending); if (!active.size)
            this.operations.delete(sessionId); };
        void pending.then(untrack, untrack);
        return pending;
    }
    async claimNamespace(sessionId, required = true) {
        this.store.statePath(sessionId);
        let pending = this.controllers.get(sessionId);
        const newlyAcquired = !pending;
        if (!pending) {
            // Share initialization as well as acquisition; no caller may use a half-initialized controller.
            pending = this.initializeController(sessionId);
            this.controllers.set(sessionId, pending);
        }
        let lock;
        try {
            lock = await pending;
        }
        catch (error) {
            if (this.controllers.get(sessionId) === pending)
                this.controllers.delete(sessionId);
            if (!required && error instanceof Error && error.message.startsWith("Subagent control lock unavailable:"))
                return false;
            throw error;
        }
        if (!newlyAcquired)
            await this.synchronizeController(sessionId, lock);
        const operation = currentOperation();
        if (operation)
            operation.assertAuthorized = lock.assertOwned;
        return true;
    }
    async initializeController(sessionId) {
        const lock = await acquireFileLock(join(this.stateRoot, "controllers", sessionId), currentOperation()?.signal, 0);
        this.store.authorizeController(sessionId, lock.assertOwned);
        try {
            await this.synchronizeController(sessionId, lock);
            return lock;
        }
        catch (error) {
            this.store.rollbackControllerAuthorization(sessionId, lock.assertOwned);
            try {
                await lock.release();
            }
            catch (cleanupError) {
                throw new AggregateError([error, cleanupError], "Failed to release uninitialized subagent controller", { cause: error });
            }
            throw error;
        }
    }
    async synchronizeController(sessionId, lock) {
        await lock.assertOwned();
        const state = await this.store.loadRuntime(sessionId);
        if (state && state.control?.controllerEpoch !== lock.token) {
            await this.store.update(sessionId, latest => ({ ...latest, control: {
                    ...latest.control, children: latest.control?.children ?? {}, tombstones: latest.control?.tombstones ?? {}, controllerEpoch: lock.token,
                } }));
        }
    }
    async controllerGuard(sessionId) {
        const pending = this.controllers.get(sessionId);
        if (!pending)
            throw new Error("Subagent namespace has no active controller");
        return (await pending).assertOwned;
    }
    async releaseNamespace(sessionId) {
        const pending = this.controllers.get(sessionId);
        if (!pending)
            return;
        this.controllerSignals.get(sessionId)?.abort(new Error("Subagent controller stopped"));
        await Promise.allSettled([...(this.operations.get(sessionId) ?? [])]);
        await (await pending).release();
        this.controllers.delete(sessionId);
        this.controllerSignals.delete(sessionId);
    }
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
        this.beforePrompt = options.beforePrompt;
    }
    spawn(parentSessionId, options, defaults, signal) {
        const operation = this.runOperation(parentSessionId, this.registrationTimeoutMs + this.promptAckTimeoutMs + 5_000, signal, () => this.spawnInternal(parentSessionId, options, defaults));
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
        await this.claimNamespace(parentSessionId);
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
            launchState: "reserved",
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
            ...(this.environment.PI_CODING_AGENT_DIR && this.environment.PI_SUBAGENT_TMUX_PATH ? { configuration: {
                    protocolVersion: SESSION_STATE_SCHEMA_VERSION,
                    agentDir: this.environment.PI_CODING_AGENT_DIR,
                    tmuxPath: this.environment.PI_SUBAGENT_TMUX_PATH,
                    piPath: this.piPath,
                } } : {}),
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
        let launchAttempted = false;
        try {
            await mkdir(sessionDir, { recursive: true });
            await writeFile(sessionFile, "", { encoding: "utf8", mode: 0o600, flag: "wx" });
            await this.store.update(parent.sessionId, (latest) => ({ ...latest, reservations: latest.reservations.map((entry) => entry.reservationId === registrationToken ? { ...entry, launchState: "launching" } : entry) }));
            launchAttempted = true;
            locator = await this.runtime.launch({
                cwd,
                windowName: normalizeWindowName(displayName),
                command: this.piPath,
                args,
                environment: {
                    ...this.environment,
                    PI_SUBAGENT: "1",
                    PI_SUBAGENT_ID: processInstanceId,
                    PI_SUBAGENT_PI_PATH: this.piPath,
                    [PI_SUBAGENT_STATE_ROOT]: this.stateRoot,
                    [PI_SUBAGENT_PARENT]: JSON.stringify(parentOwnership),
                    [PI_SUBAGENT_LAUNCH]: JSON.stringify(launch),
                },
            });
            await this.attachReservationLocator(parent.sessionId, parent.epoch, reservation, locator);
            const child = await this.waitForRegistration(parent, { ...reservation, tmux: locator });
            this.assertManagedLeaf(child);
            if (launch.configuration && JSON.stringify(child.runtime.configuration) !== JSON.stringify(launch.configuration)) {
                throw new Error("Subagent launch configuration handshake failed before initial delivery");
            }
            registeredChild = child;
            await this.store.update(parent.sessionId, (latestParent) => ({
                ...registerDirectChild(latestParent, child, this.now()),
                reservations: latestParent.reservations.filter((candidate) => candidate.reservationId !== registrationToken),
            }));
            const initialDelivery = await this.prompt(parent.sessionId, child.sessionId, options.task, "steer");
            return initialDelivery.agent;
        }
        catch (error) {
            if (launchAttempted && !locator)
                throw error;
            if (locator) {
                try {
                    await this.runtime.close(locator);
                    await this.confirmClosed(locator);
                }
                catch (cleanupError) {
                    throw new AggregateError([error, cleanupError], "Failed to clean up a failed subagent spawn");
                }
            }
            const failedChildren = (await this.store.listOwned(parent)).filter((state) => (state.parent?.sessionId === parent.sessionId
                && state.parent.epoch === parent.epoch
                && state.parent.registrationToken === registrationToken
                && state.launch?.processInstanceId === processInstanceId));
            if (registeredChild
                && !failedChildren.some((state) => state.sessionId === registeredChild?.sessionId)) {
                failedChildren.push(registeredChild);
            }
            const failedChildIds = new Set(failedChildren.map((state) => state.sessionId));
            await this.retireProcesses(parent.sessionId, new Set([processInstanceId]));
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
    close(parentSessionId, target, signal) {
        return this.runOperation(parentSessionId, this.closeTimeoutMs, signal, async () => {
            await this.claimNamespace(parentSessionId);
            return this.closeInternal(parentSessionId, target);
        });
    }
    closeInternal(parentSessionId, target) {
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
        await this.store.update(parentSessionId, (parent) => ({ ...parent, control: {
                ...parent.control, children: parent.control?.children ?? {}, tombstones: parent.control?.tombstones ?? {}, closingAll: true,
            } }));
        const inFlight = [...(this.inFlightSpawns.get(parentSessionId) ?? [])];
        await Promise.allSettled(inFlight);
        await this.reconcileOwnedSessions(parentSessionId);
        await this.closeReservations(parentSessionId);
        const affected = await this.closeDirect(parentSessionId, "all");
        const parent = await this.requireSession(parentSessionId);
        for (const [processId, managed] of Object.entries(parent.processes ?? {})) {
            if (!managed.tmux)
                throw new Error(`Managed process locator is unavailable: ${processId}`);
            await this.runtime.close(managed.tmux);
            await this.confirmClosed(managed.tmux);
            await this.retireProcesses(parentSessionId, new Set([processId]));
        }
        await this.store.update(parentSessionId, (latest) => ({ ...latest, control: { ...latest.control, closingAll: false } }));
        return affected;
    }
    async closeReservations(parentSessionId) {
        const parent = await this.requireSession(parentSessionId);
        this.assertRootNamespace(parent);
        const childProcessIds = new Set();
        const registeredChildren = [];
        for (const link of parent.children) {
            const child = await this.store.load(link.agentId);
            if (child?.epoch !== link.epoch)
                continue;
            childProcessIds.add(child.runtime.processInstanceId ?? link.launch.processInstanceId);
        }
        for (const child of await this.store.listOwned(parent)) {
            if (child.parent?.sessionId !== parent.sessionId
                || child.parent.epoch !== parent.epoch
                || !child.launch
                || !child.runtime.tmux) {
                continue;
            }
            this.assertManagedLeaf(child);
            registeredChildren.push(child);
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
            else if (reservation.launchState !== "reserved") {
                throw new Error(`Subagent launch outcome is unknown; locator unavailable: ${reservation.processInstanceId}`);
            }
            closedProcessIds.add(reservation.processInstanceId);
        }
        const reservationIds = new Set(parent.reservations.map((reservation) => (reservation.reservationId)));
        await this.store.update(parentSessionId, (latestParent) => ({
            ...registeredChildren.reduce((state, child) => registerDirectChild(state, child, this.now()), latestParent),
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
            const processInstanceId = state.runtime.processInstanceId
                ?? state.launch?.processInstanceId;
            const newerSiblingLiveness = processInstanceId === undefined
                ? []
                : await Promise.all(siblingStates
                    .filter((sibling) => ((sibling.runtime.processInstanceId ?? sibling.launch?.processInstanceId)
                    === processInstanceId
                    && (!hasActiveStatus || sibling.runtime.updatedAt > state.runtime.updatedAt)
                    && (sibling.runtime.status === "starting"
                        || sibling.runtime.status === "running"
                        || sibling.runtime.status === "settled"
                        || sibling.runtime.status === "closing")
                    && sibling.runtime.tmux !== undefined))
                    .map(async (sibling) => {
                    const observed = await this.observeRuntime(sibling.runtime.tmux);
                    if (observed.process === "unknown" || observed.identity === "mismatch") {
                        throw new Error(observed.reason ?? "Shared process identity is unknown; management is retained");
                    }
                    return observed.identity === "matched" && observed.process === "alive";
                }));
            const hasNewerLiveSibling = newerSiblingLiveness.some(Boolean);
            if (!hasNewerLiveSibling)
                activeStates.push(state);
        }
        for (const state of activeStates) {
            await this.recordControlStatus(state, "closing");
        }
        const closedProcessIds = new Set();
        try {
            for (const state of activeStates) {
                const processInstanceId = state.runtime.processInstanceId
                    ?? state.launch?.processInstanceId
                    ?? state.sessionId;
                if (closedProcessIds.has(processInstanceId))
                    continue;
                const locator = state.runtime.tmux ?? parent.processes?.[processInstanceId]?.tmux;
                if (!locator)
                    throw new Error(`Subagent runtime locator is unavailable: ${processInstanceId}`);
                const observed = await this.observeRuntime(locator);
                if (observed.identity !== "matched" && observed.process !== "exited")
                    throw new Error(observed.reason ?? "Close identity is unknown");
                await this.runtime.close(locator);
                await this.confirmClosed(locator);
                closedProcessIds.add(processInstanceId);
            }
        }
        catch (error) {
            for (const state of activeStates) {
                await this.recordControlStatus(state, "closing").catch(() => undefined);
            }
            throw error;
        }
        await this.retireProcesses(parentSessionId, closedProcessIds);
        const agentIds = new Set(states.map((state) => state.sessionId));
        await this.store.update(parent.sessionId, (latestParent) => ({
            ...removeDirectChildren(latestParent, agentIds),
            control: {
                ...latestParent.control,
                children: latestParent.control?.children ?? {},
                tombstones: { ...latestParent.control?.tombstones, ...Object.fromEntries(states.map((state) => [state.sessionId, state.epoch])) },
            },
        }));
        for (const state of states) {
            await this.store.delete(state.sessionId);
        }
        return states.map((state) => toManagedAgent(state, "closed"));
    }
    async wait(parentSessionId, agentId, options, signal) {
        const startedAt = performance.now();
        let initial;
        try {
            return await this.runOperation(parentSessionId, options.timeoutMs === 0 ? 250 : options.timeoutMs, signal, async () => {
                initial = await this.requireDirectSession(parentSessionId, agentId);
                return this.waitInternal(parentSessionId, agentId, options, currentOperation().signal, initial);
            });
        }
        catch (error) {
            if (!(error instanceof DeadlineExceeded) || !initial)
                throw error;
            return finalizeManagedWaitResult({ outcome: "timeout", generation: initial.child.runtime.generation,
                durationMs: performance.now() - startedAt, agent: toManagedAgent(initial.child), activity: [],
                assistantCount: 0, toolCount: 0, omittedAssistant: 0, omittedTools: 0, hasMore: false });
        }
    }
    async waitInternal(parentSessionId, agentId, options, signal, initial) {
        const result = await waitForSettled({
            agentId,
            afterSettled: options.afterSettled,
            timeoutMs: Math.min(options.timeoutMs, currentOperation()?.remainingMs ?? options.timeoutMs),
            pollIntervalMs: this.pollIntervalMs,
            signal,
            readState: () => this.store.load(agentId),
            wasClosed: async () => {
                const parent = await this.store.load(parentSessionId);
                return parent !== undefined
                    && !parent.children.some((child) => child.agentId === agentId);
            },
            isAlive: async (state, querySignal) => {
                const observed = await this.observeRuntime(state.runtime.tmux, { signal: querySignal });
                return observed.process !== "exited";
            },
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
        const snapshot = await readSessionSnapshot(child.runtime.sessionFile);
        let maximumBytes = WAIT_PAYLOAD_MAX_BYTES;
        while (true) {
            const recent = await readSessionView({
                snapshot,
                sessionFile: child.runtime.sessionFile,
                agentId,
                epoch: child.epoch,
                view: "recent_activity",
                assistantLimit: options.assistantLimit ?? 2,
                toolLimit: options.toolLimit ?? 3,
                maximumBytes,
                ...(options.afterActivity ? { after: options.afterActivity } : {}),
                ...readLeafOptions(child),
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
    async read(parentSessionId, agentId, options, signal) {
        return this.runOperation(parentSessionId, 5_000, signal, async () => {
            const { child } = await this.requireDirectSession(parentSessionId, agentId);
            return readSessionView({ ...options, sessionFile: child.runtime.sessionFile,
                agentId, epoch: child.epoch, ...readLeafOptions(child) });
        });
    }
    list(parentSessionId, signal) {
        return this.runOperation(parentSessionId, 5_000, signal, () => this.listInternal(parentSessionId));
    }
    async listInternal(parentSessionId) {
        const controller = await this.claimNamespace(parentSessionId, false);
        if (controller)
            await this.reconcileOwnedSessions(parentSessionId);
        const parent = controller ? await this.store.update(parentSessionId, async (latestParent) => (this.reapExpiredReservations(latestParent))) : await this.requireSession(parentSessionId);
        this.assertRootNamespace(parent);
        const diagnostics = [];
        const observations = new Map();
        const interruptions = [];
        const entries = await Promise.all(parent.children.map(async (link) => {
            const child = await this.store.load(link.agentId, parent).catch((error) => {
                currentOperation()?.signal.throwIfAborted();
                diagnostics.push({ agentId: link.agentId, reason: String(error) });
                return undefined;
            });
            if (!child || child.epoch !== link.epoch) {
                if (!diagnostics.some((entry) => entry.agentId === link.agentId))
                    diagnostics.push({ agentId: link.agentId, reason: "Managed binding is missing or its epoch changed; capacity is retained" });
                return {
                    agent: managedAgentFromLink(link, "interrupted"),
                    activeProcessId: link.launch.processInstanceId,
                };
            }
            this.assertDirectOwnership(parent, link, child);
            this.assertManagedLeaf(child);
            const processId = child.runtime.processInstanceId ?? link.launch.processInstanceId;
            let observation = observations.get(processId);
            if (!observation) {
                observation = this.observeRuntime(child.runtime.tmux);
                observations.set(processId, observation);
            }
            const observed = await observation;
            if (observed.reason && observed.process === "unknown")
                diagnostics.push({ agentId: child.sessionId, reason: observed.reason });
            const alive = child.runtime.status === "closing" || observed.process !== "exited";
            if (!alive) {
                if (controller && child.runtime.status !== "interrupted")
                    interruptions.push(child);
                const interrupted = await this.markInterrupted(child, false);
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
        if (interruptions.length)
            await this.store.update(parentSessionId, latest => ({
                ...latest,
                control: { ...latest.control, tombstones: latest.control?.tombstones ?? {}, children: {
                        ...latest.control?.children,
                        ...Object.fromEntries(interruptions.filter(child => !latest.control?.tombstones[child.sessionId]
                            && latest.control?.children[child.sessionId]?.status !== "closing")
                            .map(child => [child.sessionId, { epoch: child.epoch, status: "interrupted", updatedAt: this.now() }])),
                    } },
            }));
        const activeProcessIds = new Set(entries.flatMap((entry) => (entry.activeProcessId ? [entry.activeProcessId] : [])));
        for (const [processId, managed] of Object.entries(parent.processes ?? {})) {
            if (observations.has(processId))
                continue;
            const observed = await this.observeRuntime(managed.tmux);
            if (managed.phase === "closing" || observed.process !== "exited")
                activeProcessIds.add(processId);
            if (observed.reason)
                diagnostics.push({ agentId: processId, reason: observed.reason });
        }
        const pendingProcessIds = new Set(parent.reservations.flatMap((reservation) => (activeProcessIds.has(reservation.processInstanceId)
            ? []
            : [reservation.processInstanceId])));
        const used = activeProcessIds.size + pendingProcessIds.size;
        return {
            agents: entries.map((entry) => entry.agent),
            ...(diagnostics.length ? { diagnostics } : {}),
            capacity: {
                active: activeProcessIds.size,
                pending: pendingProcessIds.size,
                limit: this.maxActive,
                available: Math.max(0, this.maxActive - used),
            },
        };
    }
    async prompt(parentSessionId, agentId, text, delivery, signal) {
        return this.runOperation(parentSessionId, this.promptAckTimeoutMs + 5_000, signal, () => this.withPromptLock(agentId, () => (this.deliverPrompt(parentSessionId, agentId, text, delivery))));
    }
    async deliverPrompt(parentSessionId, agentId, text, delivery) {
        await this.claimNamespace(parentSessionId);
        const { wireText, deliveryId, marker } = createPromptEnvelope(text);
        const { child, parent } = await this.requireDirectSession(parentSessionId, agentId);
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
        await this.store.recordDelivery(parent, child, deliveryId, delivery);
        await this.beforePrompt?.(parentSessionId, child);
        const operation = currentOperation();
        if (operation)
            operation.interruptionError = (reason) => new DeliveryUnconfirmedError(deliveryId, reason);
        let confirmation;
        try {
            if (operation)
                await operation.run(() => this.runtime.sendPrompt(locator, wireText, delivery));
            else
                await this.runtime.sendPrompt(locator, wireText, delivery);
            confirmation = await this.waitForPromptConfirmation({ child, locator, deliveryId, marker, after: baselineCursor });
        }
        catch (error) {
            if (error instanceof DeliveryUnconfirmedError)
                throw error;
            throw new DeliveryUnconfirmedError(deliveryId, error);
        }
        return {
            agent: {
                ...toManagedAgent(child),
                settledCursor: encodeSettledCursor({
                    agentId: child.sessionId,
                    epoch: child.epoch,
                    generation: child.runtime.settledGeneration,
                    deliveryId,
                }),
            },
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
                hasPersistedPrompt({
                    sessionFile: options.child.runtime.sessionFile,
                    agentId: options.child.sessionId,
                    epoch: options.child.epoch,
                    after: options.after,
                    marker: options.marker,
                }),
                this.runtime.capturePane(options.locator),
            ]);
            if (sessionResult.status === "fulfilled"
                && sessionResult.value) {
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
            if (parent.control?.closingAll)
                throw new Error(`Subagent namespace is closing: ${parentSessionId}`);
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
        const registered = await this.store.listOwned(parent);
        const retained = [];
        for (const reservation of parent.reservations) {
            const expiresAt = Date.parse(reservation.expiresAt);
            const child = registered.find((state) => matchesReservation(state, parent, reservation));
            if (child) {
                this.assertManagedLeaf(child);
                parent = registerDirectChild(parent, child, this.now());
                continue;
            }
            if (Number.isFinite(expiresAt) && expiresAt > this.nowMs()) {
                retained.push(reservation);
                continue;
            }
            if (!reservation.tmux) {
                if (reservation.launchState !== "reserved")
                    retained.push(reservation);
                continue;
            }
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
    async attachReservationLocator(parentSessionId, parentEpoch, reservation, locator) {
        const reservationId = reservation.reservationId;
        await this.store.update(parentSessionId, async (parent) => {
            if (parent.epoch !== parentEpoch) {
                throw new Error(`Spawn reservation is no longer active: ${reservationId}`);
            }
            if (!parent.reservations.some((candidate) => (candidate.reservationId === reservationId
                && candidate.processInstanceId === reservation.processInstanceId))) {
                const child = (await this.store.listOwned(parent)).find((state) => (matchesReservation(state, parent, { ...reservation, tmux: locator })));
                if (!child)
                    throw new Error(`Spawn reservation is no longer active: ${reservationId}`);
                this.assertManagedLeaf(child);
                return registerDirectChild(parent, child, this.now());
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
        const unknown = new Set();
        const candidates = new Map();
        for (const link of parent.children) {
            const child = await this.store.load(link.agentId, parent).catch(() => undefined);
            if (!child || child.epoch !== link.epoch) {
                unknown.add(link.launch.processInstanceId);
                continue;
            }
            this.assertDirectOwnership(parent, link, child);
            this.assertManagedLeaf(child);
            candidates.set(child.sessionId, {
                child,
                processInstanceId: child.runtime.processInstanceId
                    ?? link.launch.processInstanceId,
            });
        }
        for (const child of await this.store.listOwned(parent)) {
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
        const active = new Set(unknown);
        const observations = new Map();
        for (const { child, processInstanceId } of candidates.values()) {
            if (child.runtime.status === "closing") {
                active.add(processInstanceId);
                continue;
            }
            if (active.has(processInstanceId))
                continue;
            const observation = observations.get(processInstanceId) ?? await this.observeRuntime(child.runtime.tmux);
            observations.set(processInstanceId, observation);
            if (observation.process !== "exited") {
                active.add(processInstanceId);
            }
            else {
                await this.markInterrupted(child, false);
            }
        }
        const bound = new Set([...candidates.values()].map((entry) => entry.processInstanceId));
        for (const [processId, managed] of Object.entries(parent.processes ?? {})) {
            if (bound.has(processId) || active.has(processId))
                continue;
            if (managed.phase === "closing" || (await this.observeRuntime(managed.tmux)).process !== "exited")
                active.add(processId);
        }
        return active;
    }
    async retireProcesses(parentId, processIds) {
        if (!processIds.size)
            return;
        await this.store.update(parentId, (parent) => ({
            ...parent,
            processes: Object.fromEntries(Object.entries(parent.processes ?? {}).filter(([id]) => !processIds.has(id))),
            control: { ...parent.control, children: parent.control?.children ?? {}, tombstones: parent.control?.tombstones ?? {},
                retiredProcesses: { ...parent.control?.retiredProcesses, ...Object.fromEntries([...processIds].map((id) => [id, true])) } },
        }));
    }
    async observeRuntime(locator, options) {
        if (!locator)
            return { identity: "unknown", process: "unknown", terminal: "unknown", promptReady: false, reason: "Runtime locator is unavailable" };
        const operation = currentOperation();
        const queryOptions = { ...options, signal: options?.signal ?? operation?.signal, timeout: operation?.remainingMs };
        if (this.runtime.observe)
            return operation
                ? operation.run(() => this.runtime.observe(locator, queryOptions))
                : this.runtime.observe(locator, queryOptions);
        try {
            const alive = await (operation ? operation.run(() => this.runtime.isAlive(locator, queryOptions)) : this.runtime.isAlive(locator, queryOptions));
            return { identity: "matched", process: alive ? "alive" : "exited", terminal: alive ? "present" : "absent", promptReady: alive, locator };
        }
        catch (error) {
            queryOptions.signal?.throwIfAborted();
            return { identity: "unknown", process: "unknown", terminal: "unknown", promptReady: false, reason: String(error) };
        }
    }
    async confirmClosed(locator) {
        const deadline = performance.now() + this.closeTimeoutMs;
        while (true) {
            const observed = await this.observeRuntime(locator);
            if (observed.process === "exited" && observed.terminal === "absent")
                return;
            if (observed.identity !== "matched" && observed.terminal !== "absent")
                throw new Error(observed.reason ?? "Close outcome is unknown; capacity is retained");
            if (performance.now() >= deadline) {
                throw new Error(`Timed out waiting for tmux window to close: ${locator.windowId}`);
            }
            await this.sleep(this.pollIntervalMs);
        }
    }
    async requireDirectSession(parentSessionId, agentId) {
        let parent = await this.requireSession(parentSessionId);
        this.assertRootNamespace(parent);
        if (!parent.children.some((link) => link.agentId === agentId) && await this.claimNamespace(parentSessionId, false)) {
            await this.reconcileOwnedSessions(parentSessionId);
            parent = await this.requireSession(parentSessionId);
        }
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
            const child = await this.store.load(link.agentId, parent).catch(() => undefined);
            if (!child || child.epoch !== link.epoch)
                continue;
            this.assertDirectOwnership(parent, link, child);
            this.assertManagedLeaf(child);
        }
        const discovered = (await this.store.listOwned(parent)).filter((state) => (!linkedIds.has(state.sessionId)
            && state.parent?.sessionId === parent.sessionId
            && state.parent.epoch === parent.epoch
            && state.launch !== undefined
            && state.runtime.tmux !== undefined));
        for (const child of discovered)
            this.assertManagedLeaf(child);
        if (discovered.length === 0)
            return;
        await this.store.update(parent.sessionId, (latestParent) => {
            const linked = discovered.reduce((state, child) => state.children.some((link) => link.agentId === child.sessionId)
                ? state
                : registerDirectChild(state, child, this.now()), latestParent);
            return {
                ...linked,
                reservations: linked.reservations.filter((reservation) => !discovered.some((child) => matchesReservation(child, linked, reservation))),
            };
        });
    }
    async markInterrupted(child, persist = true) {
        // Exit observations are parent facts, not child lifecycle events.
        if (persist && child.parent && await this.claimNamespace(child.parent.sessionId, false))
            await this.recordControlStatus(child, "interrupted");
        return { ...child, runtime: { ...child.runtime, status: "interrupted", busy: false } };
    }
    async recordControlStatus(child, status) {
        if (!child.parent)
            throw new Error("Missing managed child ownership");
        await this.store.update(child.parent.sessionId, (parent) => {
            if (parent.epoch !== child.parent.epoch)
                throw new Error("Subagent namespace epoch changed");
            return {
                ...parent,
                ...(status === "closing" && child.launch && parent.processes?.[child.launch.processInstanceId] ? {
                    processes: { ...parent.processes, [child.launch.processInstanceId]: { ...parent.processes[child.launch.processInstanceId], phase: "closing" } },
                } : {}),
                control: {
                    ...parent.control,
                    tombstones: parent.control?.tombstones ?? {},
                    children: { ...parent.control?.children, [child.sessionId]: { epoch: child.epoch, status, updatedAt: this.now() } },
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
    async waitForRegistration(parent, reservation) {
        const deadline = Date.now() + this.registrationTimeoutMs;
        while (true) {
            const matches = (await this.store.listOwned(parent)).filter((state) => (matchesReservation(state, parent, reservation)));
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
function readLeafOptions(child) {
    const runtime = child.runtime;
    if (runtime.leafPosition !== undefined || runtime.leafPinned) {
        return { leafId: runtime.leafId ?? null, leafPosition: runtime.leafPosition };
    }
    const unfinished = runtime.generation > runtime.settledGeneration;
    const stopped = runtime.status === "interrupted" || runtime.status === "closed" || runtime.status === "errored";
    return runtime.leafId && !runtime.busy && !(unfinished && stopped)
        ? { leafId: runtime.leafId }
        : {};
}
function matchesReservation(child, parent, reservation) {
    const locator = child.runtime.tmux;
    return child.parent?.sessionId === parent.sessionId
        && child.parent.epoch === parent.epoch
        && child.parent.registrationToken === reservation.reservationId
        && child.launch?.processInstanceId === reservation.processInstanceId
        && child.runtime.processInstanceId === reservation.processInstanceId
        && locator !== undefined
        && (!reservation.tmux || (locator.sessionName === reservation.tmux.sessionName
            && locator.windowId === reservation.tmux.windowId
            && locator.paneId === reservation.tmux.paneId
            && locator.panePid === reservation.tmux.panePid));
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