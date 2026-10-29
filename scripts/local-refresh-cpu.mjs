import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import * as agent from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { CodexFooter } from "../extensions/codex-ui/dist/footer.js";

// Compare installed production components. Synchronous batches isolate renderer CPU;
// --interval=80 additionally drives the native scheduler at the example's cadence.
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const baselinePath = option("baseline");
assert.ok(baselinePath, "Pass --baseline=<pristine pi-tui package directory>");
const baselineAgentPath = option("baseline-agent", resolve(baselinePath, "../pi-coding-agent"));
const originalTui = await import(pathToFileURL(resolve(baselinePath, "dist/index.js")).href);
const originalAgent = await import(pathToFileURL(resolve(baselineAgentPath, "dist/index.js")).href);
assert.equal(typeof originalTui.TuiMainScreen.prototype.registerTextRegion, "undefined", "Baseline must be unpatched");
assert.equal(typeof tui.TuiMainScreen.prototype.registerTextRegion, "function", "Candidate must expose the production API");
agent.initTheme("dark", false);
originalAgent.initTheme("dark", false);
const theme = getThemeByName("dark");
const frames = Number(option("frames", "320"));
const repetitions = Number(option("samples", "7"));
const interval = Number(option("interval", "0"));
const historySizes = option("pairs", "0,200,1000").split(",").map(Number);
const workloads = option("workloads", "animation-and-rate,streaming-and-animation,unused-api").split(",");
const baselineOnly = process.argv.includes("--baseline-only");
assert.ok(Number.isInteger(frames) && frames > 0 && Number.isInteger(repetitions) && repetitions > 0 && interval >= 0);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const message = text => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-responses", provider: "openai", model: "gpt-4.1", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0 });

function createFixture(implementation, historyPairs) {
  const Host = implementation === "baseline" ? originalTui : tui;
  const Agent = implementation === "baseline" ? originalAgent : agent;
  let output = "", bytes = 0, step = 0;
  const terminal = { columns: 120, rows: 40, write: text => { output += text; bytes += Buffer.byteLength(text); }, hideCursor() {}, showCursor() {} };
  const chat = new Host.Container();
  for (let i = 0; i < historyPairs; i++) {
    chat.addChild(new Agent.UserMessageComponent(`历史问题 ${i}: explain the state transition.`));
    chat.addChild(new Agent.AssistantMessageComponent(message(`Answer ${i}.\n\n- Preserve accounting.\n- Render the **cached** summary.\n\n\`\`\`ts\nconst state = "active";\n\`\`\``)));
  }
  const tail = new Agent.AssistantMessageComponent(message("Current response"));
  chat.addChild(tail);
  const animation = { invalidate() {}, render() { return [`${["⠋", "⠙", "⠹", "⠸"][step % 4]} Working (${Math.floor(step / 10)}s · esc to interrupt)`]; } };
  const editor = { invalidate() {}, render() { return [`> draft${Host.CURSOR_MARKER}`]; } };
  const baseFooter = new CodexFooter({ cwd: process.cwd(), getModelId: () => "gpt-4.1", getThinkingLevel: () => "high",
    getContextUsage: () => ({ percent: 12 }), getBranch: () => "main", getTheme: () => theme, getExtensionStatuses: () => new Map() });
  const footer = { invalidate() { baseFooter.invalidate(); }, render(width) {
    const lines = baseFooter.render(width);
    return [...lines.slice(0, -1), `${tui.truncateToWidth(lines.at(-1) ?? "", width - 12)}  ${100 + step % 20} t/s`];
  } };
  const widget = new Host.Container(); widget.addChild(animation);
  const bottom = new Host.Container(); bottom.addChild(footer);
  const renderer = new Host.TuiMainScreen(terminal, true);
  for (const component of [chat, widget, editor, bottom]) renderer.addChild(component);
  const handles = implementation === "region" ? [animation, footer].map(c => renderer.registerTextRegion(c)) : [];
  renderer.renderNow();
  return {
    async render(local) {
      output = ""; bytes = 0;
      for (const handle of handles) handle.requestRender();
      if (!local || !handles.length) renderer.requestRender();
      if (interval) await delay(interval);
      else {
        // Flush the queued frame without converting a local request into renderNow's normal request.
        renderer.cancelRenderTimer(); renderer.renderRequested = false; renderer.doRender();
      }
    },
    advance(streaming) { step++; if (streaming) tail.updateContent(message(`Current response ${step}: ${"text ".repeat(step % 30 + 1)}`), true); },
    snapshot: () => ({ state: renderer.captureRenderState(), output }),
    bytes: () => bytes,
    dispose() { for (const h of handles) h.dispose(); renderer.stopped = true; renderer.cancelRenderTimer(); },
  };
}

