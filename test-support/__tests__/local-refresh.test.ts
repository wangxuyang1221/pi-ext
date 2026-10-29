import { describe, expect, it } from "vitest";
import { Container, CURSOR_MARKER, TuiMainScreen, TuiAltScreen, VStack, type Component, type Terminal } from "@earendil-works/pi-tui";

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
  it("moves stable proxy registrations in both directions and warms the current renderer", async () => {
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
      f.clear(); f.state.step++; handle.requestRender(); await settle();
      expect(f.calls.history).toBe(0); expect(f.calls.animation).toBe(1);
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

// Match the production fullscreen transcript + fixed dock layout.
import { createChatViewport } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/chat-viewport.js";
import type { LayoutBox, LayoutFrame } from "../../node_modules/@earendil-works/pi-tui/dist/layout.js";
function fullscreenFixture(local: boolean, inTranscript = false) {
  let output = "", input = (_data: string) => {};
  const copied: string[] = [];
  const terminal = { columns: 120, rows: 40, start(callback: typeof input) { input = callback; }, write(text: string) { output += text; }, hideCursor() {}, showCursor() {}, stop() {},
    async drainInput() {}, kittyProtocolActive: false, moveBy() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {}, setProgramStatus() {},
  } satisfies Terminal;
  const tui = new TuiAltScreen(terminal, true, undefined, { copySelection: async text => { copied.push(text); return true; }, copyOnSelect: false });
  const calls = { history: 0, editor: 0, animation: 0, footer: 0 };
  const state = { step: 0, rate: 101, height: 1, draft: "draft", color: "", fail: false };
  const history = { invalidate() {}, render() { calls.history++; return Array.from({ length: 80 }, (_, i) => `History ${i}`); } };
  const editor = { invalidate() {}, render() { calls.editor++; return [`> ${state.draft}${CURSOR_MARKER}`]; } };
  const animation = { invalidate() {}, render() { calls.animation++; if (state.fail) throw new Error("region failure"); return Array.from({ length: state.height }, () => `${state.color}Working ${state.step}`); } };
  const footer = { invalidate() {}, render() { calls.footer++; return [`${state.rate} t/s`]; } };
  const document = new Container(); document.addChild(history);
  const widget = new Container(); (inTranscript ? document : widget).addChild(animation);
  const bottom = new Container(); bottom.addChild(footer);
  const viewport = createChatViewport({ document, pendingMessages: new Container(), status: new Container(), widgetsAbove: widget, editor, footer: bottom });
  tui.setLayoutRoot(viewport.root);
  for (const component of [document, widget, editor, bottom]) tui.addChild(component);
  const handles = local ? [animation, footer].map(c => tui.registerTextRegion!(c)) : [];
  tui.start(); tui.renderNow(); output = "";
  const layout = () => (tui as unknown as { currentLayout: LayoutFrame }).currentLayout;
  const boxSnapshot = (box: LayoutBox): unknown => ({ rect: box.rect, clip: box.clip, lines: box.lines, lineOffset: box.lineOffset, scrollContentLines: box.scrollContentLines, children: box.children.map(boxSnapshot) });
  return { tui, terminal, calls, state, animation, editor, history, widget, document, handles, copied, viewport, layout,
    input: (data: string) => input(data),
    snapshot: () => ({ output, screen: tui.getScreenLines(), layout: { lines: layout().lines, root: boxSnapshot(layout().root) } }),
    clear() { output = ""; for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key] = 0; },
    request(indices = [0, 1]) { if (local) for (const index of indices) handles[index]!.requestRender(); else tui.requestRender(); },
    dispose() { for (const handle of handles) handle.dispose(); tui.stop({ preserveScreen: true }); },
  };
}

describe("fullscreen text regions", () => {
  it.each([false, true])("updates screen and layout text without rendering history or editor (transcript=%s)", async inTranscript => {
    const baseline = fullscreenFixture(false, inTranscript), local = fullscreenFixture(true, inTranscript);
    try {
      for (const indices of [[0], [1], [0, 1]]) {
        for (const f of [baseline, local]) { f.clear(); if (indices.includes(0)) f.state.step++; if (indices.includes(1)) f.state.rate++; f.request(indices); }
        await settle(); expect(local.snapshot()).toEqual(baseline.snapshot());
        expect(local.calls.history).toBe(0); expect(local.calls.editor).toBe(0);
        expect(local.calls.animation).toBe(indices.includes(0) ? 1 : 0);
      }
    } finally { baseline.dispose(); local.dispose(); }
  });
  it("prioritizes normal frames and recovers geometry, invalidation, overlays and exceptions", async () => {
    const baseline = fullscreenFixture(false), local = fullscreenFixture(true);
    try {
      const changes = [
        (f: ReturnType<typeof fullscreenFixture>) => { f.state.draft += "x"; f.tui.requestRender(); },
        (f: ReturnType<typeof fullscreenFixture>) => { f.request(); f.state.draft += "y"; f.tui.requestRender(); },
        (f: ReturnType<typeof fullscreenFixture>) => { f.state.height = 2; },
        (f: ReturnType<typeof fullscreenFixture>) => { f.terminal.rows = 25; f.terminal.columns = 80; },
        (f: ReturnType<typeof fullscreenFixture>) => { f.state.color = "\x1b[36m"; f.tui.invalidate(); },
        (f: ReturnType<typeof fullscreenFixture>) => { f.tui.showOverlay({ invalidate() {}, render: () => ["OVERLAY"] }, { width: 20 }); },
        (f: ReturnType<typeof fullscreenFixture>) => { f.tui.hideOverlay(); },
        (f: ReturnType<typeof fullscreenFixture>) => { f.widget.removeChild(f.animation); },
      ];
      for (const change of changes) {
        for (const f of [baseline, local]) { f.clear(); change(f); f.state.step++; f.request(); }
        await settle(); expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.history).toBeGreaterThan(0);
      }
      for (const f of [baseline, local]) {
        f.widget.addChild(f.animation); f.tui.renderNow(); f.state.fail = true;
        expect(() => f.tui.renderNow()).toThrow("region failure");
        f.state.fail = false; f.state.draft = "recovered"; f.clear(); f.request();
      }
      await settle(); expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.editor).toBeGreaterThan(0);
    } finally { baseline.dispose(); local.dispose(); }
  });
});

