import { allocateHeroName } from "./hero-names.js";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { privateEnvironmentScript } from "./auth-environment.js";
import { rejectionMessages, type PromptRejectionCode } from "./prompt-auth.js";
import { join, resolve } from "node:path";

import { encodeActivityCursor, encodeSettledCursor } from "./cursor.js";
import { currentOperation, DeadlineExceeded, withCleanupOperation, withOperation } from "./operation.js";
import { acquireFileLock, type FileLock } from "./file-lock.js";
import {
  getDirectChild,
  registerDirectChild,
  removeDirectChildren,
} from "./ownership.js";
import {
  readSessionView,
  readSessionSnapshot,
  hasPersistedPrompt,
  type ReadSessionViewOptions,
  type SessionActivity,
  type SessionViewResult,
} from "./session-reader.js";
import type {
  ChildLink,
  LaunchMetadata,
  ParentOwnership,
  SessionState,
  SpawnReservation,
  TmuxLocator,
} from "./state-store.js";
import { SessionStateStore, SESSION_STATE_SCHEMA_VERSION } from "./state-store.js";
import type {
  PromptDelivery,
  TmuxLaunchOptions,
  RuntimeObservation,
  RuntimeQueryOptions,
} from "./tmux-runtime.js";
import {
  waitForSettled,
  type WaitForSettledResult,
} from "./wait.js";

export const PI_SUBAGENT_MAX_ACTIVE = "PI_SUBAGENT_MAX_ACTIVE";
export const PI_SUBAGENT_STATE_ROOT = "PI_SUBAGENT_STATE_ROOT";
export const PI_SUBAGENT_PARENT = "PI_SUBAGENT_PARENT";
export const PI_SUBAGENT_LAUNCH = "PI_SUBAGENT_LAUNCH";
export const PROMPT_READY_COMMAND = "subagent-runtime-ready";

const WAIT_PAYLOAD_MAX_BYTES = 72 * 1024;

