import { randomUUID } from "node:crypto";
import { open, readFile, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { acquireFileLock } from "./file-lock.js";
import { currentOperation } from "./operation.js";
import type { PromptRejectionCode } from "./prompt-auth.js";

export const SESSION_STATE_SCHEMA_VERSION = 3;

export type RuntimeStatus =
  | "starting"
  | "running"
  | "settled"
  | "closing"
  | "closed"
  | "interrupted"
  | "errored";

export interface TmuxLocator {
  sessionName: string;
  windowId: string;
  paneId: string;
  panePid?: number;
  windowName?: string;
  serverPid?: number;
  serverStartedAt?: string;
  socketPath?: string;
  processInstanceId?: string;
}

export interface ParentOwnership {
  sessionId: string;
  epoch: string;
  registrationToken: string;
}

export interface LaunchConfiguration {
  protocolVersion: number;
  agentDir: string;
  tmuxPath: string;
  piPath: string;
}

export interface LaunchMetadata {
  configuration?: LaunchConfiguration;
  cwd: string;
  sessionDir: string;
  model?: string;
  thinkingLevel?: string;
  displayName: string;
  processInstanceId: string;
}

export interface SpawnReservation {
  reservationId: string;
  processInstanceId: string;
  createdAt: string;
  expiresAt: string;
  launchState?: "reserved" | "launching";
  tmux?: TmuxLocator;
}

export interface ChildLink {
  agentId: string;
  epoch: string;
  name: string;
  cwd: string;
  sessionFile: string;
  launch: LaunchMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRuntimeState {
  promptReady?: boolean;
  promptRejection?: { deliveryId: string; code: PromptRejectionCode };
  configuration?: LaunchConfiguration;
  status: RuntimeStatus;
  busy: boolean;
  generation: number;
  settledGeneration: number;
  settledEntryId?: string;
  leafId?: string;
  leafPinned?: boolean;
  leafPosition?: number;
  cwd: string;
  sessionFile: string;
  pid?: number;
  processInstanceId?: string;
  tmux?: TmuxLocator;
  updatedAt: string;
}

export interface SessionState {
  schemaVersion: typeof SESSION_STATE_SCHEMA_VERSION;
  sessionId: string;
  epoch: string;
  parent?: ParentOwnership;
  launch?: LaunchMetadata;
  runtime: SessionRuntimeState;
  children: ChildLink[];
  reservations: SpawnReservation[];
  processes?: Record<string, { registrationToken: string; tmux?: TmuxLocator; phase: "active" | "closing" }>;
  control?: {
    children: Record<string, { epoch: string; status: "closing" | "interrupted"; updatedAt: string }>;
    tombstones: Record<string, string>;
    retiredProcesses?: Record<string, true>;
    closingAll?: boolean;
    controllerEpoch?: string;
  };
}

export interface CreateSessionStateOptions {
  sessionId: string;
  epoch: string;
  cwd: string;
  sessionFile: string;
  now: string;
  parent?: ParentOwnership;
  launch?: LaunchMetadata;
  pid?: number;
  processInstanceId?: string;
  tmux?: TmuxLocator;
}

export function createSessionState(options: CreateSessionStateOptions): SessionState {
  return {
    schemaVersion: SESSION_STATE_SCHEMA_VERSION,
    sessionId: options.sessionId,
    epoch: options.epoch,
    ...(options.parent ? { parent: options.parent } : {}),
    ...(options.launch ? { launch: options.launch } : {}),
    runtime: {
      status: "running",
      busy: false,
      generation: 0,
      settledGeneration: 0,
      cwd: options.cwd,
      sessionFile: options.sessionFile,
      ...(options.pid === undefined ? {} : { pid: options.pid }),
      ...(options.processInstanceId ? { processInstanceId: options.processInstanceId } : {}),
      ...(options.tmux ? { tmux: options.tmux } : {}),
      updatedAt: options.now,
    },
    children: [],
    reservations: [],
  };
}

export class SessionStateStore {
  readonly root: string;
  private readonly updateQueues = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, () => Promise<void>>();

  authorizeController(sessionId: string, assertOwned: () => Promise<void>): void {
    this.controllers.set(sessionId, assertOwned);
  }

  rollbackControllerAuthorization(sessionId: string, assertOwned: () => Promise<void>): void {
    if (this.controllers.get(sessionId) === assertOwned) this.controllers.delete(sessionId);
  }

  constructor(root: string) {
    this.root = root;
  }

  async recordDelivery(parent: SessionState, child: SessionState, deliveryId: string, delivery: string): Promise<void> {
    for (const id of [parent.sessionId, parent.epoch, deliveryId]) assertSessionId(id);
    currentOperation()?.signal.throwIfAborted();
    await this.controllers.get(parent.sessionId)?.();
    const directory = join(this.root, "deliveries", parent.sessionId, parent.epoch);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${deliveryId}.json`), JSON.stringify({
      schemaVersion: 1, phase: "prepared", parentSessionId: parent.sessionId, namespaceEpoch: parent.epoch,
      agentId: child.sessionId, sessionEpoch: child.epoch, processInstanceId: child.launch?.processInstanceId,
      deliveryId, delivery, preparedAt: new Date().toISOString(),
    }), { flag: "wx", mode: 0o600, signal: currentOperation()?.signal });
  }

  async matchesDelivery(child: SessionState, deliveryId: string): Promise<boolean> {
    if (!child.parent || !child.launch) return false;
    for (const id of [child.parent.sessionId, child.parent.epoch, deliveryId]) assertSessionId(id);
    try {
      const file = await open(join(this.root, "deliveries", child.parent.sessionId, child.parent.epoch, `${deliveryId}.json`), "r");
      try {
        if ((await file.stat()).size > 4096) return false;
        const data = JSON.parse(await file.readFile("utf8"));
        return data.schemaVersion === 1 && data.phase === "prepared" && data.deliveryId === deliveryId
          && data.parentSessionId === child.parent.sessionId && data.namespaceEpoch === child.parent.epoch
          && data.agentId === child.sessionId && data.sessionEpoch === child.epoch
          && data.processInstanceId === child.launch.processInstanceId;
      } finally { await file.close(); }
    } catch { return false; }
  }

  statePath(sessionId: string): string {
    assertSessionId(sessionId);
    return join(this.root, "sessions", sessionId, "state.json");
  }

  async load(sessionId: string, parentSnapshot?: SessionState): Promise<SessionState | undefined> {
    const state = await this.loadRuntime(sessionId);
    if (!state?.parent) return state;
    const parent = parentSnapshot?.sessionId === state.parent.sessionId
      ? parentSnapshot : await this.loadRuntime(state.parent.sessionId);
    if (parent?.epoch !== state.parent.epoch) return state;
    const observation = parent.control?.children[sessionId];
    if (!observation || observation.epoch !== state.epoch) return state;
    return { ...state, runtime: { ...state.runtime, status: observation.status } };
  }

  /** Raw lifecycle facts; control intent must never be copied into a child snapshot. */
  async loadRuntime(sessionId: string): Promise<SessionState | undefined> {
    const path = this.statePath(sessionId);
    try {
      const parsed: unknown = JSON.parse(await readStateFile(path, currentOperation()?.signal));
      return parseSessionState(parsed, sessionId);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  /** Enumerates only bindings of processes authorized by this namespace. */
  async listOwned(parent: SessionState, diagnostics: Array<{ agentId: string; reason: string }> = []): Promise<SessionState[]> {
    const current = await this.loadRuntime(parent.sessionId);
    if (!current || current.epoch !== parent.epoch) throw new Error("Subagent namespace epoch changed");
    const processIds = new Set([
      ...Object.keys(current.processes ?? {}),
      ...current.children.map((link) => link.launch.processInstanceId),
      ...current.reservations.map((reservation) => reservation.processInstanceId),
    ]);
    const ids = new Set(current.children.map((link) => link.agentId));
    for (const processId of processIds) {
      const directory = this.bindingDirectory(current.sessionId, current.epoch, processId);
      const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -5);
        assertSessionId(id);
        if (!current.control?.tombstones[id]) ids.add(id);
      }
    }
    const knownProcesses = new Set(current.children.map(link => link.launch.processInstanceId));
    const reservations = new Map(current.reservations.map(entry => [entry.processInstanceId, entry]));
    const states: SessionState[] = [];
    for (const id of ids) {
      if (current.control?.tombstones[id]) continue;
      const state = await this.load(id, current).catch((error: unknown) => {
        currentOperation()?.signal.throwIfAborted();
        diagnostics.push({ agentId: id, reason: String(error) });
        return undefined;
      });
      if (!state) continue;
      if (state.parent?.sessionId !== current.sessionId || state.parent.epoch !== current.epoch
        || !state.launch || !processIds.has(state.launch.processInstanceId)) {
        throw new Error(`Invalid scoped subagent registration: ${id}`);
      }
      const known = knownProcesses.has(state.launch.processInstanceId);
      const reservation = reservations.get(state.launch.processInstanceId);
      if (current.control?.retiredProcesses?.[state.launch.processInstanceId]) continue;
      const registeredProcess = current.processes?.[state.launch.processInstanceId];
      if (registeredProcess ? registeredProcess.registrationToken !== state.parent.registrationToken
        : !known && reservation?.reservationId !== state.parent.registrationToken) {
        throw new Error(`Subagent registration token mismatch: ${id}`);
      }
      states.push(state);
    }
    return states;
  }

  private bindingDirectory(parentId: string, epoch: string, processId: string): string {
    for (const id of [parentId, epoch, processId]) assertSessionId(id);
    return join(this.root, "bindings", parentId, epoch, processId);
  }

  async list(): Promise<SessionState[]> { return (await this.scan()).states; }

  /** Diagnostic scan only; namespace operations use listOwned instead. */
  async scan(): Promise<{ states: SessionState[]; diagnostics: Array<{ path: string; reason: string }> }> {
    const sessionsDirectory = join(this.root, "sessions");
    let entries;
    try {
      entries = await readdir(sessionsDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return { states: [], diagnostics: [] };
      throw error;
    }
    const states: SessionState[] = [];
    const diagnostics: Array<{ path: string; reason: string }> = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      try { const state = await this.load(entry.name); if (state) states.push(state); }
      catch (error) { diagnostics.push({ path: join(sessionsDirectory, entry.name, "state.json"), reason: String(error) }); }
    }
    return { states: states.sort((left, right) => left.sessionId.localeCompare(right.sessionId)), diagnostics };
  }

  async delete(sessionId: string): Promise<void> {
    assertSessionId(sessionId);
    const previous = this.updateQueues.get(sessionId) ?? Promise.resolve();
    await previous.catch(() => undefined);
    const lock = await acquireFileLock(join(this.root, "locks", sessionId), currentOperation()?.signal);
    try {
      currentOperation()?.signal.throwIfAborted();
      await rm(dirname(this.statePath(sessionId)), { recursive: true, force: true });
    } finally { await lock.release(); }
  }

  async update(
    sessionId: string,
    updater: (state: SessionState) => SessionState | Promise<SessionState>,
  ): Promise<SessionState> {
    return this.mutate(sessionId, (state) => {
      if (!state) throw new Error(`Subagent state not found: ${sessionId}`);
      return updater(state);
    });
  }

  async mutate(sessionId: string, updater: (state: SessionState | undefined) => SessionState | Promise<SessionState>): Promise<SessionState> {
    assertSessionId(sessionId);
    const previous = this.updateQueues.get(sessionId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const lock = await acquireFileLock(join(this.root, "locks", sessionId), currentOperation()?.signal);
        try {
          const state = await this.loadRuntime(sessionId);
          const updated = await updater(state);
          currentOperation()?.signal.throwIfAborted();
          await lock.assertOwned();
          await this.writeState(updated);
          return updated;
        } finally { await lock.release(); }
      });
    const tail = operation.then(() => undefined, () => undefined);
    this.updateQueues.set(sessionId, tail);

    try {
      return await operation;
    } finally {
      if (this.updateQueues.get(sessionId) === tail) {
        this.updateQueues.delete(sessionId);
      }
    }
  }

  async save(state: SessionState): Promise<void> {
    assertSessionId(state.sessionId);
    const lock = await acquireFileLock(join(this.root, "locks", state.sessionId), currentOperation()?.signal);
    try { await this.writeState(state); }
    finally { await lock.release(); }
  }

  private async writeState(state: SessionState): Promise<void> {
    currentOperation()?.signal.throwIfAborted();
    if (!state.parent) await this.controllers.get(state.sessionId)?.();
    const previous = await this.loadRuntime(state.sessionId);
    if (previous?.epoch === state.epoch && previous.runtime.processInstanceId === state.runtime.processInstanceId
      && (previous.runtime.generation > state.runtime.generation || previous.runtime.settledGeneration > state.runtime.settledGeneration)) {
      throw new Error("Subagent generation cannot regress within a process instance");
    }
    if (state.parent) {
      const parent = await this.loadRuntime(state.parent.sessionId);
      if (parent?.epoch === state.parent.epoch && (parent.control?.tombstones[state.sessionId]
        || (state.launch && parent.control?.retiredProcesses?.[state.launch.processInstanceId]))) {
        throw new Error(`Subagent binding has been terminally removed: ${state.sessionId}`);
      }
    }
    const path = this.statePath(state.sessionId);
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      currentOperation()?.signal.throwIfAborted();
      if (!state.parent) await this.controllers.get(state.sessionId)?.();
      await rename(temporaryPath, path);
      if (state.parent && state.launch) {
        const directory = this.bindingDirectory(state.parent.sessionId, state.parent.epoch, state.launch.processInstanceId);
        await mkdir(directory, { recursive: true });
        const binding = join(directory, `${state.sessionId}.json`);
        const tempBinding = `${binding}.${randomUUID()}.tmp`;
        try {
          await writeFile(tempBinding, JSON.stringify({ sessionId: state.sessionId, epoch: state.epoch }), { mode: 0o600 });
          await rename(tempBinding, binding);
        } finally { await rm(tempBinding, { force: true }); }
      }
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

export function parseSessionState(value: unknown, expectedSessionId: string): SessionState {
  if (!isRecord(value)) throw new Error("Invalid subagent state: expected an object");
  if (value.schemaVersion !== SESSION_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported subagent state schema: ${String(value.schemaVersion)}`);
  }
  if (value.sessionId !== expectedSessionId) {
    throw new Error("Invalid subagent state: sessionId does not match its partition");
  }
  if (
    typeof value.epoch !== "string"
    || !isRecord(value.runtime)
    || !Array.isArray(value.children)
    || !Array.isArray(value.reservations)
  ) {
    throw new Error("Invalid subagent state: missing required fields");
  }
  const runtime = value.runtime;
  const nonnegative = (count: unknown): count is number => Number.isSafeInteger(count) && (count as number) >= 0;
  if (!nonnegative(runtime.generation) || !nonnegative(runtime.settledGeneration)
    || runtime.settledGeneration > runtime.generation || typeof runtime.busy !== "boolean"
    || !["starting", "running", "settled", "closing", "closed", "interrupted", "errored"].includes(String(runtime.status))
    || typeof runtime.cwd !== "string" || typeof runtime.sessionFile !== "string" || typeof runtime.updatedAt !== "string"
    || (runtime.pid !== undefined && (!nonnegative(runtime.pid) || runtime.pid === 0))
    || (runtime.processInstanceId !== undefined && typeof runtime.processInstanceId !== "string")) {
    throw new Error("Invalid subagent state: malformed runtime");
  }
  assertSessionId(value.epoch as string);
  if (runtime.processInstanceId !== undefined) assertSessionId(runtime.processInstanceId as string);
  if (runtime.configuration !== undefined) validateConfiguration(runtime.configuration);
  if (runtime.tmux !== undefined) validateLocator(runtime.tmux);
  if (value.parent !== undefined) {
    if (!isRecord(value.parent)) throw new Error("Invalid subagent state: malformed ownership");
    for (const field of ["sessionId", "epoch", "registrationToken"]) {
      if (typeof value.parent[field] !== "string") throw new Error("Invalid subagent state: malformed ownership");
      assertSessionId(value.parent[field] as string);
    }
    validateLaunch(value.launch);
  }
  for (const link of value.children) {
    if (!isRecord(link) || typeof link.agentId !== "string" || typeof link.epoch !== "string"
      || typeof link.name !== "string" || typeof link.cwd !== "string" || typeof link.sessionFile !== "string") {
      throw new Error("Invalid subagent state: malformed child link");
    }
    assertSessionId(link.agentId); assertSessionId(link.epoch); validateLaunch(link.launch);
  }
  for (const reservation of value.reservations) {
    if (!isRecord(reservation) || typeof reservation.reservationId !== "string" || typeof reservation.processInstanceId !== "string"
      || typeof reservation.createdAt !== "string" || typeof reservation.expiresAt !== "string") {
      throw new Error("Invalid subagent state: malformed reservation");
    }
    assertSessionId(reservation.reservationId); assertSessionId(reservation.processInstanceId);
    if (reservation.tmux !== undefined) validateLocator(reservation.tmux);
    if (reservation.launchState !== undefined && reservation.launchState !== "reserved" && reservation.launchState !== "launching") {
      throw new Error("Invalid subagent state: malformed launch state");
    }
  }
  if (value.processes !== undefined) {
    if (!isRecord(value.processes)) throw new Error("Invalid subagent state: malformed process registry");
    for (const [id, managed] of Object.entries(value.processes)) {
      assertSessionId(id);
      if (!isRecord(managed) || typeof managed.registrationToken !== "string"
        || !["active", "closing"].includes(String(managed.phase))) throw new Error("Invalid subagent state: malformed process record");
      assertSessionId(managed.registrationToken);
      if (managed.tmux !== undefined) validateLocator(managed.tmux);
    }
  }
  if (value.control !== undefined) {
    const control = value.control;
    if (!isRecord(control) || !isRecord(control.children) || !isRecord(control.tombstones)
      || (control.closingAll !== undefined && typeof control.closingAll !== "boolean")) {
      throw new Error("Invalid subagent state: malformed control record");
    }
    if (control.controllerEpoch !== undefined) assertSessionId(control.controllerEpoch as string);
    for (const [id, intent] of Object.entries(control.children)) {
      assertSessionId(id);
      if (!isRecord(intent) || typeof intent.epoch !== "string" || typeof intent.updatedAt !== "string"
        || !["closing", "interrupted"].includes(String(intent.status))) throw new Error("Invalid subagent state: malformed control intent");
      assertSessionId(intent.epoch);
    }
    for (const [id, epoch] of Object.entries(control.tombstones)) {
      assertSessionId(id);
      if (typeof epoch !== "string") throw new Error("Invalid subagent state: malformed tombstone");
      assertSessionId(epoch);
    }
    if (control.retiredProcesses !== undefined) {
      if (!isRecord(control.retiredProcesses)) throw new Error("Invalid subagent state: malformed retired processes");
      for (const [id, retired] of Object.entries(control.retiredProcesses)) {
        assertSessionId(id);
        if (retired !== true) throw new Error("Invalid subagent state: malformed retired process");
      }
    }
  }
  return value as unknown as SessionState;
}

async function readStateFile(path: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const file = await open(path, "r");
  try {
    const limit = 1024 * 1024;
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error("Invalid subagent state: expected a regular file");
    if (metadata.size > limit) throw new Error("Invalid subagent state: file exceeds 1 MiB");
    const buffer = Buffer.alloc(Math.min(limit + 1, metadata.size + 1));
    let size = 0;
    while (size <= limit) {
      signal?.throwIfAborted();
      if (size === buffer.length) throw new Error("Invalid subagent state: file changed while reading");
      const { bytesRead } = await file.read(buffer, size, Math.min(64 * 1024, buffer.length - size), size);
      if (!bytesRead) return buffer.subarray(0, size).toString("utf8");
      size += bytesRead;
    }
    throw new Error("Invalid subagent state: file exceeds 1 MiB");
  } finally { await file.close(); }
}

function validateLaunch(launch: unknown): void {
  if (!isRecord(launch) || typeof launch.processInstanceId !== "string" || typeof launch.cwd !== "string"
    || typeof launch.sessionDir !== "string" || typeof launch.displayName !== "string") throw new Error("Invalid subagent state: malformed launch metadata");
  assertSessionId(launch.processInstanceId);
  if (launch.configuration !== undefined) validateConfiguration(launch.configuration);
}

function validateConfiguration(configuration: unknown): void {
  if (!isRecord(configuration) || configuration.protocolVersion !== SESSION_STATE_SCHEMA_VERSION
    || ![configuration.agentDir, configuration.tmuxPath, configuration.piPath].every(value => typeof value === "string" && value.length > 0)) {
    throw new Error("Invalid subagent state: malformed launch configuration");
  }
}

function validateLocator(locator: unknown): void {
  if (!isRecord(locator) || typeof locator.sessionName !== "string" || !/^@\d+$/u.test(String(locator.windowId))
    || !/^%\d+$/u.test(String(locator.paneId)) || (locator.panePid !== undefined && (!Number.isSafeInteger(locator.panePid) || (locator.panePid as number) <= 0))) {
    throw new Error("Invalid subagent state: malformed tmux locator");
  }
  if (locator.processInstanceId !== undefined) {
    assertSessionId(locator.processInstanceId as string);
    if (!Number.isSafeInteger(locator.serverPid) || (locator.serverPid as number) <= 0
      || typeof locator.serverStartedAt !== "string" || typeof locator.socketPath !== "string") {
      throw new Error("Invalid subagent state: incomplete tmux identity");
    }
  }
}

function assertSessionId(sessionId: string): void {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/u.test(sessionId)
    || ["__proto__", "constructor", "prototype"].includes(sessionId)) {
    throw new Error(`Invalid sessionId: ${sessionId}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