it("copies current locally updated scroll text through real mouse input and refreshes search", async () => {
  const f = fullscreenFixture(true, true);
  try {
    f.state.step = 1; f.request([0]); await settle();
    let row = f.tui.getScreenLines().findIndex(line => line.includes("Working 1")) + 1;
    expect(row).toBeGreaterThan(0);
    f.input(`\x1b[<0;1;${row}M`); f.input(`\x1b[<32;9;${row}M`); f.input(`\x1b[<0;9;${row}m`);
    await settle();
    expect(f.tui.hasActiveSelection()).toBe(true);
    expect(await f.tui.copyActiveSelectionToClipboard()).toBe(true);
    expect(f.copied.at(-1)).toBe("Working 1");
    f.clear(); f.state.step = 2; f.request([0]); await settle();
    expect(f.calls.history).toBeGreaterThan(0);
    expect(await f.tui.copyActiveSelectionToClipboard()).toBe(true);
    expect(f.copied.at(-1)).toBe("Working 2");
    f.tui.resetTextSelection();
    f.input("\x1b[102;6u"); f.input("Working 2"); await settle();
    const search = () => (f.tui as unknown as { activeSearch: { matches: unknown[] } }).activeSearch;
    expect(search().matches.length).toBe(1);
    f.state.step = 3; f.request([0]); await settle();
    expect(search().matches.length).toBe(0);
    f.input("\x1b"); await settle();
    f.input("\x1b[<64;4;4M"); await settle();
    expect(f.tui.isFollowingOutput).toBe(false);
    const top = f.tui.viewportTop;
    f.state.step = 4; f.request(); await settle();
    expect(f.tui.viewportTop).toBe(top);
    f.input("\x1b[1;5F"); await settle();
    expect(f.tui.getScreenLines().some(line => line.includes("Working 4"))).toBe(true);
  } finally { f.dispose(); }
});

it("preserves hit testing after local frames and changing dock height", async () => {
  const f = fullscreenFixture(true);
  const hits: { x: number; y: number; height: number }[] = [];
  Object.assign(f.animation, { handleMouse(event: { x: number; y: number; height: number }) { hits.push({ x: event.x, y: event.y, height: event.height }); return { handled: true }; } });
  try {
    for (const height of [1, 2, 1]) {
      f.state.height = height; f.state.step++; f.request(); await settle();
      const row = f.tui.getScreenLines().findIndex(line => line.includes("Working")) + 1;
      f.input(`\x1b[<0;3;${row}M`); f.input(`\x1b[<0;3;${row}m`); await settle();
      expect(hits.at(-1)).toEqual({ x: 2, y: 0, height });
    }
  } finally { f.dispose(); }
});

