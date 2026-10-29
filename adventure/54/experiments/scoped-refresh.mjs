import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Container, CURSOR_MARKER, Markdown, ScrollView, TuiAltScreen, TuiMainScreen, VStack } from "@earendil-works/pi-tui";

// Technical probe only: wrap known fixture components in memory. No installed
// package is modified, and no production API or scheduler is implemented here.
export class ScopedCache {
  cache = new WeakMap();
  parents = new WeakMap();
  stack = [];
  active = false;
  dirty;
  fallbacks = 0;
  lastDimensions;
  restores = [];

  wrap(component) {
    const original = component.render;
    const owner = this;
    component.render = function (width) {
      if (!owner.active) return original.call(this, width);
      const parent = owner.stack.at(-1);
      if (parent) {
        let parents = owner.parents.get(this);
        if (!parents) owner.parents.set(this, parents = new Set());
        parents.add(parent);
      }
      let widths = owner.cache.get(this);
      const cached = widths?.get(width);
      if (owner.dirty && !owner.dirty.has(this) && cached) return cached;
      owner.stack.push(this);
      let lines;
      try { lines = original.call(this, width); }
      finally { owner.stack.pop(); }
      if (owner.dirty && cached && lines.length !== cached.length) {
        throw new HeightChanged();
      }
      if (!widths) owner.cache.set(this, widths = new Map());
      widths.set(width, [...lines]);
      return lines;
    };
    this.restores.push(() => { component.render = original; });
    return component;
  }

  render(tui, target, renderFrame = () => tui.renderNow()) {
    const dimensions = `${tui.terminal.columns}x${tui.terminal.rows}`;
    const targets = target ? (Array.isArray(target) ? target : [target]) : [];
    const local = targets.length && targets.every(item => this.cache.has(item)) && dimensions === this.lastDimensions && !tui.hasOverlayEntries;
    if (local) {
      this.dirty = new Set();
      const visit = (component) => {
        if (this.dirty.has(component)) return;
        this.dirty.add(component);
        for (const parent of this.parents.get(component) ?? []) visit(parent);
      };
      for (const item of targets) visit(item);
    } else {
      this.reset();
      if (target) this.fallbacks++;
    }
    this.active = true;
    try { renderFrame(); }
    catch (error) {
      if (!(error instanceof HeightChanged)) throw error;
      this.fallbacks++;
      this.reset();
      renderFrame();
    } finally {
      this.active = false;
      this.dirty = undefined;
    }
    this.lastDimensions = dimensions;
  }

  reset() {
    this.cache = new WeakMap();
    this.parents = new WeakMap();
    this.dirty = undefined;
  }

  dispose() { for (const restore of this.restores) restore(); }
}

class HeightChanged extends Error {}

const theme = {
  heading: s => s, link: s => s, linkUrl: s => s, code: s => s,
  codeBlock: s => s, codeBlockBorder: s => s, quote: s => s,
  quoteBorder: s => s, hr: s => s, listBullet: s => s,
  bold: s => s, italic: s => s, strikethrough: s => s, underline: s => s,
};

