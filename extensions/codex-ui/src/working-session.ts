import type { ExtensionAPI, ExtensionContext, MessageStartEvent, MessageUpdateEvent, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { WORKING_FRAME_MS, Working, WorkingActivity, workingFrameKey } from "./working.js";

type DisposableComponent = Component & { dispose?(): void };
type BindingKind = "working" | "rate";
interface TextRegionCapability {
  registerTextRegion?(component: Component): { requestRender(): void; dispose(): void };
}
interface BindingEntry {
  kind: BindingKind;
  tui: TUI;
  local: boolean;
  refresh: (normal: boolean) => void;
}
const WIDGET_KEY = "codex-ui-working";

/** Own both dynamic regions and their single 80ms phase-aligned animation clock for this session. */
export class WorkingSession {
  readonly activity = new WorkingActivity();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private disposed = false;
  private lastWorkingKey: string | undefined;
  private lastRateLabel: string | undefined;
  private readonly bindings = new Map<() => void, BindingEntry>();

  constructor(private readonly ctx: ExtensionContext) {}

  bind(component: DisposableComponent, tui: TUI, kind: BindingKind = "rate"): DisposableComponent {
    let released = false;
    const wrapper = {
      render: (width: number) => component.render(width),
      invalidate: () => component.invalidate(),
      dispose: () => {
        if (released) return;
        released = true; handle?.dispose(); this.bindings.delete(wrapper.dispose); component.dispose?.();
      },
    };
    const regions = tui as TUI & TextRegionCapability;
    const handle = typeof regions.registerTextRegion === "function" ? regions.registerTextRegion(wrapper) : undefined;
    this.bindings.set(wrapper.dispose, {
      kind,
      tui,
      local: Boolean(handle),
      refresh: normal => {
        if (normal || !handle) tui.requestRender();
        else handle.requestRender();
      },
    });
    if (this.disposed) wrapper.dispose();
    return wrapper;
  }

  start(): void {
    if (this.disposed || this.activity.active) return;
    this.activity.start();
    const startedElapsed = this.activity.elapsed();
    this.lastWorkingKey = workingFrameKey(startedElapsed);
    this.lastRateLabel = this.activity.label();
    this.ctx.ui.setWidget(WIDGET_KEY, tui => this.bind(new Working(this.activity, () => this.ctx.ui.theme), tui, "working"));
    this.refresh(true);
    this.schedule(this.generation, startedElapsed);
  }

  stop(): void {
    this.generation++;
    clearTimeout(this.timer); this.timer = undefined;
    const wasActive = this.activity.active;
    this.activity.stop();
    this.lastWorkingKey = undefined;
    this.lastRateLabel = undefined;
    if (wasActive) { this.ctx.ui.setWidget(WIDGET_KEY, undefined); this.refresh(true); }
  }

  dispose(): void {
    this.stop(); this.disposed = true;
    for (const dispose of this.bindings.keys()) dispose();
  }

  messageStart(event: MessageStartEvent): void {
    if (this.activity.active && event.message.role === "assistant") this.activity.rate.start(event.message);
  }

  messageUpdate(event: MessageUpdateEvent): void {
    if (this.activity.active) this.activity.rate.update(event.assistantMessageEvent);
  }

  messageEnd(event: MessageEndEvent): void {
    if (this.activity.active && event.message.role === "assistant") this.activity.rate.finish(event.message);
  }

  private refresh(normal: boolean): void { for (const entry of this.bindings.values()) entry.refresh(normal); }

  private tick(): number {
    const elapsed = this.activity.elapsed();
    const workingKey = workingFrameKey(elapsed);
    const rateLabel = this.activity.label();
    const workingChanged = workingKey !== this.lastWorkingKey;
    const rateChanged = rateLabel !== this.lastRateLabel;
    if (!workingChanged && !rateChanged) return elapsed;
    this.lastWorkingKey = workingKey;
    this.lastRateLabel = rateLabel;
    const requestedFull = new Set<TUI>();
    for (const entry of this.bindings.values()) {
      const changed = entry.kind === "working" ? workingChanged : rateChanged;
      if (!changed) continue;
      if (entry.local) {
        entry.refresh(false);
      } else if (!requestedFull.has(entry.tui)) {
        requestedFull.add(entry.tui);
        entry.refresh(false);
      }
    }
    return elapsed;
  }

  private schedule(generation: number, observedElapsed = this.activity.elapsed()): void {
    const nextBoundary = (Math.floor(observedElapsed / WORKING_FRAME_MS) + 1) * WORKING_FRAME_MS;
    const delay = Math.max(1, Math.ceil(nextBoundary - this.activity.elapsed()));
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return;
      const observed = this.tick();
      this.schedule(generation, observed);
    }, delay);
  }
}

/** Bind only documented task and response events; dialogs never change task activity. */
export function registerWorking(pi: ExtensionAPI): (ctx: ExtensionContext) => WorkingSession | undefined {
  let current: WorkingSession | undefined;
  pi.on("agent_start", () => current?.start());
  pi.on("agent_settled", () => current?.stop());
  pi.on("message_start", event => current?.messageStart(event));
  pi.on("message_update", event => current?.messageUpdate(event));
  pi.on("message_end", event => current?.messageEnd(event));
  pi.on("session_shutdown", () => { current?.dispose(); current = undefined; });
  return ctx => {
    current?.dispose(); current = undefined;
    current = createSession(ctx);
    return current;
  };
}

function createSession(ctx: ExtensionContext): WorkingSession | undefined {
  if (ctx.mode !== "tui") return;
  const session = new WorkingSession(ctx);
  if (!ctx.isIdle()) session.start();
  return session;
}