export interface ManagedTmuxRuntime {
  launch(options: TmuxLaunchOptions): Promise<TmuxLocator>;
  sendPrompt(locator: TmuxLocator, text: string, delivery: PromptDelivery): Promise<void>;
  capturePane(locator: TmuxLocator): Promise<string>;
  isAlive(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<boolean>;
  observe?(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<RuntimeObservation>;
  close(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<void>;
}

export interface SubagentManagerOptions {
  store: SessionStateStore;
  runtime: ManagedTmuxRuntime;
  stateRoot: string;
  nativeSessionRoot: string;
  extensionPath: string;
  piPath: string;
  environment: Record<string, string>;
  authenticationEnvironment?: (model: SubagentModel | undefined) => Promise<Record<string, string>>;
  createId?: () => string;
  now?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  registrationTimeoutMs?: number;
  pollIntervalMs?: number;
  promptAckTimeoutMs?: number;
  closeTimeoutMs?: number;
  maxActive?: number;
  reservationTtlMs?: number;
  nowMs?: () => number;
  beforePrompt?: (parentSessionId: string, child: SessionState) => Promise<void>;
}

/** Provider and model identity resolved by the caller before allocating a child. */
export interface SubagentModel {
  provider: string;
  id: string;
}

export interface SpawnSubagentOptions {
  task: string;
  cwd?: string;
  model?: SubagentModel;
  thinkingLevel?: string;
}

export interface SpawnDefaults {
  cwd: string;
  model?: SubagentModel;
  thinkingLevel?: string;
}

export interface ManagedAgent {
  agentId: string;
  name: string;
  status: SessionState["runtime"]["status"];
  generation: number;
  settledGeneration: number;
  settledCursor: string;
  model?: string;
  thinkingLevel?: string;
  tmux?: TmuxLocator;
  sessionFile: string;
}

export interface SubagentCapacity {
  active: number;
  pending: number;
  limit: number;
  available: number;
}

export interface ManagedAgentList {
  agents: ManagedAgent[];
  capacity: SubagentCapacity;
  diagnostics?: Array<{ agentId: string; reason: string }>;
}

export type PromptConfirmation =
  | "session"
  | "steering_queue"
  | "follow_up_queue";

export interface ManagedPromptResult {
  agent: ManagedAgent;
  deliveryId: string;
  confirmation: PromptConfirmation;
}

export class DeliveryUnconfirmedError extends Error {
  readonly code = "delivery_unconfirmed";

  constructor(readonly deliveryId: string, cause?: unknown) {
    super(`delivery_unconfirmed: Child Pi may already have accepted the prompt (deliveryId: ${deliveryId})`, { cause });
    this.name = "DeliveryUnconfirmedError";
  }
}

export class DeliveryRejectedError extends Error {
  readonly code = "delivery_rejected";
  constructor(readonly deliveryId: string, readonly reason: PromptRejectionCode) {
    super(`delivery_rejected: ${rejectionMessages[reason]} (deliveryId: ${deliveryId})`);
    this.name = "DeliveryRejectedError";
  }
}

export interface WaitManagedOptions {
  afterSettled: string;
  timeoutMs: number;
  afterActivity?: string;
  assistantLimit?: number;
  toolLimit?: number;
}

export interface ManagedWaitResult extends WaitForSettledResult {
  agent: ManagedAgent;
  activity: SessionActivity[];
  activityCursor?: string;
  assistantCount: number;
  toolCount: number;
  omittedAssistant: number;
  omittedTools: number;
  hasMore: boolean;
  returnedBytes: number;
}

export class SubagentManager {
  private readonly store: SessionStateStore;
  private readonly runtime: ManagedTmuxRuntime;
  private readonly stateRoot: string;
  private readonly nativeSessionRoot: string;
  private readonly extensionPath: string;
  private readonly piPath: string;
  private readonly environment: Record<string, string>;
  private readonly authenticationEnvironment?: SubagentManagerOptions["authenticationEnvironment"];
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly registrationTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly promptAckTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly maxActive: number;
  private readonly reservationTtlMs: number;
  private readonly nowMs: () => number;
  private readonly beforePrompt?: SubagentManagerOptions["beforePrompt"];
  private readonly promptLocks = new Map<string, Promise<void>>();
  private readonly inFlightSpawns = new Map<string, Set<Promise<ManagedAgent>>>();
  private readonly closingNamespaces = new Set<string>();
  private readonly controllers = new Map<string, Promise<FileLock>>();
  private readonly controllerSignals = new Map<string, AbortController>();
  private readonly operations = new Map<string, Set<Promise<unknown>>>();
  private controllersStopped = false;
  private releasingControllers?: Promise<void>;

  private runOperation<T>(sessionId: string, timeout: number, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    if (this.controllersStopped) return Promise.reject(new Error("Subagent controller stopped"));
    let controller = this.controllerSignals.get(sessionId);
    if (!controller) { controller = new AbortController(); this.controllerSignals.set(sessionId, controller); }
    const pending = withOperation(timeout, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal, work);
    const active = this.operations.get(sessionId) ?? new Set<Promise<unknown>>();
    active.add(pending); this.operations.set(sessionId, active);
    const untrack = () => { active.delete(pending); if (!active.size) this.operations.delete(sessionId); };
    void pending.then(untrack, untrack);
    return pending;
  }

  async claimNamespace(sessionId: string, required = true): Promise<boolean> {
    currentOperation()?.signal.throwIfAborted();
    if (this.controllersStopped) throw new Error("Subagent controller stopped");
    this.store.statePath(sessionId);
    let pending = this.controllers.get(sessionId);
    const newlyAcquired = !pending;
    if (!pending) {
      // Share initialization as well as acquisition; no caller may use a half-initialized controller.
      pending = this.initializeController(sessionId);
      this.controllers.set(sessionId, pending);
    }
    let lock: Awaited<typeof pending>;
    try { lock = await pending; }
    catch (error) {
      if (this.controllers.get(sessionId) === pending) this.controllers.delete(sessionId);
      if (!required && error instanceof Error && error.message.startsWith("Subagent control lock unavailable:")) return false;
      throw error;
    }
    if (!newlyAcquired) await this.synchronizeController(sessionId, lock);
    const operation = currentOperation();
    if (operation) operation.assertAuthorized = lock.assertOwned;
    return true;
  }

  private async initializeController(sessionId: string): Promise<FileLock> {
    const lock = await acquireFileLock(join(this.stateRoot, "controllers", sessionId), currentOperation()?.signal, 0);
    this.store.authorizeController(sessionId, lock.assertOwned);
    try {
      await this.synchronizeController(sessionId, lock);
      return lock;
    } catch (error) {
      this.store.rollbackControllerAuthorization(sessionId, lock.assertOwned);
      try { await lock.release(); }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Failed to release uninitialized subagent controller", { cause: error });
      }
      throw error;
    }
  }

  private async synchronizeController(sessionId: string, lock: FileLock): Promise<void> {
    await lock.assertOwned();
    const state = await this.store.loadRuntime(sessionId);
    if (state && state.control?.controllerEpoch !== lock.token) {
      await this.store.update(sessionId, latest => ({ ...latest, control: {
        ...latest.control, children: latest.control?.children ?? {}, tombstones: latest.control?.tombstones ?? {}, controllerEpoch: lock.token,
      } }));
    }
  }

  async controllerGuard(sessionId: string): Promise<() => Promise<void>> {
    const pending = this.controllers.get(sessionId);
    if (!pending) throw new Error("Subagent namespace has no active controller");
    return (await pending).assertOwned;
  }

  async releaseNamespace(sessionId: string): Promise<void> {
    const pending = this.controllers.get(sessionId);
    this.controllerSignals.get(sessionId)?.abort(new Error("Subagent controller stopped"));
    await Promise.allSettled([...(this.operations.get(sessionId) ?? [])]);
    // Initialization rolls back its acquisition; aggregate cleanup failures must remain visible.
    const lock = await pending?.catch((error: unknown) => {
      if (error instanceof AggregateError) throw error;
      return undefined;
    });
    await lock?.release();
    if (this.controllers.get(sessionId) === pending) this.controllers.delete(sessionId);
    this.controllerSignals.delete(sessionId);
  }

  releaseAllNamespaces(): Promise<void> {
    this.controllersStopped = true;
    if (this.releasingControllers) return this.releasingControllers;
    for (const controller of this.controllerSignals.values()) controller.abort(new Error("Subagent controller stopped"));
    const sessionIds = new Set([...this.controllers.keys(), ...this.controllerSignals.keys()]);
    const pending = Promise.allSettled([...sessionIds].map(sessionId => this.releaseNamespace(sessionId))).then(outcomes => {
      const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(outcome => outcome.reason), "Failed to release subagent controllers");
    });
    this.releasingControllers = pending;
    const clear = () => { if (this.releasingControllers === pending) this.releasingControllers = undefined; };
    void pending.then(clear, clear);
    return pending;
  }

  async resumeControllers(): Promise<void> {
    await this.releasingControllers;
    if (this.controllersStopped && this.controllers.size) throw new Error("Subagent controller cleanup is incomplete");
    this.controllersStopped = false;
  }

  constructor(options: SubagentManagerOptions) {
    this.store = options.store;
    this.runtime = options.runtime;
    this.stateRoot = options.stateRoot;
    this.nativeSessionRoot = options.nativeSessionRoot;
    this.extensionPath = options.extensionPath;
    this.piPath = options.piPath;
    this.environment = options.environment;
    this.authenticationEnvironment = options.authenticationEnvironment;
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

  spawn(
    parentSessionId: string,
    options: SpawnSubagentOptions,
    defaults: SpawnDefaults,
    signal?: AbortSignal,
  ): Promise<ManagedAgent> {
    const operation = this.runOperation(parentSessionId, this.registrationTimeoutMs + this.promptAckTimeoutMs + 5_000, signal,
      () => {
        const pending = this.spawnInternal(parentSessionId, options, defaults);
        return currentOperation()?.trackResource(pending) ?? pending;
      });
    const inFlight = this.inFlightSpawns.get(parentSessionId) ?? new Set();
    inFlight.add(operation);
    this.inFlightSpawns.set(parentSessionId, inFlight);
    const untrack = (): void => {
      inFlight.delete(operation);
      if (inFlight.size === 0) this.inFlightSpawns.delete(parentSessionId);
    };
    void operation.then(untrack, untrack);
    return operation;
  }

  private async spawnInternal(
    parentSessionId: string,
    options: SpawnSubagentOptions,
    defaults: SpawnDefaults,
  ): Promise<ManagedAgent> {
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
    const reservation: SpawnReservation = {
      reservationId: registrationToken,
      processInstanceId,
      createdAt: this.now(),
      expiresAt: new Date(this.nowMs() + this.reservationTtlMs).toISOString(),
      launchState: "reserved",
    };
    const displayName = await this.reserveSpawn(parent.sessionId, reservation);
    const cwd = resolve(defaults.cwd, options.cwd ?? ".");
    const selectedModel = options.model ?? defaults.model;
    const model = selectedModel ? `${selectedModel.provider}/${selectedModel.id}` : undefined;
    const thinkingLevel = options.thinkingLevel ?? defaults.thinkingLevel;
    const sessionDir = join(this.nativeSessionRoot, parent.sessionId, processInstanceId);
    const sessionFile = join(sessionDir, "session.jsonl");
    const parentOwnership: ParentOwnership = {
      sessionId: parent.sessionId,
      epoch: parent.epoch,
      registrationToken,
    };
    const launch: LaunchMetadata = {
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
      `/${PROMPT_READY_COMMAND} ${processInstanceId}`,
    ];

    let locator: TmuxLocator | undefined;
    let registeredChild: SessionState | undefined;
    let launchAttempted = false;
    let privateEnvironmentFile: string | undefined;
    let privateEnvironmentDirectory: string | undefined;
    try {
      await mkdir(sessionDir, { recursive: true });
      const authentication = await this.authenticationEnvironment?.(selectedModel) ?? {};
      if (Object.keys(authentication).length) {
        privateEnvironmentDirectory = await mkdtemp(join(sessionDir, ".auth-"));
        privateEnvironmentFile = join(privateEnvironmentDirectory, "environment.sh");
        await writeFile(privateEnvironmentFile, privateEnvironmentScript(authentication), { flag: "wx", mode: 0o600 });
      }
      await writeFile(sessionFile, "", { encoding: "utf8", mode: 0o600, flag: "wx" });
      await this.store.update(parent.sessionId, (latest) => {
        if (latest.epoch !== parent.epoch || !latest.reservations.some(entry => (
          entry.reservationId === registrationToken && entry.processInstanceId === processInstanceId
        ))) throw new Error(`Spawn reservation is no longer active: ${registrationToken}`);
        return { ...latest, reservations: latest.reservations.map(entry => (
          entry.reservationId === registrationToken ? { ...entry, launchState: "launching" } : entry
        )) };
      });
      launchAttempted = true;
      locator = await this.runtime.launch({
        cwd,
        windowName: normalizeWindowName(displayName),
        command: this.piPath,
        args,
        ...(privateEnvironmentFile ? { privateEnvironmentFile } : {}),
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
        reservations: latestParent.reservations.filter(
          (candidate) => candidate.reservationId !== registrationToken,
        ),
      }));
      const initialDelivery = await this.prompt(
        parent.sessionId,
        child.sessionId,
        options.task,
        "steer",
      );
      return initialDelivery.agent;
    } catch (error) {
      if (launchAttempted && !locator) throw error;
      const cleanup = async () => {
        if (locator) {
          try {
            await this.runtime.close(locator);
            await this.confirmClosed(locator);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Failed to clean up a failed subagent spawn",
            );
          }
        }
        const failedChildren = (await this.store.listOwned(parent)).filter((state) => (
          state.parent?.sessionId === parent.sessionId
          && state.parent.epoch === parent.epoch
          && state.parent.registrationToken === registrationToken
          && state.launch?.processInstanceId === processInstanceId
        ));
        if (
          registeredChild
          && !failedChildren.some((state) => state.sessionId === registeredChild?.sessionId)
        ) {
          failedChildren.push(registeredChild);
        }
        const failedChildIds = new Set(failedChildren.map((state) => state.sessionId));
        await this.retireProcesses(parent.sessionId, new Set([processInstanceId]));
        await this.store.update(parent.sessionId, (latestParent) => ({
          ...removeDirectChildren(latestParent, failedChildIds),
          reservations: latestParent.reservations.filter(
            (candidate) => candidate.reservationId !== registrationToken,
          ),
        }));
        for (const child of failedChildren) {
          await this.store.delete(child.sessionId);
        }
      };
      const operation = currentOperation();
      if (operation?.signal.aborted) {
        try { await withCleanupOperation(cleanup); }
        catch (cleanupError) { operation.reportCleanupError(cleanupError); }
      } else await cleanup();
      throw error;
    } finally {
      if (privateEnvironmentDirectory) await rm(privateEnvironmentDirectory, { recursive: true, force: true });
    }
  }