it("falls back for fullscreen images and transformed components, and releases stopped registrations", async () => {
  const baseline = fullscreenFixture(false), local = fullscreenFixture(true);
  try {
    for (const f of [baseline, local]) {
      const original = f.history.render;
      f.history.render = () => [...original(), "\x1b_Ga=T,f=32,s=1,v=1;AAAAAA==\x1b\\"];
      f.tui.renderNow(); f.clear(); f.state.step++; f.request();
    }
    await settle(); expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.history).toBeGreaterThan(0);
    for (const f of [baseline, local]) {
      f.widget.removeChild(f.animation); f.widget.addChild({ invalidate() {}, render: width => f.animation.render().map(line => "prefix " + line).slice(0, width) });
      f.tui.renderNow(); f.clear(); f.state.step++; f.request();
    }
    await settle(); expect(local.snapshot()).toEqual(baseline.snapshot());
    local.tui.stop({ preserveScreen: true }); local.clear(); local.request(); await settle();
    expect(local.snapshot().output).toBe("");
    expect((local.tui as unknown as { textRegions: Set<unknown>; textRegionFrame?: unknown }).textRegions.size).toBe(0);
    expect((local.tui as unknown as { textRegionFrame?: unknown }).textRegionFrame).toBeUndefined();
    local.tui.start(); local.tui.renderNow(); local.clear(); local.request(); await settle();
    expect(local.snapshot().output).toBe("");
  } finally { baseline.dispose(); local.dispose(); }
});

it("does not commit part of a fullscreen frame when another target throws", async () => {
  const f = fullscreenFixture(true);
  const flush = () => {
    const renderer = f.tui as unknown as { cancelRenderTimer(): void; renderRequested: boolean; doRender(): void };
    renderer.cancelRenderTimer(); renderer.renderRequested = false; renderer.doRender();
  };
  try {
    const before = f.snapshot();
    f.state.fail = true; f.state.rate++; f.request([1, 0]);
    expect(flush).toThrow("region failure");
    expect(f.snapshot()).toEqual(before);
    f.state.fail = false; f.state.draft = "recovery"; f.clear(); f.request(); await settle();
    expect(f.calls.editor).toBeGreaterThan(0);
    expect(f.tui.getScreenLines().some(line => line.includes("recovery"))).toBe(true);
    expect(f.tui.getScreenLines().some(line => line.includes("102 t/s"))).toBe(true);
  } finally { f.dispose(); }
});

it("falls back for overlapping registrations and synchronous tree invalidation", async () => {
  const baseline = fullscreenFixture(false), local = fullscreenFixture(true);
  const parent = local.tui.registerTextRegion!(local.widget);
  try {
    for (const f of [baseline, local]) { f.clear(); f.state.step++; f.request(); }
    parent.requestRender(); await settle();
    expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.history).toBeGreaterThan(0);
    parent.dispose();
    for (const f of [baseline, local]) {
      const render = f.animation.render;
      let invalidate = true;
      f.animation.render = () => {
        if (invalidate) { invalidate = false; f.state.draft = "changed during render"; f.tui.invalidate(); }
        return render();
      };
      f.clear(); f.state.step++; f.request();
    }
    await settle(); expect(local.snapshot()).toEqual(baseline.snapshot());
    expect(local.tui.getScreenLines().some(line => line.includes("changed during render"))).toBe(true);
  } finally { parent.dispose(); baseline.dispose(); local.dispose(); }
});

it("resumes local refresh after an empty mouse selection and preserves Unicode links", async () => {
  const baseline = fullscreenFixture(false), local = fullscreenFixture(true);
  try {
    for (const f of [baseline, local]) {
      const row = f.tui.getScreenLines().findIndex(line => line.includes("Working")) + 1;
      f.input(`\x1b[<0;3;${row}M`); f.input(`\x1b[<0;3;${row}m`);
    }
    await settle();
    for (const f of [baseline, local]) { f.clear(); f.state.step++; f.request(); }
    await settle(); expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.history).toBe(0);
    for (const f of [baseline, local]) {
      f.animation.render = () => [`\x1b]8;;https://example.test\x07\x1b[36m中文 👩‍💻 ${f.state.step}\x1b[0m\x1b]8;;\x07`];
      f.tui.renderNow(); f.clear(); f.state.step++; f.request();
    }
    await settle(); expect(local.snapshot()).toEqual(baseline.snapshot()); expect(local.calls.history).toBe(0);
  } finally { baseline.dispose(); local.dispose(); }
});


it("falls back when layout visibility depends on changing target state", async () => {
  const baseline = fullscreenFixture(false), local = fullscreenFixture(true);
  try {
    for (const f of [baseline, local]) {
      f.tui.setLayoutRoot(new VStack([{ component: f.viewport.root, visible: () => f.state.step % 2 === 0 }]));
      f.tui.renderNow(); f.clear(); f.state.step++; f.request();
    }
    await settle(); expect(local.snapshot()).toEqual(baseline.snapshot());
    expect(local.tui.getScreenLines().some(line => line.includes("Working"))).toBe(false);
  } finally { baseline.dispose(); local.dispose(); }
});