const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const sources = Object.fromEntries(["scripts/local-refresh-cpu.mjs", "patches/@earendil-works__pi-tui@1.4.0.patch", "patches/@earendil-works__pi-coding-agent@1.4.0.patch"].map(path => [path, hash(path)]));
const results = [];
for (const historyPairs of historySizes) for (const workload of workloads) {
  assert.ok(["animation-and-rate", "streaming-and-animation", "unused-api"].includes(workload));
  const fixtures = { baseline: createFixture("baseline", historyPairs), ...(!baselineOnly ? { region: createFixture(workload === "unused-api" ? "unused" : "region", historyPairs) } : {}) };
  try {
    const local = workload === "animation-and-rate";
    for (let i = 0; i < 50; i++) {
      for (const f of Object.values(fixtures)) { f.advance(!local); await f.render(local); }
      if (fixtures.region) assert.deepEqual(fixtures.region.snapshot(), fixtures.baseline.snapshot(), `${historyPairs}/${workload}/frame-${i}`);
    }
    const samples = { baseline: [], region: [] };
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const order = Object.keys(fixtures);
      for (const implementation of [...order.slice(repetition % order.length), ...order.slice(0, repetition % order.length)]) {
        const f = fixtures[implementation];
        await nextTurn(); global.gc?.();
        const startCpu = process.cpuUsage(), start = performance.now();
        let bytes = 0;
        for (let i = 0; i < frames; i++) { f.advance(!local); await f.render(local); bytes += f.bytes(); }
        await nextTurn();
        const wallMs = performance.now() - start, cpu = process.cpuUsage(startCpu);
        samples[implementation].push({ userMs: cpu.user / 1000, systemMs: cpu.system / 1000, cpuMsPerFrame: (cpu.user + cpu.system) / 1000 / frames, wallMsPerFrame: wallMs / frames, bytes });
      }
      if (fixtures.region) {
        assert.deepEqual(fixtures.region.snapshot(), fixtures.baseline.snapshot());
        assert.equal(samples.region.at(-1).bytes, samples.baseline.at(-1).bytes);
      }
    }
    const baseline = median(samples.baseline.map(s => s.cpuMsPerFrame));
    const region = median(samples.region.map(s => s.cpuMsPerFrame));
    const tolerance = Math.max(baseline * 0.1, 0.1);
    const passed = baselineOnly || (local && historyPairs > 0 ? region <= baseline * 0.7 : region - baseline <= tolerance);
    if (!passed) process.exitCode = 1;
    results.push({ passed, tolerance, historyPairs, workload, framesPerSample: frames, repetitions, baselineCpuMsPerFrame: baseline, regionCpuMsPerFrame: region, regionReductionPercent: (baseline - region) / baseline * 100, samples });
  } finally { for (const f of Object.values(fixtures)) f.dispose(); }
}
console.log(JSON.stringify({ node: process.version, pi: "1.4.0", columns: 120, rows: 40, intervalMs: interval,
  metric: "Process user+system CPU per frame; median of rotating repeated batches", baselinePath, baselineAgentPath,
  sources,
  limitations: ["Controlled real message components and CodexFooter; external model not called", "In-memory terminal; terminal emulator CPU excluded", "Regular mode only", "Synchronous mode flushes the real queued frame; interval mode uses the native timer"], results }, null, 2));
