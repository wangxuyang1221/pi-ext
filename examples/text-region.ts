import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";

/** Runnable controlled-value example. This does not measure model token throughput. */
export default function textRegionExample(pi: ExtensionAPI) {
  let cleanup: (() => void) | undefined;
  let update: ((target: string) => void) | undefined;
  let pause: (() => void) | undefined;
  let resize: (() => void) | undefined;
  let generation = 0;
  const mount = (ctx: ExtensionContext) => {
    cleanup?.();
    if (!ctx.hasUI) return;
    const current = ++generation;
    let step = 0, rate = 101, height = 1, stopped = false;
    let tick: ReturnType<typeof setInterval> | undefined;
    const disposers = new Set<() => void>();
    const requests = new Map<string, () => void>();
    const create = (tui: TUI, name: string, render: (width: number) => string[]) => {
      let disposed = false;
      const component: Component & { dispose(): void } = {
        render, invalidate() {},
        dispose() {
          if (disposed) return;
          disposed = true;
          handle?.dispose();
          requests.delete(name);
          disposers.delete(component.dispose);
          if (!requests.size && tick) { clearInterval(tick); tick = undefined; }
        },
      };
      const handle = tui.registerTextRegion?.(component);
      requests.set(name, () => { if (!disposed && !stopped && generation === current) { if (handle) handle.requestRender(); else tui.requestRender(); } });
      disposers.add(component.dispose);
      return component;
    };
    ctx.ui.setWidget("text-region-example", (tui, theme) => create(tui, "animation", width =>
      Array.from({ length: height }, (_, row) => truncateToWidth(theme.fg("accent", `${["⠋", "⠙", "⠹", "⠸"][step % 4]} Region demo ${step} / ${row + 1}`), width))));
    ctx.ui.setFooter((tui, theme) => create(tui, "footer", width => [truncateToWidth(
      theme.fg("dim", `Controlled example | ${tui.registerTextRegion ? "region API" : "normal fallback"} | ${rate} t/s`), width)]));
    update = target => {
      if (target !== "footer") { step++; requests.get("animation")?.(); }
      if (target !== "animation") { rate++; requests.get("footer")?.(); }
    };
    resize = () => { height = height === 1 ? 2 : 1; requests.get("animation")?.(); };
    tick = setInterval(() => update?.("both"), 80);
    pause = () => { if (tick) clearInterval(tick); tick = undefined; };
    cleanup = () => {
      stopped = true;
      if (tick) clearInterval(tick);
      tick = undefined;
      for (const dispose of [...disposers]) dispose();
      update = undefined;
      resize = undefined;
    };
  };
  pi.on("session_start", (_event, ctx) => mount(ctx));
  pi.on("session_shutdown", () => { cleanup?.(); cleanup = undefined; generation++; });
  pi.registerCommand("region-demo", {
    description: "Control the text-region example: animation, footer, both, height, pause, stop, start",
    handler: async (args, ctx) => {
      const action = args.trim();
      if (action === "pause") pause?.();
      else if (action === "stop") { cleanup?.(); ctx.ui.setWidget("text-region-example", undefined); ctx.ui.setFooter(undefined); }
      else if (action === "start") mount(ctx);
      else if (action === "height") resize?.();
      else update?.(action);
    },
  });
}
