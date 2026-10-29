import type { ExtensionAPI, ExtensionContext, MessageStartEvent, MessageUpdateEvent, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Working, WorkingActivity } from "./working.js";

type DisposableComponent = Component & { dispose?(): void };
const WIDGET_KEY = "codex-ui-working";

/** Own both dynamic regions and their single 32ms animation clock for this session. */
export class WorkingSession {
  readonly activity = new WorkingActivity();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private disposed = false;
  private readonly bindings = new Map<() => void, (normal: boolean) => void>();

  constructor(private readonly ctx: ExtensionContext) {}

  bind(component: DisposableComponent, tui: TUI): DisposableComponent {
    let released = false;
    const wrapper = {
      render: (width: number) => component.render(width),
      invalidate: () => component.invalidate(),
      dispose: () => {
        if (released) return;
        released = true; handle?.dispose(); this.bindings.delete(wrapper.dispose); component.dispose?.();
      },
    };
    const handle = tui.registerTextRegion?.(wrapper);
    this.bindings.set(wrapper.dispose, normal => {
      if (normal || !handle) tui.requestRender();
      else handle.requestRender();
    });
    if (this.disposed) wrapper.dispose();
    return wrapper;
  }

  start(): void {
    if (this.disposed || this.activity.active) return;
    this.activity.start();
    this.ctx.ui.setWidget(WIDGET_KEY, tui => this.bind(new Working(this.activity, () => this.ctx.ui.theme), tui));
    this.refresh(true);
    this.schedule(this.generation);
  }

  stop(): void {
    this.generation++;
    clearTimeout(this.timer); this.timer = undefined;
    const wasActive = this.activity.active;
    this.activity.stop();
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

  private refresh(normal: boolean): void { for (const refresh of this.bindings.values()) refresh(normal); }

  private schedule(generation: number): void {
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.refresh(false);
      this.schedule(generation);
    }, 32);
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
