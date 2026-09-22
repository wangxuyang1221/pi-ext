import {
  markAgentSettled,
  markAgentStarted,
  markRuntimeStopped,
} from "./lifecycle.js";
import { activateSession } from "./runtime-state.js";
import { promptDeliveryId, type DeliveryReceipt } from "./delivery-receipt.js";
import type { PromptRejectionCode } from "./prompt-auth.js";
import {
  SessionStateStore,
  type LaunchMetadata,
  type LaunchConfiguration,
  type ParentOwnership,
  type TmuxLocator,
} from "./state-store.js";

export interface SessionRuntimeHostOptions {
  store: SessionStateStore;
  parent?: ParentOwnership;
  launch?: LaunchMetadata;
  createEpoch: () => string;
  now?: () => string;
}

export interface StartRuntimeSessionOptions {
  sessionId: string;
  cwd: string;
  sessionFile: string;
  leafId: string | null;
  leafPosition?: number;
  pid?: number;
  tmux?: TmuxLocator;
  configuration?: LaunchConfiguration;
}

interface PendingPrompt {
  deliveryId: string;
  sessionId: string;
  epoch: string;
  processInstanceId: string;
}

export class SessionRuntimeHost {
  private readonly store: SessionStateStore;
  private readonly parent?: ParentOwnership;
  private readonly launch?: LaunchMetadata;
  private readonly createEpoch: () => string;
  private readonly now: () => string;
  private activeSessionId?: string;
  private queue: Promise<unknown> = Promise.resolve();
  private assertController?: () => Promise<void>;

  setControllerGuard(guard: () => Promise<void>): void { this.assertController = guard; }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.queue.catch(() => undefined).then(async () => {
      await this.assertController?.();
      return work();
    });
    this.queue = operation;
    return operation;
  }

  constructor(options: SessionRuntimeHostOptions) {
    this.store = options.store;
    this.parent = options.parent;
    this.launch = options.launch;
    this.createEpoch = options.createEpoch;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  getActiveSessionId(): string | undefined {
    return this.activeSessionId;
  }

  startSession(options: StartRuntimeSessionOptions): Promise<void> {
    return this.enqueue(() => this.startSessionInternal(options));
  }

  private async startSessionInternal(options: StartRuntimeSessionOptions): Promise<void> {
    if (this.activeSessionId && this.activeSessionId !== options.sessionId) {
      await this.shutdownInternal();
    }
    await this.store.mutate(options.sessionId, (existing) => {
    let state = activateSession(existing, {
      sessionId: options.sessionId,
      cwd: options.cwd,
      sessionFile: options.sessionFile,
      now: this.now(),
      ...(this.parent ? { parent: this.parent } : {}),
      ...(this.launch ? { launch: this.launch } : {}),
      ...(options.pid === undefined ? {} : { pid: options.pid }),
      ...(this.launch ? { processInstanceId: this.launch.processInstanceId } : {}),
      ...(options.tmux ? { tmux: options.tmux } : {}),
      createEpoch: this.createEpoch,
    });
    const { leafId: _oldLeafId, promptRejection: _oldRejection, ...runtime } = state.runtime;
    state = { ...state, runtime: { ...runtime,
      ...(this.parent ? { promptReady: false } : {}),
      ...(options.leafId === null ? {} : { leafId: options.leafId }),
      leafPinned: true,
      leafPosition: options.leafPosition,
      ...(options.configuration ? { configuration: options.configuration } : {}),
    } };
    return state;
    });
    this.activeSessionId = options.sessionId;
  }

  async agentStarted(): Promise<void> {
    await this.updateActive((state) => markAgentStarted(state, this.now()));
  }

  async promptReady(processInstanceId: string, sessionId: string): Promise<void> {
    await this.enqueue(async () => {
      if (!this.parent || this.launch?.processInstanceId !== processInstanceId
        || this.activeSessionId !== sessionId) return;
      await this.store.update(sessionId, state => ({ ...state,
        runtime: { ...state.runtime, promptReady: true, updatedAt: this.now() },
      }));
    });
  }

  async consumePrompt(text: string): Promise<DeliveryReceipt | undefined> {
    const deliveryId = promptDeliveryId(text);
    if (!this.parent || !this.activeSessionId || !deliveryId) return undefined;
    const state = await this.store.loadRuntime(this.activeSessionId);
    if (!state || !state.runtime.busy || state.runtime.generation < 1) return undefined;
    return {
      agentId: state.sessionId,
      epoch: state.epoch,
      generation: state.runtime.generation,
      deliveryId,
    };
  }

  async pendingPrompt(text: string, sessionId: string): Promise<PendingPrompt | undefined> {
    const deliveryId = promptDeliveryId(text);
    if (!deliveryId || !this.parent || !this.launch || this.activeSessionId !== sessionId) return;
    const child = await this.store.loadRuntime(sessionId);
    if (!child || child.runtime.busy || !["running", "settled"].includes(child.runtime.status)
      || child.parent?.sessionId !== this.parent.sessionId || child.parent?.epoch !== this.parent.epoch
      || child.parent?.registrationToken !== this.parent.registrationToken
      || child.launch?.processInstanceId !== this.launch.processInstanceId
      || !await this.store.matchesDelivery(child, deliveryId)) return;
    return { deliveryId, sessionId, epoch: child.epoch, processInstanceId: this.launch.processInstanceId };
  }

  async rejectPrompt(pending: PendingPrompt, code: PromptRejectionCode): Promise<void> {
    await this.enqueue(async () => {
      if (this.activeSessionId !== pending.sessionId) return;
      await this.store.update(pending.sessionId, child => {
        if (child.epoch !== pending.epoch || child.launch?.processInstanceId !== pending.processInstanceId
          || child.parent?.sessionId !== this.parent?.sessionId || child.parent?.epoch !== this.parent?.epoch
          || child.parent?.registrationToken !== this.parent?.registrationToken
          || child.runtime.busy || !["running", "settled"].includes(child.runtime.status)) return child;
        return { ...child, runtime: { ...child.runtime, promptRejection: { deliveryId: pending.deliveryId, code } } };
      });
    });
  }

  async agentSettled(): Promise<void> {
    await this.updateActive((state) => (
      markAgentSettled(state, this.now(), state.runtime.leafId)
    ));
  }

  async leafChanged(leafId: string | null, pinned = false, leafPosition?: number): Promise<void> {
    await this.updateActive((state) => {
      const { leafId: _oldLeafId, ...runtime } = state.runtime;
      return {
        ...state,
        runtime: {
          ...runtime,
          ...(leafId === null ? {} : { leafId }),
          leafPinned: pinned,
          leafPosition,
          updatedAt: this.now(),
        },
      };
    });
  }

  shutdown(): Promise<void> { return this.enqueue(() => this.shutdownInternal()); }

  private async shutdownInternal(): Promise<void> {
    if (!this.activeSessionId) return;
    const sessionId = this.activeSessionId;
    await this.store.update(sessionId, (state) => (
      markRuntimeStopped(state, "closed", this.now())
    ));
    this.activeSessionId = undefined;
  }

  private async updateActive(
    updater: Parameters<SessionStateStore["update"]>[1],
  ): Promise<void> {
    await this.enqueue(async () => {
      if (!this.activeSessionId) return;
      await this.store.update(this.activeSessionId, updater);
    });
  }
}
