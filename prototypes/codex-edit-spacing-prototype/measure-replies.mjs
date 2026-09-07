// Measure the compiled production transformer with native assistant components.
// Run before and after changes with the same Node version and terminal width.
import { performance } from "node:perf_hooks";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import codexUi from "../../extensions/codex-ui/dist/index.js";

if (!global.gc) throw new Error("Run Node with --expose-gc");
initTheme("dark", false);
const transformers = [];
const baseline = process.argv.includes("--baseline");
codexUi({ registerTool() {}, registerCommand() {}, on() {},
  registerMarkdownTransformer(transform) {
    transformers.push(baseline ? (source, context) => context.messageType === "assistant" ? source : transform(source, context) : transform);
  } });
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const paragraph = "A representative reply contains wrapped prose, **bold text**, `inline code`, and a link to [Pi](https://pi.dev).\n\n";
const source = (paragraph.repeat(4) + "## Details\n\n- First item\n- Second item\n\n```ts\nconst ready = true;\n```\n\n").repeat(40);
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const workloads = [];
for (const size of [2048, 16384]) {
  const message = { role: "assistant", timestamp: 1, api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "stop", usage, content: [] };
  const samples = [];
  const retained = [];
  for (let round = 0; round < 6; round++) {
    global.gc();
    const initialHeap = process.memoryUsage().heapUsed;
    let peakHeap = initialHeap;
    let row = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", 0, transformers);
    const frames = [];
    for (let end = 256; end <= size; end += 256) {
      const partial = { ...message, content: [{ type: "text", text: source.slice(0, end) }] };
      const start = performance.now();
      row.updateContent(partial, true);
      row.render(80);
      frames.push(performance.now() - start);
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
    row = undefined;
    global.gc();
    const heapDelta = process.memoryUsage().heapUsed - initialHeap;
    if (round > 0) {
      samples.push({ totalMs: frames.reduce((sum, value) => sum + value, 0), p95FrameMs: percentile(frames, 0.95), peakHeapDeltaBytes: peakHeap - initialHeap });
      retained.push(heapDelta);
    }
  }
  workloads.push({ size, frameCount: size / 256, rounds: samples.length,
    medianTotalMs: percentile(samples.map(value => value.totalMs), 0.5),
    medianP95FrameMs: percentile(samples.map(value => value.p95FrameMs), 0.5),
    medianPeakHeapDeltaBytes: percentile(samples.map(value => value.peakHeapDeltaBytes), 0.5),
    retainedHeapDeltaBytes: retained });
}
console.log(JSON.stringify({ mode: baseline ? "baseline" : "production", node: process.version, width: 80, outputPad: 0, transformers: transformers.length, workloads }, null, 2));
