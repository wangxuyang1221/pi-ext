import { describe, expect, it } from "vitest";
import { Container, CURSOR_MARKER, TuiMainScreen, TuiAltScreen, type Component, type Terminal } from "@earendil-works/pi-tui";

import { createInteractiveTuiReference } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js";

type Region = { requestRender(): void; dispose(): void };
type RegionHost = TuiMainScreen & { registerTextRegion(component: Component): Region };
function fixture(local: boolean) {
  let output = "";
  const terminal = { columns: 120, rows: 40, write(text: string) { output += text; }, hideCursor() {}, showCursor() {}, stop() {} } as Terminal & { columns: number; rows: number };
  const tui = new TuiMainScreen(terminal, true) as RegionHost;
  const calls = { history: 0, editor: 0, animation: 0, footer: 0 };
  const state = { step: 0, rate: 101, height: 1, draft: "draft", color: "" };
  const history = { invalidate() {}, render() { calls.history++; return Array.from({ length: 80 }, (_, i) => `History ${i}`); } };
  const editor = { invalidate() {}, render() { calls.editor++; return [`> ${state.draft}${CURSOR_MARKER}`]; } };
  const animation = { invalidate() {}, render() { calls.animation++; return Array.from({ length: state.height }, () => `${state.color}Working ${state.step}`); } };
  const footer = { invalidate() {}, render() { calls.footer++; return [`${state.rate} t/s`]; } };
  const widget = new Container(); widget.addChild(animation);
  const bottom = new Container(); bottom.addChild(footer);
  for (const c of [history, widget, editor, bottom]) tui.addChild(c);
  const handles = local ? [animation, footer].map(c => tui.registerTextRegion(c)) : [];
  tui.renderNow();
  output = "";
  return { tui, terminal, calls, state, widget, animation, handles, editor, history, footer,
    snapshot: () => ({ output, state: tui.captureRenderState() }),
    clear() { output = ""; for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key] = 0; },
    request(indices = [0, 1]) { if (local) for (const i of indices) handles[i]!.requestRender(); else tui.requestRender(); },
    dispose() { for (const h of handles) h.dispose(); tui.stop(); },
  };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
describe("text region refresh", () => {
  it("updates independent and merged regions with identical output and cursor", async () => {
    const baseline = fixture(false), local = fixture(true);
    try {
      for (const indices of [[0], [1], [0, 1]]) {
        for (const f of [baseline, local]) { f.clear(); if (indices.includes(0)) f.state.step++; if (indices.includes(1)) f.state.rate++; f.request(indices); }
        await settle();
        expect(local.snapshot()).toEqual(baseline.snapshot());
        expect(local.calls.history).toBe(0); expect(local.calls.editor).toBe(0);
        expect(local.calls.animation).toBe(indices.includes(0) ? 1 : 0);
        expect(local.calls.footer).toBe(indices.includes(1) ? 1 : 0);
      }
    } finally { baseline.dispose(); local.dispose(); }
  });
  it("prioritizes normal requests on either side of local requests", async () => {
    const baseline = fixture(false), local = fixture(true);
    try {
      for (const normalFirst of [true, false]) {
        for (const f of [baseline, local]) { f.clear(); f.state.step++; f.state.draft += "x"; if (normalFirst) f.tui.requestRender(); f.request(); if (!normalFirst) f.tui.requestRender(); }
        await settle();
        expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.editor).toBe(1);
      }
    } finally { baseline.dispose(); local.dispose(); }
  });
  it("falls back for geometry, theme and tree changes and ignores disposed requests", async () => {
    const baseline = fixture(false), local = fixture(true);
    try {
      const changes = [
        (f: ReturnType<typeof fixture>) => { f.state.height = 2; },
        (f: ReturnType<typeof fixture>) => { f.state.height = 1; },
        (f: ReturnType<typeof fixture>) => { f.terminal.columns = 80; },
        (f: ReturnType<typeof fixture>) => { f.terminal.rows = 25; },
        (f: ReturnType<typeof fixture>) => { f.state.color = "\x1b[31m"; f.tui.invalidate(); },
        (f: ReturnType<typeof fixture>) => { f.widget.removeChild(f.animation); },
      ];
      for (const change of changes) {
        for (const f of [baseline, local]) { f.clear(); change(f); f.request(); }
        await settle(); expect(local.snapshot()).toEqual(baseline.snapshot());
      }
      local.handles.forEach(h => { h.dispose(); h.dispose(); }); local.clear(); local.request();
      await settle(); expect(local.snapshot().output).toBe("");
    } finally { baseline.dispose(); local.dispose(); }
  });
});

