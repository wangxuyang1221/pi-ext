import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { AssistantMessageComponent, UserMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { getThemeByName } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { Container, CURSOR_MARKER, ScrollView, TuiMainScreen, TuiAltScreen, VStack, truncateToWidth } from "@earendil-works/pi-tui";
import { CodexFooter } from "../../../extensions/codex-ui/dist/footer.js";
import { ScopedCache } from "./scoped-refresh.mjs";
import { loadRegionRenderers } from "./region-renderers.mjs";

// A CPU baseline against real message/footer components. The cache remains a
// fixture-level experiment; this is not an installed host patch or PTY benchmark.
initTheme("dark", false);
const theme = getThemeByName("dark");
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const message = text => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-responses", provider: "openai", model: "gpt-4.1", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0 });
const regionRenderers = await loadRegionRenderers();

function createFixture(mode, implementation, historyPairs) {
  const cache = implementation === "scoped" ? new ScopedCache() : undefined;
  const wrap = component => cache?.wrap(component) ?? component;
  let output = "", bytes = 0, step = 0;
  const terminal = { columns: 120, rows: 40, write: text => { output += text; bytes += Buffer.byteLength(text); }, hideCursor() {}, showCursor() {} };
  const chat = wrap(new Container());
  for (let i = 0; i < historyPairs; i++) {
    chat.addChild(wrap(new UserMessageComponent(`历史问题 ${i}: explain the state transition.`)));
    chat.addChild(wrap(new AssistantMessageComponent(message(`Answer ${i}.\n\n- Preserve accounting.\n- Render the **cached** summary.\n\n\`\`\`ts\nconst state = "active";\n\`\`\``))));
  }
  const tail = wrap(new AssistantMessageComponent(message("Current response")));
  chat.addChild(tail);
  const animation = wrap({ invalidate() {}, render() { return [`${["⠋", "⠙", "⠹", "⠸"][step % 4]} Working (${Math.floor(step / 10)}s · esc to interrupt)`]; } });
  const editor = wrap({ invalidate() {}, render() { return [`> draft${CURSOR_MARKER}`]; } });
  const baseFooter = new CodexFooter({
    cwd: process.cwd(), getModelId: () => "gpt-4.1", getThinkingLevel: () => "high",
    getContextUsage: () => ({ percent: 12 }), getBranch: () => "main", getTheme: () => theme,
    getExtensionStatuses: () => new Map(),
  });
  const footer = wrap({ invalidate() { baseFooter.invalidate(); }, render(width) {
    const lines = baseFooter.render(width);
    const last = lines.at(-1) ?? "";
    return [...lines.slice(0, -1), `${truncateToWidth(last, width - 12)}  ${100 + step % 20} t/s`];
  } });
  const widget = wrap(new Container()); widget.addChild(animation);
  const footerContainer = wrap(new Container()); footerContainer.addChild(footer);
  const Main = implementation === "region" ? regionRenderers.TuiMainScreen : TuiMainScreen;
  const Alt = implementation === "region" ? regionRenderers.TuiAltScreen : TuiAltScreen;
  const tui = mode === "regular" ? new Main(terminal, true) : new Alt(terminal, true);
  wrap(tui);
  if (mode === "regular") {
    for (const component of [chat, widget, editor, footerContainer]) tui.addChild(component);
  } else {
    const scroll = wrap(new ScrollView(chat, { follow: "end", primary: true, scrollbar: "hidden" }));
    const root = wrap(new VStack([
      { component: scroll, grow: 1, shrink: 1, minSize: 1 },
      { component: widget, shrink: 0 },
      { component: editor, shrink: 0 },
      { component: footerContainer, shrink: 0 },
    ]));
    tui.setLayoutRoot(root);
    tui.altScreenActive = true;
  }
  let regionPending = false;
  let lastSize, footerHeight;
  if (implementation === "region") tui.experimentalRegionFrame = (width, height) => {
    if (!regionPending || lastSize !== `${width}x${height}`) return undefined;
    const dynamic = animation.render(width);
    const bottom = footer.render(width);
    if (dynamic.length !== 1 || bottom.length !== footerHeight) return undefined;
    const lines = [...(mode === "regular" ? tui.previousLines : tui.previousScreen)];
    const animationRow = lines.length - bottom.length - 2;
    lines[animationRow] = tui.applyLineResets(dynamic)[0];
    const normalizedFooter = tui.applyLineResets(bottom);
    for (let i = 0; i < normalizedFooter.length; i++) lines[lines.length - bottom.length + i] = normalizedFooter[i];
    return { lines, cursorPos: tui.experimentalCursor };
  };
  const render = local => {
    output = ""; bytes = 0;
    regionPending = local;
    if (cache) cache.render(tui, local ? [animation, footer] : undefined);
    else tui.renderNow();
    if (implementation === "region") {
      lastSize = `${terminal.columns}x${terminal.rows}`;
      footerHeight ??= footer.render(terminal.columns).length;
    }
  };
  render(false);
  return {
    render,
    advance(streaming = false) { step++; if (streaming) tail.updateContent(message(`Current response ${step}: ${"text ".repeat(step % 30 + 1)}`), true); },
    snapshot: () => ({ lines: mode === "regular" ? tui.previousLines : tui.getScreenLines(), output }),
    bytes: () => bytes,
    dispose() { tui.stopped = true; tui.cancelRenderTimer(); cache?.dispose(); },
  };
}

const frames = Number(process.argv.find(arg => arg.startsWith("--frames="))?.split("=")[1] ?? 80);
const repetitions = Number(process.argv.find(arg => arg.startsWith("--samples="))?.split("=")[1] ?? 5);
assert.ok(Number.isInteger(frames) && frames > 0 && Number.isInteger(repetitions) && repetitions > 0);
const results = [];
try {
for (const mode of ["regular", "fullscreen"]) {
  for (const historyPairs of [0, 200, 1000]) {
    for (const workload of ["animation-and-rate", "streaming-and-animation"]) {
      const fixtures = {
        baseline: createFixture(mode, "baseline", historyPairs),
        scoped: createFixture(mode, "scoped", historyPairs),
        region: createFixture(mode, "region", historyPairs),
      };
      const local = workload === "animation-and-rate";
      // Verify identical visible output and actual terminal writes before timing.
      for (let i = 0; i < 50; i++) {
        for (const f of Object.values(fixtures)) { f.advance(!local); f.render(local); }
        assert.deepEqual(fixtures.scoped.snapshot(), fixtures.baseline.snapshot(), `${mode}/${historyPairs}/${workload}`);
        assert.deepEqual(fixtures.region.snapshot(), fixtures.baseline.snapshot(), `${mode}/${historyPairs}/${workload}/region`);
      }
      const samples = { baseline: [], scoped: [], region: [] };
      for (let repetition = 0; repetition < repetitions; repetition++) {
        const order = ["baseline", "scoped", "region"];
        for (const implementation of [...order.slice(repetition % 3), ...order.slice(0, repetition % 3)]) {
          const f = fixtures[implementation];
          global.gc?.();
          const startCpu = process.cpuUsage();
          const start = performance.now();
          let bytes = 0;
          for (let i = 0; i < frames; i++) { f.advance(!local); f.render(local); bytes += f.bytes(); }
          const wallMs = performance.now() - start;
          const cpu = process.cpuUsage(startCpu);
          samples[implementation].push({ cpuMsPerFrame: (cpu.user + cpu.system) / 1000 / frames, wallMsPerFrame: wallMs / frames, bytes });
        }
      }
      const baseline = median(samples.baseline.map(s => s.cpuMsPerFrame));
      const scoped = median(samples.scoped.map(s => s.cpuMsPerFrame));
      const region = median(samples.region.map(s => s.cpuMsPerFrame));
      results.push({ mode, historyPairs, workload, framesPerSample: frames, repetitions, baselineCpuMsPerFrame: baseline, scopedCpuMsPerFrame: scoped, regionCpuMsPerFrame: region, scopedReductionPercent: (baseline - scoped) / baseline * 100, regionReductionPercent: (baseline - region) / baseline * 100, samples });
      for (const f of Object.values(fixtures)) f.dispose();
    }
  }
}
console.log(JSON.stringify({ node: process.version, pi: "1.4.0", columns: 120, rows: 40, metric: "Process user+system CPU per controlled frame; median of rotating repeated batches", limitations: ["Controlled cached text messages with real host components and CodexFooter", "In-memory terminal, not terminal emulator CPU", "Fixture caches and supplied region bounds, not production host API", "Region path does not update layout metadata or handle selection/images/overlays", "Streaming content is controlled, not a model request", "Synchronous frames isolate render CPU; no idle or tick-rate claim"], results }, null, 2));
} finally { regionRenderers.cleanup(); }