  close(parentSessionId: string, target: string, signal?: AbortSignal): Promise<ManagedAgent[]> {
    return this.runOperation(parentSessionId, this.closeTimeoutMs, signal, async () => {
      await this.claimNamespace(parentSessionId);
      return this.closeInternal(parentSessionId, target);
    });
  }

  private closeInternal(
    parentSessionId: string,
    target: string,
  ): Promise<ManagedAgent[]> {
    if (target !== "all") return this.closeDirect(parentSessionId, target);
    if (this.closingNamespaces.has(parentSessionId)) {
      return Promise.reject(new Error(`Subagent namespace is already closing: ${parentSessionId}`));
    }
    this.closingNamespaces.add(parentSessionId);
    return this.closeAll(parentSessionId).finally(() => {
      this.closingNamespaces.delete(parentSessionId);
    });
  }

  private async closeAll(parentSessionId: string): Promise<ManagedAgent[]> {
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
      if (!managed.tmux) throw new Error(`Managed process locator is unavailable: ${processId}`);
      await this.runtime.close(managed.tmux);
      await this.confirmClosed(managed.tmux);
      await this.retireProcesses(parentSessionId, new Set([processId]));
    }
    await this.store.update(parentSessionId, (latest) => ({ ...latest, control: { ...latest.control!, closingAll: false } }));
    return affected;
  }

  private async closeReservations(parentSessionId: string): Promise<void> {
    const parent = await this.requireSession(parentSessionId);
    this.assertRootNamespace(parent);
    const childProcessIds = new Set<string>();
    const registeredChildren: SessionState[] = [];
    for (const link of parent.children) {
      const child = await this.store.load(link.agentId);
      if (child?.epoch !== link.epoch) continue;
      childProcessIds.add(
        child.runtime.processInstanceId ?? link.launch.processInstanceId,
      );
    }
    for (const child of await this.store.listOwned(parent)) {
      if (
        child.parent?.sessionId !== parent.sessionId
        || child.parent.epoch !== parent.epoch
        || !child.launch
        || !child.runtime.tmux
      ) {
        continue;
      }
      this.assertManagedLeaf(child);
      registeredChildren.push(child);
      childProcessIds.add(
        child.runtime.processInstanceId ?? child.launch.processInstanceId,
      );
    }

    const closedProcessIds = new Set<string>();
    for (const reservation of parent.reservations) {
      if (
        childProcessIds.has(reservation.processInstanceId)
        || closedProcessIds.has(reservation.processInstanceId)
      ) {
        continue;
      }
      if (reservation.tmux) {
        await this.runtime.close(reservation.tmux);
        await this.confirmClosed(reservation.tmux);
      } else if (reservation.launchState !== "reserved") {
        throw new Error(`Subagent launch outcome is unknown; locator unavailable: ${reservation.processInstanceId}`);
      }
      closedProcessIds.add(reservation.processInstanceId);
    }

    const reservationIds = new Set(parent.reservations.map((reservation) => (
      reservation.reservationId
    )));
    await this.store.update(parentSessionId, (latestParent) => ({
      ...registeredChildren.reduce((state, child) => registerDirectChild(state, child, this.now()), latestParent),
      reservations: latestParent.reservations.filter(
        (reservation) => !reservationIds.has(reservation.reservationId),
      ),
    }));
  }

  private async closeDirect(
    parentSessionId: string,
    target: string,
  ): Promise<ManagedAgent[]> {
    await this.reconcileOwnedSessions(parentSessionId);
    const parent = await this.requireSession(parentSessionId);
    this.assertRootNamespace(parent);
    const links = targetLinks(parent, target);
    const states = await Promise.all(links.map(async (link) => {
      const state = await this.requireSession(link.agentId);
      if (
        state.epoch !== link.epoch
        || state.parent?.sessionId !== parent.sessionId
        || state.parent.epoch !== parent.epoch
      ) {
        throw new Error(`Managed child ownership does not match its direct link: ${link.agentId}`);
      }
      this.assertManagedLeaf(state);
      return state;
    }));
    const selectedIds = new Set(states.map((state) => state.sessionId));
    const siblingStates = (await Promise.all(parent.children
      .filter((link) => !selectedIds.has(link.agentId))
      .map((link) => this.store.load(link.agentId))))
      .filter((state): state is SessionState => state !== undefined);
    const activeStates: SessionState[] = [];
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
          .filter((sibling) => (
            (sibling.runtime.processInstanceId ?? sibling.launch?.processInstanceId)
              === processInstanceId
            && (!hasActiveStatus || sibling.runtime.updatedAt > state.runtime.updatedAt)
            && (
              sibling.runtime.status === "starting"
              || sibling.runtime.status === "running"
              || sibling.runtime.status === "settled"
              || sibling.runtime.status === "closing"
            )
            && sibling.runtime.tmux !== undefined
          ))
          .map(async sibling => {
            const observed = await this.observeRuntime(sibling.runtime.tmux);
            if (observed.process === "unknown" || observed.identity === "mismatch") {
              throw new Error(observed.reason ?? "Shared process identity is unknown; management is retained");
            }
            return observed.identity === "matched" && observed.process === "alive";
          }));
      const hasNewerLiveSibling = newerSiblingLiveness.some(Boolean);
      if (!hasNewerLiveSibling) activeStates.push(state);
    }
    for (const state of activeStates) {
      await this.recordControlStatus(state, "closing");
    }

    const closedProcessIds = new Set<string>();
    try {
      for (const state of activeStates) {
        const processInstanceId = state.runtime.processInstanceId
          ?? state.launch?.processInstanceId
          ?? state.sessionId;
        if (closedProcessIds.has(processInstanceId)) continue;
        const locator = state.runtime.tmux ?? parent.processes?.[processInstanceId]?.tmux;
        if (!locator) throw new Error(`Subagent runtime locator is unavailable: ${processInstanceId}`);
        const observed = await this.observeRuntime(locator);
        if (observed.identity !== "matched" && observed.process !== "exited") throw new Error(observed.reason ?? "Close identity is unknown");
        await this.runtime.close(locator);
        await this.confirmClosed(locator);
        closedProcessIds.add(processInstanceId);
      }
    } catch (error) {
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

  async wait(
    parentSessionId: string,
    agentId: string,
    options: WaitManagedOptions,
    signal?: AbortSignal,
  ): Promise<ManagedWaitResult> {
    const startedAt = performance.now();
    let initial: { parent: SessionState; child: SessionState } | undefined;
    try {
      return await this.runOperation(parentSessionId, options.timeoutMs === 0 ? 250 : options.timeoutMs, signal, async () => {
        initial = await this.requireDirectSession(parentSessionId, agentId);
        return this.waitInternal(parentSessionId, agentId, options, currentOperation()!.signal, initial);
      });
    } catch (error) {
      if (!(error instanceof DeadlineExceeded) || !initial) throw error;
      return finalizeManagedWaitResult({ outcome: "timeout", generation: initial.child.runtime.generation,
        durationMs: performance.now() - startedAt, agent: toManagedAgent(initial.child), activity: [],
        assistantCount: 0, toolCount: 0, omittedAssistant: 0, omittedTools: 0, hasMore: false });
    }
  }

  private async waitInternal(parentSessionId: string, agentId: string, options: WaitManagedOptions, signal: AbortSignal,
    initial: { parent: SessionState; child: SessionState }): Promise<ManagedWaitResult> {
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

  async read(
    parentSessionId: string,
    agentId: string,
    options: Omit<
      ReadSessionViewOptions,
      "sessionFile" | "agentId" | "epoch" | "leafId" | "leafPosition"
    >,
    signal?: AbortSignal,
  ): Promise<SessionViewResult & { agent: ManagedAgent }> {
    return this.runOperation(parentSessionId, 5_000, signal, async () => {
      const { child } = await this.requireDirectSession(parentSessionId, agentId);
      const result = await readSessionView({ ...options, sessionFile: child.runtime.sessionFile,
        agentId, epoch: child.epoch, ...readLeafOptions(child) });
      return { ...result, agent: toManagedAgent(child) };
    });
  }

  list(parentSessionId: string, signal?: AbortSignal): Promise<ManagedAgentList> {
    return this.runOperation(parentSessionId, 5_000, signal, () => this.listInternal(parentSessionId));
  }

  private async listInternal(parentSessionId: string): Promise<ManagedAgentList> {
    const controller = await this.claimNamespace(parentSessionId, false);
    if (controller) await this.reconcileOwnedSessions(parentSessionId);
    const parent = controller ? await this.store.update(parentSessionId, async (latestParent) => (
      this.reapExpiredReservations(latestParent)
    )) : await this.requireSession(parentSessionId);
    this.assertRootNamespace(parent);
    const diagnostics: Array<{ agentId: string; reason: string }> = [];
    const observations = new Map<string, Promise<RuntimeObservation>>();
    const interruptions: SessionState[] = [];
    const entries = await Promise.all(parent.children.map(async (link) => {
      const child = await this.store.load(link.agentId, parent).catch((error: unknown) => {
        currentOperation()?.signal.throwIfAborted();
        diagnostics.push({ agentId: link.agentId, reason: String(error) });
        return undefined;
      });
      if (!child || child.epoch !== link.epoch) {
        if (!diagnostics.some((entry) => entry.agentId === link.agentId)) diagnostics.push({ agentId: link.agentId, reason: "Managed binding is missing or its epoch changed; capacity is retained" });
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
      if (observed.reason && observed.process === "unknown") diagnostics.push({ agentId: child.sessionId, reason: observed.reason });
      const alive = child.runtime.status === "closing" || observed.process !== "exited";
      if (!alive) {
        if (controller && child.runtime.status !== "interrupted") interruptions.push(child);
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
    if (interruptions.length) await this.store.update(parentSessionId, latest => ({
      ...latest,
      control: { ...latest.control, tombstones: latest.control?.tombstones ?? {}, children: {
        ...latest.control?.children,
        ...Object.fromEntries(interruptions.filter(child => !latest.control?.tombstones[child.sessionId]
          && latest.control?.children[child.sessionId]?.status !== "closing")
          .map(child => [child.sessionId, { epoch: child.epoch, status: "interrupted" as const, updatedAt: this.now() }])),
      } },
    }));
    const activeProcessIds = new Set(entries.flatMap((entry) => (
      entry.activeProcessId ? [entry.activeProcessId] : []
    )));
    for (const [processId, managed] of Object.entries(parent.processes ?? {})) {
      if (observations.has(processId)) continue;
      const observed = await this.observeRuntime(managed.tmux);
      if (managed.phase === "closing" || observed.process !== "exited") activeProcessIds.add(processId);
      if (observed.reason) diagnostics.push({ agentId: processId, reason: observed.reason });
    }
    const pendingProcessIds = new Set(parent.reservations.flatMap((reservation) => (
      activeProcessIds.has(reservation.processInstanceId)
        ? []
        : [reservation.processInstanceId]
    )));
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

  async prompt(
    parentSessionId: string,
    agentId: string,
    text: string,
    delivery: PromptDelivery,
    signal?: AbortSignal,
  ): Promise<ManagedPromptResult> {
    return this.runOperation(parentSessionId, this.promptAckTimeoutMs + 5_000, signal, () => this.withPromptLock(agentId, () => (
      this.deliverPrompt(parentSessionId, agentId, text, delivery)
    )));
  }

  private async deliverPrompt(
    parentSessionId: string,
    agentId: string,
    text: string,
    delivery: PromptDelivery,
  ): Promise<ManagedPromptResult> {
    await this.claimNamespace(parentSessionId);
    const { wireText, deliveryId, marker } = createPromptEnvelope(text);
    const { child, parent } = await this.requireDirectSession(parentSessionId, agentId);
    if (child.runtime.status !== "running" && child.runtime.status !== "settled") {
      throw new Error(`Managed child is not running: ${agentId}`);
    }
    const locator = child.runtime.tmux;
    if (!locator || !await this.runtime.isAlive(locator)) {
      if (locator) await this.markInterrupted(child);
      throw new Error(`Managed child runtime was interrupted: ${agentId}`);
    }

    const baselineCursor = await this.readPromptBaseline(child);
    await this.store.recordDelivery(parent, child, deliveryId, delivery);
    await this.beforePrompt?.(parentSessionId, child);
    const operation = currentOperation();
    if (operation) operation.interruptionError = (reason) => new DeliveryUnconfirmedError(deliveryId, reason);
    let confirmation: PromptConfirmation;
    try {
      if (operation) await operation.run(() => this.runtime.sendPrompt(locator, wireText, delivery));
      else await this.runtime.sendPrompt(locator, wireText, delivery);
      confirmation = await this.waitForPromptConfirmation({ child, locator, deliveryId, marker, after: baselineCursor });
    } catch (error) {
      if (error instanceof DeliveryUnconfirmedError || error instanceof DeliveryRejectedError) throw error;
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

  private async withPromptLock<T>(
    agentId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.promptLocks.get(agentId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.promptLocks.set(agentId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.promptLocks.get(agentId) === tail) this.promptLocks.delete(agentId);
    }
  }

  private async readPromptBaseline(child: SessionState): Promise<string> {
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
      } catch (error) {
        if (!isPendingPromptBaseline(error)) throw error;
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

  private async waitForPromptConfirmation(options: {
    child: SessionState;
    locator: TmuxLocator;
    deliveryId: string;
    marker: string;
    after: string;
  }): Promise<PromptConfirmation> {
    const deadline = this.nowMs() + this.promptAckTimeoutMs;
    while (true) {
      const [sessionResult, paneResult, runtimeResult] = await Promise.allSettled([
        hasPersistedPrompt({
          sessionFile: options.child.runtime.sessionFile,
          agentId: options.child.sessionId,
          epoch: options.child.epoch,
          after: options.after,
          marker: options.marker,
        }),
        this.runtime.capturePane(options.locator),
        this.store.loadRuntime(options.child.sessionId),
      ]);
      if (
        sessionResult.status === "fulfilled"
        && sessionResult.value
      ) {
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
      const latest = runtimeResult.status === "fulfilled" ? runtimeResult.value : undefined;
      const rejected = latest?.runtime.promptRejection;
      if (latest?.epoch === options.child.epoch
        && latest?.launch?.processInstanceId === options.child.launch?.processInstanceId
        && latest?.parent?.sessionId === options.child.parent?.sessionId
        && latest?.parent?.epoch === options.child.parent?.epoch
        && latest?.parent?.registrationToken === options.child.parent?.registrationToken
        && rejected?.deliveryId === options.deliveryId && Object.hasOwn(rejectionMessages, rejected.code)) {
        throw new DeliveryRejectedError(options.deliveryId, rejected.code);
      }
      const remaining = deadline - this.nowMs();
      if (remaining <= 0) {
        throw new DeliveryUnconfirmedError(options.deliveryId);
      }
      await this.sleep(Math.min(this.pollIntervalMs, remaining));
    }
  }

  private async reserveSpawn(
    parentSessionId: string,
    reservation: SpawnReservation,
  ): Promise<string> {
    let displayName!: string;
    await this.store.update(parentSessionId, async (parent) => {
      if (this.closingNamespaces.has(parentSessionId) && !this.inFlightSpawns.has(parentSessionId)) {
        throw new Error(`Subagent namespace is closing: ${parentSessionId}`);
      }
      this.assertRootNamespace(parent);
      if (parent.control?.closingAll) throw new Error(`Subagent namespace is closing: ${parentSessionId}`);
      const cleanedParent = await this.reapExpiredReservations(parent);
      const activeProcessIds = await this.activeProcessIds(cleanedParent);
      const pendingProcessIds = new Set(cleanedParent.reservations.flatMap((candidate) => (
        activeProcessIds.has(candidate.processInstanceId)
          ? []
          : [candidate.processInstanceId]
      )));
      const used = activeProcessIds.size + pendingProcessIds.size;
      if (used >= this.maxActive) {
        throw new Error(
          `Subagent capacity reached (${used}/${this.maxActive}). Reuse an existing child with subagent_prompt, or close one before spawning another.`,
        );
      }
      const occupied = new Set(cleanedParent.children.map(child => child.name));
      for (const pending of cleanedParent.reservations) {
        if (pending.displayName !== undefined) occupied.add(pending.displayName);
      }
      displayName = allocateHeroName(occupied);
      return {
        ...cleanedParent,
        reservations: [...cleanedParent.reservations, { ...reservation, displayName }],
      };
    });
    return displayName;
  }

  private async reapExpiredReservations(parent: SessionState): Promise<SessionState> {
    const registered = await this.store.listOwned(parent);
    const retained: SpawnReservation[] = [];
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
        if (reservation.launchState !== "reserved") retained.push(reservation);
        continue;
      }
      try {
        await this.runtime.close(reservation.tmux);
        await this.confirmClosed(reservation.tmux);
      } catch {
        retained.push(reservation);
      }
    }
    return retained.length === parent.reservations.length
      ? parent
      : { ...parent, reservations: retained };
  }

  private async attachReservationLocator(
    parentSessionId: string,
    parentEpoch: string,
    reservation: SpawnReservation,
    locator: TmuxLocator,
  ): Promise<void> {
    const reservationId = reservation.reservationId;
    await this.store.update(parentSessionId, async (parent) => {
      if (parent.epoch !== parentEpoch) {
        throw new Error(`Spawn reservation is no longer active: ${reservationId}`);
      }
      if (!parent.reservations.some((candidate) => (
        candidate.reservationId === reservationId
        && candidate.processInstanceId === reservation.processInstanceId
      ))) {
        const child = (await this.store.listOwned(parent)).find((state) => (
          matchesReservation(state, parent, { ...reservation, tmux: locator })
        ));
        if (!child) throw new Error(`Spawn reservation is no longer active: ${reservationId}`);
        this.assertManagedLeaf(child);
        return registerDirectChild(parent, child, this.now());
      }
      return {
        ...parent,
        reservations: parent.reservations.map((candidate) => (
          candidate.reservationId === reservationId
            ? { ...candidate, tmux: locator }
            : candidate
        )),
      };
    });
  }

  private async activeProcessIds(parent: SessionState): Promise<Set<string>> {
    const unknown = new Set<string>();
    const candidates = new Map<string, {
      child: SessionState;
      processInstanceId: string;
    }>();
    for (const link of parent.children) {
      const child = await this.store.load(link.agentId, parent).catch(() => undefined);
      if (!child || child.epoch !== link.epoch) { unknown.add(link.launch.processInstanceId); continue; }
      this.assertDirectOwnership(parent, link, child);
      this.assertManagedLeaf(child);
      candidates.set(child.sessionId, {
        child,
        processInstanceId: child.runtime.processInstanceId
          ?? link.launch.processInstanceId,
      });
    }
    for (const child of await this.store.listOwned(parent)) {
      if (
        candidates.has(child.sessionId)
        || child.parent?.sessionId !== parent.sessionId
        || child.parent.epoch !== parent.epoch
        || !child.launch
      ) {
        continue;
      }
      this.assertManagedLeaf(child);
      candidates.set(child.sessionId, {
        child,
        processInstanceId: child.runtime.processInstanceId
          ?? child.launch.processInstanceId,
      });
    }

    const active = new Set<string>(unknown);
    const observations = new Map<string, RuntimeObservation>();
    for (const { child, processInstanceId } of candidates.values()) {
      if (child.runtime.status === "closing") {
        active.add(processInstanceId);
        continue;
      }
      if (active.has(processInstanceId)) continue;
      const observation = observations.get(processInstanceId) ?? await this.observeRuntime(child.runtime.tmux);
      observations.set(processInstanceId, observation);
      if (observation.process !== "exited") {
        active.add(processInstanceId);
      } else {
        await this.markInterrupted(child, false);
      }
    }
    const bound = new Set([...candidates.values()].map((entry) => entry.processInstanceId));
    for (const [processId, managed] of Object.entries(parent.processes ?? {})) {
      if (bound.has(processId) || active.has(processId)) continue;
      if (managed.phase === "closing" || (await this.observeRuntime(managed.tmux)).process !== "exited") active.add(processId);
    }
    return active;
  }

  private async retireProcesses(parentId: string, processIds: ReadonlySet<string>): Promise<void> {
    if (!processIds.size) return;
    await this.store.update(parentId, (parent) => ({
      ...parent,
      processes: Object.fromEntries(Object.entries(parent.processes ?? {}).filter(([id]) => !processIds.has(id))),
      control: { ...parent.control, children: parent.control?.children ?? {}, tombstones: parent.control?.tombstones ?? {},
        retiredProcesses: { ...parent.control?.retiredProcesses, ...Object.fromEntries([...processIds].map((id) => [id, true as const])) } },
    }));
  }

  private async observeRuntime(locator?: TmuxLocator, options?: RuntimeQueryOptions): Promise<RuntimeObservation> {
    if (!locator) return { identity: "unknown", process: "unknown", terminal: "unknown", promptReady: false, reason: "Runtime locator is unavailable" };
    const operation = currentOperation();
    const queryOptions = { ...options, signal: options?.signal ?? operation?.signal, timeout: operation?.remainingMs };
    if (this.runtime.observe) return operation
      ? operation.run(() => this.runtime.observe!(locator, queryOptions))
      : this.runtime.observe(locator, queryOptions);
    try {
      const alive = await (operation ? operation.run(() => this.runtime.isAlive(locator, queryOptions)) : this.runtime.isAlive(locator, queryOptions));
      return { identity: "matched", process: alive ? "alive" : "exited", terminal: alive ? "present" : "absent", promptReady: alive, locator };
    } catch (error) {
      queryOptions.signal?.throwIfAborted();
      return { identity: "unknown", process: "unknown", terminal: "unknown", promptReady: false, reason: String(error) };
    }
  }

  private async confirmClosed(locator: TmuxLocator): Promise<void> {
    const deadline = performance.now() + this.closeTimeoutMs;
    while (true) {
      const observed = await this.observeRuntime(locator);
      if (observed.process === "exited" && observed.terminal === "absent") return;
      if (observed.identity !== "matched" && observed.terminal !== "absent") throw new Error(observed.reason ?? "Close outcome is unknown; capacity is retained");
      if (performance.now() >= deadline) {
        throw new Error(`Timed out waiting for tmux window to close: ${locator.windowId}`);
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async requireDirectSession(
    parentSessionId: string,
    agentId: string,
  ): Promise<{ parent: SessionState; child: SessionState }> {
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

  private async reconcileOwnedSessions(parentSessionId: string): Promise<void> {
    const parent = await this.requireSession(parentSessionId);
    this.assertRootNamespace(parent);
    const linkedIds = new Set(parent.children.map((child) => child.agentId));
    for (const link of parent.children) {
      const child = await this.store.load(link.agentId, parent).catch(() => undefined);
      if (!child || child.epoch !== link.epoch) continue;
      this.assertDirectOwnership(parent, link, child);
      this.assertManagedLeaf(child);
    }
    const discovered = (await this.store.listOwned(parent)).filter((state) => (
      !linkedIds.has(state.sessionId)
      && state.parent?.sessionId === parent.sessionId
      && state.parent.epoch === parent.epoch
      && state.launch !== undefined
      && state.runtime.tmux !== undefined
    ));
    for (const child of discovered) this.assertManagedLeaf(child);
    if (discovered.length === 0) return;

    await this.store.update(parent.sessionId, (latestParent) => {
      const linked = discovered.reduce(
        (state, child) => state.children.some((link) => link.agentId === child.sessionId)
          ? state
          : registerDirectChild(state, child, this.now()),
        latestParent,
      );
      return {
        ...linked,
        reservations: linked.reservations.filter(
          (reservation) => !discovered.some((child) => matchesReservation(child, linked, reservation)),
        ),
      };
    });
  }

  private async markInterrupted(child: SessionState, persist = true): Promise<SessionState> {
    // Exit observations are parent facts, not child lifecycle events.
    if (persist && child.parent && await this.claimNamespace(child.parent.sessionId, false)) await this.recordControlStatus(child, "interrupted");
    return { ...child, runtime: { ...child.runtime, status: "interrupted", busy: false } };
  }

  private async recordControlStatus(child: SessionState, status: "closing" | "interrupted"): Promise<void> {
    if (!child.parent) throw new Error("Missing managed child ownership");
    await this.store.update(child.parent.sessionId, (parent) => {
      if (parent.epoch !== child.parent!.epoch) throw new Error("Subagent namespace epoch changed");
      return {
        ...parent,
        ...(status === "closing" && child.launch && parent.processes?.[child.launch.processInstanceId] ? {
          processes: { ...parent.processes, [child.launch.processInstanceId]: { ...parent.processes[child.launch.processInstanceId]!, phase: "closing" as const } },
        } : {}),
        control: {
          ...parent.control,
          tombstones: parent.control?.tombstones ?? {},
          children: { ...parent.control?.children, [child.sessionId]: { epoch: child.epoch, status, updatedAt: this.now() } },
        },
      };
    });
  }

  private assertRootNamespace(state: SessionState): void {
    if (state.parent) throw new Error("Managed sessions cannot manage subagents");
  }

  private assertManagedLeaf(state: SessionState): void {
    if (state.children.length > 0) {
      throw new Error(
        `Subagent topology corruption: managed child has children: ${state.sessionId}`,
      );
    }
  }

  private assertDirectOwnership(
    parent: SessionState,
    link: ChildLink,
    child: SessionState,
  ): void {
    if (
      child.epoch !== link.epoch
      || child.parent?.sessionId !== parent.sessionId
      || child.parent.epoch !== parent.epoch
    ) {
      throw new Error(
        `Managed child ownership does not match its direct link: ${link.agentId}`,
      );
    }
  }

  private async requireSession(sessionId: string): Promise<SessionState> {
    const state = await this.store.load(sessionId);
    if (!state) throw new Error(`Subagent namespace is not initialized: ${sessionId}`);
    return state;
  }

  private async waitForRegistration(
    parent: SessionState,
    reservation: SpawnReservation,
  ): Promise<SessionState> {
    const deadline = this.nowMs() + this.registrationTimeoutMs;
    let registered: SessionState | undefined;
    while (true) {
      const matches = (await this.store.listOwned(parent)).filter((state) => (
        matchesReservation(state, parent, reservation)
      ));
      const child = matches.sort((left, right) => (
        right.runtime.updatedAt.localeCompare(left.runtime.updatedAt)
      ))[0];
      if (registered && (child?.sessionId !== registered.sessionId || child.epoch !== registered.epoch)) {
        throw new Error("Child session identity changed before prompt readiness");
      }
      if (child) {
        registered = child;
        const observed = await this.observeRuntime(child.runtime.tmux);
        if (observed.process === "exited") throw new Error("Child runtime exited before prompt readiness");
        if (observed.identity !== "matched" || observed.process !== "alive") {
          throw new Error("Child runtime identity could not be confirmed before prompt readiness");
        }
        if (child.runtime.promptReady === true) return child;
      }
      if (this.nowMs() >= deadline) {
        throw new Error(matches.length ? "Timed out waiting for child prompt readiness" : "Timed out waiting for child runtime registration");
      }
      await this.sleep(this.pollIntervalMs);
    }
  }
}

function readLeafOptions(child: SessionState): Pick<ReadSessionViewOptions, "leafId" | "leafPosition"> {
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

function matchesReservation(
  child: SessionState,
  parent: SessionState,
  reservation: SpawnReservation,
): boolean {
  const locator = child.runtime.tmux;
  return child.parent?.sessionId === parent.sessionId
    && child.parent.epoch === parent.epoch
    && child.parent.registrationToken === reservation.reservationId
    && child.launch?.processInstanceId === reservation.processInstanceId
    && child.runtime.processInstanceId === reservation.processInstanceId
    && locator !== undefined
    && (!reservation.tmux || (
      locator.sessionName === reservation.tmux.sessionName
      && locator.windowId === reservation.tmux.windowId
      && locator.paneId === reservation.tmux.paneId
      && locator.panePid === reservation.tmux.panePid
    ));
}

function finalizeManagedWaitResult(
  value: Omit<ManagedWaitResult, "returnedBytes">,
): ManagedWaitResult {
  let returnedBytes = 0;
  while (true) {
    const result: ManagedWaitResult = { ...value, returnedBytes };
    const serializedBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (serializedBytes === returnedBytes) return result;
    returnedBytes = serializedBytes;
  }
}

function toManagedAgent(
  state: SessionState,
  status: SessionState["runtime"]["status"] = state.runtime.status,
): ManagedAgent {
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

function targetLinks(parent: SessionState, target: string): ChildLink[] {
  return target === "all"
    ? [...parent.children]
    : [getDirectChild(parent, target)];
}

function managedAgentFromLink(
  link: SessionState["children"][number],
  status: SessionState["runtime"]["status"],
): ManagedAgent {
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

function createPromptEnvelope(text: string): {
  wireText: string;
  deliveryId: string;
  marker: string;
} {
  const normalizedInput = text
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .replace(/\t/gu, "    ");
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(normalizedInput)) {
    throw new Error("Subagent prompt contains an unsafe control character");
  }
  const normalized = normalizedInput.trim();
  if (normalized.length === 0) throw new Error("Cannot deliver an empty subagent prompt");
  const deliveryId = randomUUID().replaceAll("-", "").slice(0, 12);
  const marker = `[subagent:${deliveryId}]`;
  return {
    wireText: `${marker}\n${normalized}`,
    deliveryId,
    marker,
  };
}

function isPendingPromptBaseline(error: unknown): boolean {
  return (
    error instanceof Error
    && (
      ("code" in error && error.code === "ENOENT")
      || error.message === "Pi session has no complete header"
    )
  );
}

function normalizeWindowName(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return (normalized || "subagent").slice(0, 80);
}