describe("text region fallback and ownership", () => {
  it("keeps overlays and transformed containers on the normal path", async () => {
    const baseline = fixture(false), local = fixture(true);
    try {
      for (const f of [baseline, local]) f.tui.showOverlay({ invalidate() {}, render: () => ["OVERLAY"] }, { width: 20 });
      await settle();
      for (const f of [baseline, local]) { f.clear(); f.state.step++; f.request(); }
      await settle();
      expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.history).toBe(1);
      for (const f of [baseline, local]) {
        f.tui.hideOverlay();
        f.tui.removeChild(f.widget);
        f.tui.addChild({ invalidate() {}, render: width => f.widget.render(width).map(line => "prefix " + line) });
        f.clear(); f.state.step++; f.request();
      }
      await settle(); expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.history).toBe(1);
    } finally { baseline.dispose(); local.dispose(); }
  });
  it("does not retain a cursor emitted by a previously interactive target", async () => {
    const baseline = fixture(false), local = fixture(true);
    try {
      for (const f of [baseline, local]) {
        f.editor.render = () => ["> input"];
        f.animation.render = () => [f.state.step === 0 ? "old" + CURSOR_MARKER : "new"];
        f.tui.renderNow(); f.clear(); f.state.step++; f.request([0]);
      }
      await settle(); expect(local.snapshot()).toEqual(baseline.snapshot());
      expect(local.calls.history).toBe(1);
    } finally { baseline.dispose(); local.dispose(); }
  });
  it("coalesces repeated requests and makes stopped handles inert", async () => {
    const f = fixture(true);
    try {
      f.clear(); f.state.step++;
      for (let i = 0; i < 20; i++) f.request([0]);
      await settle(); expect(f.calls.animation).toBe(1); expect(f.calls.history).toBe(0);
      f.tui.stop(); f.clear(); f.state.step++; f.request();
      await settle(); expect(f.snapshot().output).toBe(""); expect(f.calls.animation).toBe(0);
      expect((f.tui as unknown as { textRegions: Set<unknown> }).textRegions.size).toBe(0);
    } finally { f.dispose(); }
  });
  it("moves stable proxy registrations to the current renderer and supports fullscreen fallback", async () => {
    const f = fixture(false);
    let current: TuiMainScreen | TuiAltScreen = f.tui;
    const proxy = createInteractiveTuiReference(() => current);
    const register = proxy.registerTextRegion!;
    const handle = register(f.animation);
    try {
      current.renderNow(); f.clear(); f.state.step++; handle.requestRender();
      await settle(); expect(f.calls.history).toBe(0); expect(f.calls.animation).toBe(1);
      current.stop();
      const next = new TuiAltScreen(f.terminal, true);
      for (const c of f.tui.children) next.addChild(c);
      (next as unknown as { altScreenActive: boolean }).altScreenActive = true;
      current = next; next.renderNow(); f.clear(); f.state.step++; handle.requestRender();
      await settle(); expect(f.calls.animation).toBeGreaterThan(0); expect(f.calls.history).toBeGreaterThan(0);
      next.stop();
      current = new TuiMainScreen(f.terminal, true);
      for (const c of f.tui.children) current.addChild(c);
      current.renderNow(); f.clear(); f.state.step++; handle.requestRender(); await settle();
      f.clear(); f.state.step++; handle.requestRender(); await settle();
      expect(f.calls.history).toBe(0); expect(f.calls.animation).toBe(1);
      handle.dispose(); f.clear(); handle.requestRender(); await settle(); expect(f.snapshot().output).toBe("");
    } finally { handle.dispose(); current.stop(); f.dispose(); }
  });
});

describe("text region retained-frame invalidation", () => {
  it("preserves Unicode and hyperlinks and falls back when a render throws", async () => {
    const baseline = fixture(false), local = fixture(true);
    let fail = false;
    try {
      for (const f of [baseline, local]) {
        f.animation.render = () => {
          if (fail) throw new Error("fixture render failure");
          return ["\x1b]8;;https://example.test\x07\x1b[36m中文 👩‍💻 " + f.state.step + "\x1b[0m\x1b]8;;\x07"];
        };
        f.tui.renderNow(); f.clear(); f.state.step++; f.request([0]);
      }
      await settle(); expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.history).toBe(0);
      fail = true;
      for (const f of [baseline, local]) expect(() => f.tui.renderNow()).toThrow("fixture render failure");
      fail = false;
      for (const f of [baseline, local]) { f.clear(); f.state.draft += " recovered"; f.state.step++; f.request(); }
      await settle(); expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.editor).toBe(1);
    } finally { baseline.dispose(); local.dispose(); }
  });
  it("releases replaced registrations and excludes old callbacks from future frames", async () => {
    const f = fixture(true);
    const old: Region[] = [];
    try {
      for (let i = 0; i < 100; i++) {
        const component = { invalidate() {}, render: () => ["replacement " + i] };
        f.widget.clear(); f.widget.addChild(component);
        const handle = f.tui.registerTextRegion(component);
        f.tui.renderNow(); handle.dispose(); old.push(handle);
      }
      f.tui.requestRender(); await settle(); f.clear();
      for (const handle of old) handle.requestRender();
      await settle(); expect(f.snapshot().output).toBe("");
      expect((f.tui as unknown as { textRegions: Set<unknown> }).textRegions.size).toBe(2);
    } finally { f.dispose(); }
  });
});

it("falls back when the retained frame contains an image", async () => {
  const baseline = fixture(false), local = fixture(true);
  try {
    for (const f of [baseline, local]) {
      const renderHistory = f.history.render;
      f.history.render = () => [...renderHistory(), "\x1b_Ga=T,f=32,s=1,v=1;AAAAAA==\x1b\\"];
      f.tui.renderNow(); f.clear(); f.state.step++; f.request([0]);
    }
    await settle(); expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.history).toBe(1);
  } finally { baseline.dispose(); local.dispose(); }
});