function fixture(mode, cached, historySize = 200) {
  const cache = cached ? new ScopedCache() : undefined;
  const counts = { history: 0, animation: 0, editor: 0, footer: 0 };
  let frame = 0, statusLines = 1, draft = "draft", footer = "101 t/s", historyRevision = 0;
  const chunks = [];
  const terminal = { columns: 90, rows: 30, write: text => chunks.push(text), hideCursor() {}, showCursor() {} };
  const wrap = component => cache?.wrap(component) ?? component;
  const counted = (kind, render) => wrap({ invalidate() {}, render(width) { counts[kind]++; return render(width); } });
  const chat = wrap(new Container());
  for (let index = 0; index < historySize; index++) {
    const markdown = new Markdown(`Message ${index}: **unchanged history** with a [link](https://example.com) and text.`, 0, 0, theme);
    chat.addChild(counted("history", width => markdown.render(width).map(line => `${historyRevision ? "Updated " : ""}${line}`)));
  }
  const animation = counted("animation", () => Array.from({ length: statusLines }, (_, row) => `Working ${[".", "..", "..."][frame % 3].padEnd(3)} ${(40 + frame / 10).toFixed(1)} tok/s ${row}`));
  const widget = wrap(new Container());
  widget.addChild(animation);
  const editor = counted("editor", () => [`> ${draft}${CURSOR_MARKER}`]);
  const bottom = counted("footer", () => [footer]);
  const tui = mode === "regular" ? new TuiMainScreen(terminal, true) : new TuiAltScreen(terminal, true);
  wrap(tui);
  if (mode === "regular") {
    for (const component of [chat, widget, editor, bottom]) tui.addChild(component);
  } else {
    const scroll = wrap(new ScrollView(chat, { follow: "end", primary: true, scrollbar: "hidden" }));
    const root = wrap(new VStack([
      { component: scroll, grow: 1, shrink: 1, minSize: 1 },
      { component: widget, shrink: 0 },
      { component: editor, shrink: 0 },
      { component: bottom, shrink: 0 },
    ]));
    tui.setLayoutRoot(root);
    // Avoid terminal setup and timers: drive the real renderer synchronously.
    tui.altScreenActive = true;
  }
  const render = target => {
    chunks.length = 0;
    if (cache) cache.render(tui, target);
    else tui.renderNow();
    return { lines: [...(mode === "regular" ? tui.previousLines : tui.getScreenLines())], output: chunks.join("") };
  };
  return {
    tui, terminal, counts, animation, bottom, cache, render,
    snapshot: () => ({ lines: [...(mode === "regular" ? tui.previousLines : tui.getScreenLines())], output: chunks.join("") }),
    clearOutput: () => { chunks.length = 0; },
    advance: () => { frame++; },
    grow: () => { statusLines = 2; },
    shrink: () => { statusLines = 1; },
    edit: () => { draft = "changed draft"; },
    changeFooter: () => { footer = "102 t/s"; },
    changeHistory: () => { historyRevision++; },
    remove: () => { widget.removeChild(animation); },
    dispose: () => { tui.stopped = true; tui.cancelRenderTimer(); cache?.dispose(); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
const results = [];
for (const mode of ["regular", "fullscreen"]) {
  const baseline = fixture(mode, false);
  const candidate = fixture(mode, true);
  const compare = (name, local) => {
    const expected = baseline.render();
    const actual = candidate.render(local ? candidate.animation : undefined);
    assert.deepEqual(actual.lines, expected.lines, `${mode}: ${name} screen`);
    assert.equal(actual.output, expected.output, `${mode}: ${name} terminal output`);
    return actual.output;
  };
  compare("initial", false);
  const starts = [baseline, candidate].map(f => ({ counts: { ...f.counts }, fullRedraws: f.tui.fullRedraws }));
  let bytes = 0;
  for (let index = 0; index < 60; index++) {
    baseline.advance(); candidate.advance();
    bytes += Buffer.byteLength(compare(`animation ${index}`, true));
  }
  const animation = [baseline, candidate].map((f, index) => ({
    historyRenders: f.counts.history - starts[index].counts.history,
    animationRenders: f.counts.animation - starts[index].counts.animation,
    editorRenders: f.counts.editor - starts[index].counts.editor,
    footerRenders: f.counts.footer - starts[index].counts.footer,
    fullRedraws: f.tui.fullRedraws - starts[index].fullRedraws,
  }));
  assert.equal(animation[1].historyRenders, 0);
  assert.equal(animation[1].editorRenders, 0);
  assert.equal(animation[1].footerRenders, 0);
  assert.equal(animation[1].animationRenders, 60);
  assert.equal(animation[1].fullRedraws, 0);
  const checks = [];
  for (const [name, action, local] of [
    ["height growth falls back", f => f.grow(), true],
    ["height shrink falls back", f => f.shrink(), true],
    ["width change falls back", f => { f.terminal.columns = 50; }, true],
    ["height change falls back", f => { f.terminal.rows = 20; }, true],
    ["ordinary edit", f => f.edit(), false],
    ["ordinary footer update", f => f.changeFooter(), false],
    ["ordinary history update", f => f.changeHistory(), false],
    ["animation after normal update", f => f.advance(), true],
    ["ordinary removal", f => f.remove(), false],
    ["removed target cannot reappear", f => f.advance(), true],
  ]) {
    action(baseline); action(candidate);
    compare(name, local);
    checks.push(name);
  }
  results.push({ mode, frames: 60, historyComponents: 200, baseline: animation[0], candidate: animation[1], identicalTerminalBytes: bytes, fallbacks: candidate.cache.fallbacks, checks });
  baseline.dispose(); candidate.dispose();
}

// Timings describe this fixture only; both paths retain the native final line
// processing. Component-call counts and output equivalence are the primary proof.
const timings = [];
for (const mode of ["regular", "fullscreen"]) {
  for (const cached of [false, true]) {
    const f = fixture(mode, cached, 200);
    f.render();
    const start = performance.now();
    for (let i = 0; i < 120; i++) { f.advance(); f.render(cached ? f.animation : undefined); }
    timings.push({ mode, cached, frames: 120, elapsedMs: Math.round((performance.now() - start) * 100) / 100 });
    f.dispose();
  }
}

// Intercept only this fixture instance, while using the host's actual nextTick /
// timer scheduler. An ordinary request always supersedes local requests.
function scheduledFixture(mode, cached) {
  const f = fixture(mode, cached);
  f.render();
  const nativeRequest = f.tui.requestRender.bind(f.tui);
  const nativeRender = f.tui.doRender.bind(f.tui);
  const dirty = new Set();
  let ordinary = false, listener, renders = 0;
  f.tui.requestRender = force => { ordinary = true; nativeRequest(force); };
  f.tui.doRender = () => {
    const targets = ordinary ? undefined : [...dirty];
    ordinary = false;
    dirty.clear();
    if (f.cache) f.cache.render(f.tui, targets?.length ? targets : undefined, nativeRender);
    else nativeRender();
    renders++;
    listener?.();
    listener = undefined;
  };
  return {
    ...f,
    local: target => { dirty.add(target); nativeRequest(); },
    ordinary: () => f.tui.requestRender(),
    wait: () => new Promise(resolve => { listener = resolve; }),
    count: () => renders,
  };
}

const scheduled = [];
for (const mode of ["regular", "fullscreen"]) {
  const reference = scheduledFixture(mode, false);
  const candidate = scheduledFixture(mode, true);
  const checks = [];
  for (const [name, action] of [
    ["twenty local requests coalesce", f => { for (let i = 0; i < 20; i++) { f.advance(); f.local(f.animation); } }],
    ["footer-only token rate update", f => { f.changeFooter(); f.local(f.bottom); }],
    ["multiple local targets", f => { f.advance(); f.changeFooter(); f.local(f.animation); f.local(f.bottom); }],
    ["normal request after local wins", f => { f.advance(); f.local(f.animation); f.edit(); f.ordinary(); }],
    ["normal request before local wins", f => { f.changeHistory(); f.ordinary(); f.advance(); f.local(f.animation); }],
  ]) {
    reference.clearOutput(); candidate.clearOutput();
    const before = [reference.count(), candidate.count()];
    const countsBefore = { ...candidate.counts };
    const waits = [reference.wait(), candidate.wait()];
    action(reference); action(candidate);
    await Promise.all(waits);
    assert.deepEqual(candidate.snapshot(), reference.snapshot(), `${mode}: ${name}`);
    assert.equal(reference.count() - before[0], 1, `${name}: baseline frame count`);
    assert.equal(candidate.count() - before[1], 1, `${name}: candidate frame count`);
    if (name === "footer-only token rate update") {
      for (const kind of ["history", "animation", "editor"]) {
        assert.equal(candidate.counts[kind] - countsBefore[kind], 0, `${mode}: footer update must not render ${kind}`);
      }
      assert.equal(candidate.counts.footer - countsBefore.footer, 1, `${mode}: footer renders once`);
      assert.ok(candidate.snapshot().lines.some(line => line.includes("102 t/s")), `${mode}: new rate is visible`);
      assert.ok(candidate.snapshot().output.includes("102 t/s"), `${mode}: new rate reaches terminal`);
    }
    checks.push(name);
  }
  reference.dispose(); candidate.dispose();
  scheduled.push({ mode, checks });
}
console.log(JSON.stringify({ node: process.version, piTui: "1.4.0", results, timings, scheduled, scope: "Real host renderers and scheduler with an in-memory fixture cache; no public API, real PTY, overlays, selection, images, arbitrary custom containers, or production extension integration is validated." }, null, 2));
}
