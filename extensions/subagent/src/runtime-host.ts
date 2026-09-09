import {
  markAgentSettled,
  markAgentStarted,
  markRuntimeStopped,
} from "./lifecycle.js";
import { activateSession } from "./runtime-state.js";
import { promptDeliveryId, type DeliveryReceipt } from "./delivery-receipt.js";
import {
  SessionStateStore,
  type LaunchMetadata,
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
}

export class SessionRuntimeHost {
  private readonly store: SessionStateStore;
  private readonly parent?: ParentOwnership;
  private readonly launch?: LaunchMetadata;
  private readonly createEpoch: () => string;
  private readonly now: () => string;
  private activeSessionId?: string;

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

  async startSession(options: StartRuntimeSessionOptions): Promise<void> {
    if (this.activeSessionId && this.activeSessionId !== options.sessionId) {
      await this.shutdown();
    }
    const existing = await this.store.load(options.sessionId);
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
    const { leafId: _oldLeafId, ...runtime } = state.runtime;
    state = { ...state, runtime: { ...runtime,
      ...(options.leafId === null ? {} : { leafId: options.leafId }),
      leafPinned: true,
      leafPosition: options.leafPosition,
    } };
    await this.store.save(state);
    this.activeSessionId = options.sessionId;
  }

  async agentStarted(): Promise<void> {
    await this.updateActive((state) => markAgentStarted(state, this.now()));
  }

  async consumePrompt(text: string): Promise<DeliveryReceipt | undefined> {
    const deliveryId = promptDeliveryId(text);
    if (!this.parent || !this.activeSessionId || !deliveryId) return undefined;
    const state = await this.store.load(this.activeSessionId);
    if (!state || !state.runtime.busy || state.runtime.generation < 1) return undefined;
    return {
      agentId: state.sessionId,
      epoch: state.epoch,
      generation: state.runtime.generation,
      deliveryId,
    };
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

  async shutdown(): Promise<void> {
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
    if (!this.activeSessionId) return;
    await this.store.update(this.activeSessionId, updater);
  }
}
